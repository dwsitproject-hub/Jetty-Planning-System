#!/usr/bin/env node
/**
 * One-time pull of Tankvision historical (archived) tank data.
 *
 * Reverse-engineered from Trend.esp GWT (ARCHIVETANKDATA = DATATYPE 18):
 *   GET /GWTHandler.esp?DATATYPE=18&ID={tankId}&STARTTIME={unix}&ENDTIME={unix}&PARAMID={paramId}
 *
 * Usage:
 *   node scripts/pull-tankvision-archive.mjs
 *   node scripts/pull-tankvision-archive.mjs --baseUrl=http://172.16.246.10 --from=2026-08-01 --to=2026-08-04
 *   node scripts/pull-tankvision-archive.mjs --tankId=1 --paramId=730 --out=tmp-tk5201-mass.csv
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  buildAuthHeaders,
  fetchTankMeta,
  parseTankMetaResponse,
  trimBaseUrl,
} from '../src/lib/tankvision-client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_PARAMS = [
  { id: 622, name: 'level_mm' },
  { id: 625, name: 'temperature_c' },
  { id: 628, name: 'density_kg_m3' },
  { id: 717, name: 'volume' },
  { id: 730, name: 'total_mass_t' },
];

function parseArgs(argv) {
  const out = {
    baseUrl: process.env.TANK_GAUGING_BASE_URL || 'http://172.16.246.10',
    from: '2026-08-01',
    to: null,
    tankIds: null,
    paramIds: DEFAULT_PARAMS.map((p) => p.id),
    outDir: path.resolve(__dirname, '../exports/tankvision-archive'),
    timezoneOffsetHours: 7,
  };
  for (const arg of argv) {
    if (arg.startsWith('--baseUrl=')) out.baseUrl = trimBaseUrl(arg.slice('--baseUrl='.length));
    else if (arg.startsWith('--from=')) out.from = arg.slice('--from='.length);
    else if (arg.startsWith('--to=')) out.to = arg.slice('--to='.length);
    else if (arg.startsWith('--tankId=')) {
      out.tankIds = String(arg.slice('--tankId='.length))
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n));
    } else if (arg.startsWith('--paramId=')) {
      out.paramIds = String(arg.slice('--paramId='.length))
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n));
    } else if (arg.startsWith('--outDir=')) out.outDir = path.resolve(arg.slice('--outDir='.length));
    else if (arg.startsWith('--out=')) out.singleOut = path.resolve(arg.slice('--out='.length));
    else if (arg.startsWith('--tz=')) out.timezoneOffsetHours = Number(arg.slice('--tz='.length));
  }
  if (!out.to) {
    const y = new Date();
    y.setDate(y.getDate() - 1);
    out.to = y.toISOString().slice(0, 10);
  }
  return out;
}

function dayBoundsUnix(dateStr, tzHours) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const startMs = Date.UTC(y, m - 1, d, -tzHours, 0, 0, 0);
  const endMs = Date.UTC(y, m - 1, d, 24 - tzHours, 0, 0, 0) - 1;
  return { start: Math.floor(startMs / 1000), end: Math.floor(endMs / 1000) };
}

function rangeUnix(fromStr, toStr, tzHours) {
  const from = dayBoundsUnix(fromStr, tzHours);
  const to = dayBoundsUnix(toStr, tzHours);
  return { start: from.start, end: to.end };
}

async function fetchArchiveTankData(baseUrl, tankId, paramId, startUnix, endUnix, auth) {
  const url = new URL(`${trimBaseUrl(baseUrl)}/GWTHandler.esp`);
  url.searchParams.set('DATATYPE', '18');
  url.searchParams.set('ID', String(tankId));
  url.searchParams.set('STARTTIME', String(startUnix));
  url.searchParams.set('ENDTIME', String(endUnix));
  url.searchParams.set('PARAMID', String(paramId));

  await fetch(`${trimBaseUrl(baseUrl)}/index.esp`, {
    headers: buildAuthHeaders(baseUrl, auth),
    signal: AbortSignal.timeout(5000),
  }).catch(() => {});

  const res = await fetch(url, {
    headers: buildAuthHeaders(baseUrl, auth),
    signal: AbortSignal.timeout(120000),
  });
  const text = await res.text();
  if (!res.ok || !text.trim()) {
    throw new Error(`HTTP ${res.status} empty body for tank ${tankId} param ${paramId}`);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response for tank ${tankId} param ${paramId}: ${text.slice(0, 120)}`);
  }
  return { url: url.toString(), data };
}

function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function rowsToCsv(rows) {
  const header = ['tank_id', 'tank_name', 'param_id', 'param_name', 'sampled_at_utc', 'value', 'status'];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(
      [r.tankId, r.tankName, r.paramId, r.paramName, r.sampledAt, r.value, r.status]
        .map(csvEscape)
        .join(',')
    );
  }
  return `${lines.join('\n')}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { start, end } = rangeUnix(args.from, args.to, args.timezoneOffsetHours);
  const auth = { type: 'none' };

  console.log(`Base URL : ${args.baseUrl}`);
  console.log(`Range    : ${args.from} → ${args.to} (WITA UTC+${args.timezoneOffsetHours})`);
  console.log(`Unix     : ${start} → ${end}`);

  const metaRes = await fetchTankMeta({ baseUrl: args.baseUrl, auth });
  const meta = parseTankMetaResponse(metaRes.text);
  const tanks = meta.tanks.filter((t) =>
    args.tankIds?.length ? args.tankIds.includes(t.externalTankId) : true
  );
  if (!tanks.length) {
    throw new Error('No tanks found (check --tankId or DATATYPE=23 response)');
  }

  const paramNameById = new Map(DEFAULT_PARAMS.map((p) => [p.id, p.name]));
  for (const pid of args.paramIds) {
    if (!paramNameById.has(pid)) paramNameById.set(pid, `param_${pid}`);
  }

  fs.mkdirSync(args.outDir, { recursive: true });
  const allRows = [];

  for (const tank of tanks) {
    for (const paramId of args.paramIds) {
      process.stdout.write(`Fetching ${tank.name} (id=${tank.externalTankId}) param ${paramId}... `);
      try {
        const { data } = await fetchArchiveTankData(
          args.baseUrl,
          tank.externalTankId,
          paramId,
          start,
          end,
          auth
        );
        const list = data?.parameterlist || [];
        for (const pt of list) {
          const ts = Number(pt.timestamp || pt.localtimestamp || 0);
          allRows.push({
            tankId: tank.externalTankId,
            tankName: tank.name,
            paramId,
            paramName: paramNameById.get(paramId),
            sampledAt: ts > 0 ? new Date(ts * 1000).toISOString() : '',
            value: pt.value ?? pt.valueString ?? '',
            status: pt.statusString ?? '',
          });
        }
        console.log(`${list.length} points`);
      } catch (e) {
        console.log(`FAILED: ${e.message}`);
      }
    }
  }

  const stamp = `${args.from}_to_${args.to}`.replace(/-/g, '');
  const outFile =
    args.singleOut || path.join(args.outDir, `archive_${stamp}_${path.basename(trimBaseUrl(args.baseUrl)).replace(/\./g, '-')}.csv`);
  fs.writeFileSync(outFile, rowsToCsv(allRows), 'utf8');
  console.log(`\nWrote ${allRows.length} rows → ${outFile}`);
}

main().catch((err) => {
  console.error('[pull-tankvision-archive]', err?.message || err);
  process.exit(1);
});
