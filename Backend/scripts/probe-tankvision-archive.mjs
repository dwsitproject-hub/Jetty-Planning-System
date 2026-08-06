#!/usr/bin/env node
/**
 * Probe Tankvision hosts for requested tank codes + archive availability.
 */
import 'dotenv/config';
import { pool, verifyConnection } from '../src/db.js';
import { resolveEnabledSources } from '../src/lib/tank-gauging-source-config.js';
import {
  buildAuthHeaders,
  fetchTankMeta,
  parseTankMetaResponse,
  tankvisionNameToCode,
  trimBaseUrl,
} from '../src/lib/tankvision-client.js';

const REQUESTED_CODES = [
  '5104', '1501',
  '2101', '5111', '2102', '2103', '2104',
  '3101', '5102', '3502',
  '3203', '3602',
  '5003',
  '5203',
  '5201', '5202', '5204',
  '5004', '5002', '5007',
  '3000', '1000', '3702',
  '3102', '5101',
];

const HOSTS_FALLBACK = [
  'http://172.16.246.10',
  'http://172.16.11.77',
  'http://172.16.246.12',
];

const FROM = '2026-07-27';
const TO = '2026-08-04';
const TZ = 7;

function rangeUnix(fromStr, toStr, tzHours) {
  const parse = (dateStr, endOfDay) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    const ms = endOfDay
      ? Date.UTC(y, m - 1, d, 24 - tzHours, 0, 0, 0) - 1
      : Date.UTC(y, m - 1, d, -tzHours, 0, 0, 0);
    return Math.floor(ms / 1000);
  };
  return { start: parse(fromStr, false), end: parse(toStr, true) };
}

async function loadSources() {
  try {
    await verifyConnection();
    const rows = await resolveEnabledSources(pool, { portId: 1 });
    const byUrl = new Map();
    for (const s of rows) byUrl.set(trimBaseUrl(s.baseUrl), s);
    for (const url of HOSTS_FALLBACK) {
      if (!byUrl.has(url)) {
        byUrl.set(url, { baseUrl: url, auth: { type: 'none' }, label: url, enabled: true });
      }
    }
    return [...byUrl.values()];
  } catch {
    return HOSTS_FALLBACK.map((url) => ({
      baseUrl: url,
      auth: { type: 'none' },
      label: url,
      enabled: true,
    }));
  }
}

async function probeArchive(baseUrl, auth, externalTankId, start, end) {
  const url = new URL(`${trimBaseUrl(baseUrl)}/GWTHandler.esp`);
  url.searchParams.set('DATATYPE', '18');
  url.searchParams.set('ID', String(externalTankId));
  url.searchParams.set('STARTTIME', String(start));
  url.searchParams.set('ENDTIME', String(end));
  url.searchParams.set('PARAMID', '730');

  await fetch(`${trimBaseUrl(baseUrl)}/index.esp`, {
    headers: buildAuthHeaders(baseUrl, auth),
    signal: AbortSignal.timeout(5000),
  }).catch(() => {});

  const res = await fetch(url, {
    headers: buildAuthHeaders(baseUrl, auth),
    signal: AbortSignal.timeout(60000),
  });
  const text = await res.text();
  if (!res.ok) return { ok: false, httpStatus: res.status, points: 0, error: `HTTP ${res.status}` };
  if (!text.trim()) return { ok: false, httpStatus: res.status, points: 0, error: 'empty body' };
  if (text.includes('autoLogin') || text.includes('Access Error')) {
    return { ok: false, httpStatus: res.status, points: 0, error: 'auth required or access denied' };
  }
  try {
    const data = JSON.parse(text);
    const pts = data?.parameterlist?.length ?? 0;
    return { ok: pts > 0, httpStatus: res.status, points: pts, error: pts ? null : 'no archive points' };
  } catch {
    return { ok: false, httpStatus: res.status, points: 0, error: `non-json: ${text.slice(0, 80)}` };
  }
}

async function main() {
  const { start, end } = rangeUnix(FROM, TO, TZ);
  const sources = await loadSources();
  const sourceResults = [];

  for (const src of sources) {
    const base = trimBaseUrl(src.baseUrl);
    const entry = {
      baseUrl: base,
      label: src.label || base,
      authType: src.auth?.type || 'none',
      reachable: false,
      metaOk: false,
      unitName: null,
      tanks: [],
      error: null,
    };

    try {
      const metaRes = await fetchTankMeta({ baseUrl: base, auth: src.auth });
      entry.reachable = true;
      entry.metaOk = metaRes.ok && Boolean(metaRes.text?.trim());
      if (!entry.metaOk) {
        entry.error = `DATATYPE=23 HTTP ${metaRes.status}`;
        sourceResults.push(entry);
        continue;
      }
      const parsed = parseTankMetaResponse(metaRes.text);
      entry.unitName = parsed.unitName;
      const byCode = new Map();
      for (const t of parsed.tanks) {
        const code = t.code || tankvisionNameToCode(t.name);
        if (code) byCode.set(String(code).toLowerCase(), t);
      }
      for (const code of REQUESTED_CODES) {
        const tank = byCode.get(code.toLowerCase());
        if (!tank) {
          entry.tanks.push({ code, found: false, reason: 'not on this host' });
          continue;
        }
        const archive = await probeArchive(base, src.auth, tank.externalTankId, start, end);
        entry.tanks.push({
          code,
          found: true,
          tankName: tank.name,
          externalTankId: tank.externalTankId,
          archiveOk: archive.ok,
          archivePoints: archive.points,
          archiveError: archive.error,
        });
      }
    } catch (e) {
      entry.error = e?.message || String(e);
    }
    sourceResults.push(entry);
  }

  /** @type {Map<string, object>} */
  const bestByCode = new Map();
  for (const code of REQUESTED_CODES) {
    let best = { code, status: 'NOT_FOUND', source: null, detail: 'not found on any host' };
    for (const src of sourceResults) {
      const t = src.tanks.find((x) => x.code === code);
      if (!t?.found) continue;
      if (t.archiveOk && t.archivePoints > 0) {
        if (best.status !== 'OK' || t.archivePoints > (best.archivePoints || 0)) {
          best = {
            code,
            status: 'OK',
            source: src.baseUrl,
            unitName: src.unitName,
            tankName: t.tankName,
            externalTankId: t.externalTankId,
            archivePoints: t.archivePoints,
            detail: `${t.archivePoints} archive points (${FROM} → ${TO})`,
          };
        }
      } else if (best.status === 'NOT_FOUND') {
        best = {
          code,
          status: 'FOUND_NO_ARCHIVE',
          source: src.baseUrl,
          unitName: src.unitName,
          tankName: t.tankName,
          externalTankId: t.externalTankId,
          archivePoints: 0,
          detail: t.archiveError || 'no archive data in range',
        };
      }
    }
    bestByCode.set(code, best);
  }

  console.log(JSON.stringify({ from: FROM, to: TO, startUnix: start, endUnix: end, sources: sourceResults, summary: [...bestByCode.values()] }, null, 2));

  const ok = [...bestByCode.values()].filter((x) => x.status === 'OK');
  const partial = [...bestByCode.values()].filter((x) => x.status === 'FOUND_NO_ARCHIVE');
  const missing = [...bestByCode.values()].filter((x) => x.status === 'NOT_FOUND');

  console.log('\n=== SUMMARY ===');
  console.log(`OK (${ok.length}):`, ok.map((x) => `${x.code}@${x.source} (${x.archivePoints} pts)`).join(', ') || '(none)');
  console.log(`FOUND but no archive (${partial.length}):`, partial.map((x) => `${x.code}@${x.source}`).join(', ') || '(none)');
  console.log(`NOT FOUND (${missing.length}):`, missing.map((x) => x.code).join(', ') || '(none)');

  try { await pool.end(); } catch { /* optional db */ }
}

main().catch(async (err) => {
  console.error(err);
  try { await pool.end(); } catch { /* ignore */ }
  process.exit(1);
});
