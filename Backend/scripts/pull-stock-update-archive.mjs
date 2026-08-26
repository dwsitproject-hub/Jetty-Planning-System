#!/usr/bin/env node
/**
 * One-time stock-update archive pull (27 Jul – 4 Aug) + production SQL.
 *
 * Excludes ambiguous .12 tanks (503–506 / 500x series).
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveEnabledSources } from '../src/lib/tank-gauging-source-config.js';
import { pool, verifyConnection } from '../src/db.js';
import {
  buildAuthHeaders,
  fetchTankMeta,
  parseTankMetaResponse,
  tankvisionNameToCode,
  trimBaseUrl,
} from '../src/lib/tankvision-client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '../exports/tankvision-archive');
const FROM = '2026-07-27';
const TO = '2026-08-04';
const TZ = 7;
const PORT_ID = 1;

const PULL_PLAN = [
  {
    baseUrl: 'http://172.16.11.77',
    codes: ['5104', '1501', '5102', '5101'],
  },
  {
    baseUrl: 'http://172.16.246.10',
    codes: ['3101', '3502', '3203', '3602', '5203', '5201', '5202', '5204', '3000', '1000', '3702', '3102'],
  },
  {
    baseUrl: 'http://172.16.246.12',
    codes: ['2101', '2102', '2103', '2104'],
  },
];

const PARAMS = [
  { id: 622, name: 'level_mm' },
  { id: 625, name: 'temperature_c' },
  { id: 628, name: 'density_kg_m3' },
  { id: 717, name: 'volume' },
  { id: 730, name: 'total_mass_t' },
];

const PARAM_COLUMNS = {
  622: 'level_mm',
  625: 'temperature_c',
  628: 'observed_density_kg_m3',
  717: 'total_observed_volume',
  730: 'total_mass',
};

const STATUS_RANK = {
  NODATA: 100, FAIL: 90, INVALIDDATA: 80, INIT: 70, MANUAL: 60, LASTVALIDVALUE: 50, OK: 10,
};

function rangeUnix(fromStr, toStr, tzHours) {
  const bounds = (dateStr, end) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    const ms = end
      ? Date.UTC(y, m - 1, d, 24 - tzHours, 0, 0, 0) - 1
      : Date.UTC(y, m - 1, d, -tzHours, 0, 0, 0);
    return Math.floor(ms / 1000);
  };
  return { start: bounds(fromStr, false), end: bounds(toStr, true) };
}

function codeFromTankName(name) {
  const n = String(name || '').trim();
  const tankNum = n.match(/^Tank\s+(\d+)$/i);
  if (tankNum) return tankNum[1];
  return tankvisionNameToCode(n);
}

function findTankByCode(tanks, code) {
  const want = String(code).toLowerCase();
  return tanks.find((t) => String(codeFromTankName(t.name) || t.code || '').toLowerCase() === want);
}

async function resolveAuthByUrl(baseUrl) {
  try {
    await verifyConnection();
    const sources = await resolveEnabledSources(pool, { portId: PORT_ID });
    const hit = sources.find((s) => trimBaseUrl(s.baseUrl) === trimBaseUrl(baseUrl));
    if (hit?.auth) return hit.auth;
  } catch {
    /* local db optional */
  }
  return { type: 'none' };
}

async function fetchArchive(baseUrl, auth, externalTankId, paramId, start, end) {
  const base = trimBaseUrl(baseUrl);
  const url = new URL(`${base}/GWTHandler.esp`);
  url.searchParams.set('DATATYPE', '18');
  url.searchParams.set('ID', String(externalTankId));
  url.searchParams.set('STARTTIME', String(start));
  url.searchParams.set('ENDTIME', String(end));
  url.searchParams.set('PARAMID', String(paramId));

  await fetch(`${base}/index.esp`, {
    headers: buildAuthHeaders(base, auth),
    signal: AbortSignal.timeout(8000),
  }).catch(() => {});

  const res = await fetch(url, {
    headers: buildAuthHeaders(base, auth),
    signal: AbortSignal.timeout(120000),
  });
  const text = await res.text();
  if (!res.ok || !text.trim()) throw new Error(`HTTP ${res.status}`);
  return JSON.parse(text);
}

function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function rowsToCsv(rows) {
  const header = ['source_base_url', 'tank_id', 'tank_name', 'param_id', 'param_name', 'sampled_at_utc', 'value', 'status'];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(
      [r.sourceBaseUrl, r.tankId, r.tankName, r.paramId, r.paramName, r.sampledAt, r.value, r.status]
        .map(csvEscape)
        .join(',')
    );
  }
  return `${lines.join('\n')}\n`;
}

function pickWorstStatus(statuses) {
  let worst = null;
  let worstRank = -1;
  for (const raw of statuses) {
    if (!raw) continue;
    const key = String(raw).trim().toUpperCase().replace(/\s+/g, '');
    const rank = STATUS_RANK[key] ?? 40;
    if (rank > worstRank) { worstRank = rank; worst = String(raw).trim(); }
  }
  return worst;
}

function mergeCsvRows(rows) {
  const byKey = new Map();
  for (const row of rows) {
    const key = `${row.sourceBaseUrl}|${row.tankId}|${row.sampledAt}`;
    let s = byKey.get(key);
    if (!s) {
      s = { sourceBaseUrl: row.sourceBaseUrl, externalTankId: row.tankId, tankName: row.tankName, sampledAt: row.sampledAt, statuses: [], values: {} };
      byKey.set(key, s);
    }
    if (row.status) s.statuses.push(row.status);
    const col = PARAM_COLUMNS[row.paramId];
    if (col) s.values[col] = row.value;
  }
  return [...byKey.values()].map((s) => ({ ...s, statusText: pickWorstStatus(s.statuses) }));
}

function sqlLiteral(v) {
  if (v == null || v === '') return 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
}

function sqlNumeric(v) {
  if (v == null || v === '') return 'NULL';
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : 'NULL';
}

function buildSqlBatches(samples, batchSize = 150) {
  const chunks = [];
  for (let i = 0; i < samples.length; i += batchSize) chunks.push(samples.slice(i, i + batchSize));

  return chunks.map((chunk) => {
    const valueRows = chunk.map((s) => {
      const v = s.values;
      return `(
  ${sqlLiteral(s.sourceBaseUrl)},
  ${s.externalTankId}::bigint,
  ${sqlLiteral(s.tankName)}::text,
  ${sqlLiteral(s.sampledAt)}::timestamptz,
  ${sqlNumeric(v.total_mass)},
  ${sqlNumeric(v.level_mm)},
  ${sqlNumeric(v.temperature_c)},
  ${sqlNumeric(v.observed_density_kg_m3)},
  ${sqlNumeric(v.total_observed_volume)},
  ${sqlLiteral(s.statusText)}
)`;
    }).join(',\n');

    return `INSERT INTO tank_gauging_samples (
  tank_id,
  source_base_url,
  total_mass,
  flow_rate_tph,
  level_mm,
  temperature_c,
  observed_density_kg_m3,
  total_observed_volume,
  status_text,
  sampled_at,
  raw_payload
)
SELECT
  m.tank_id,
  v.source_base_url,
  v.total_mass,
  NULL,
  v.level_mm,
  v.temperature_c,
  v.observed_density_kg_m3,
  v.total_observed_volume,
  v.status_text,
  v.sampled_at,
  jsonb_build_object(
    'source', 'tankvision-archive-import',
    'externalTankId', v.external_tank_id,
    'tankName', v.tank_name
  )
FROM (
  VALUES
${valueRows}
) AS v(
  source_base_url,
  external_tank_id,
  tank_name,
  sampled_at,
  total_mass,
  level_mm,
  temperature_c,
  observed_density_kg_m3,
  total_observed_volume,
  status_text
)
JOIN tank_gauging_tank_map m
  ON m.external_tank_id = v.external_tank_id
 AND m.source_base_url = v.source_base_url
 AND m.port_id = ${PORT_ID}
WHERE NOT EXISTS (
  SELECT 1
  FROM tank_gauging_samples s
  WHERE s.tank_id = m.tank_id
    AND s.source_base_url = v.source_base_url
    AND s.sampled_at = v.sampled_at
);`;
  });
}

async function main() {
  const { start, end } = rangeUnix(FROM, TO, TZ);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const allRows = [];
  const report = [];

  for (const plan of PULL_PLAN) {
    const baseUrl = trimBaseUrl(plan.baseUrl);
    const auth = await resolveAuthByUrl(baseUrl);
    const meta = parseTankMetaResponse((await fetchTankMeta({ baseUrl, auth })).text);

    for (const code of plan.codes) {
      const tank = findTankByCode(meta.tanks, code);
      if (!tank) {
        report.push({ baseUrl, code, ok: false, error: 'tank not found on host' });
        continue;
      }
      let tankRows = 0;
      for (const param of PARAMS) {
        process.stdout.write(`${baseUrl} ${tank.name} param ${param.id}... `);
        try {
          const data = await fetchArchive(baseUrl, auth, tank.externalTankId, param.id, start, end);
          const list = data?.parameterlist || [];
          for (const pt of list) {
            const ts = Number(pt.timestamp || pt.localtimestamp || 0);
            allRows.push({
              sourceBaseUrl: baseUrl,
              tankId: tank.externalTankId,
              tankName: tank.name,
              paramId: param.id,
              paramName: param.name,
              sampledAt: ts > 0 ? new Date(ts * 1000).toISOString() : '',
              value: pt.value ?? pt.valueString ?? '',
              status: pt.statusString ?? '',
            });
          }
          tankRows += list.length;
          console.log(list.length);
        } catch (e) {
          console.log(`FAIL ${e.message}`);
          report.push({ baseUrl, code, paramId: param.id, ok: false, error: e.message });
        }
      }
      report.push({ baseUrl, code, tankName: tank.name, externalTankId: tank.externalTankId, ok: true, rows: tankRows });
    }
  }

  const stamp = `${FROM.replace(/-/g, '')}_to_${TO.replace(/-/g, '')}`;
  const csvPath = path.join(OUT_DIR, `stock_update_${stamp}.csv`);
  fs.writeFileSync(csvPath, rowsToCsv(allRows), 'utf8');

  const samples = mergeCsvRows(allRows);
  const sqlPath = path.join(OUT_DIR, `stock_update_${stamp}.sql`);
  const batches = buildSqlBatches(samples);
  const header = `-- Stock update archive import → tank_gauging_samples
-- Range      : ${FROM} → ${TO} (WITA)
-- Tanks      : 20 (excludes .12 Tank 503–506 / 500x)
-- Samples    : ${samples.length} merged timestamps
-- CSV rows   : ${allRows.length}
--
-- IDEMPOTENT: skips any row where tank_id + source_base_url + sampled_at already exists.
-- This preserves existing poller data (e.g. samples around 2026-08-04 16:30 WITA).
--
-- Preflight:
--   SELECT external_tank_id, tank_id, source_base_url
--   FROM tank_gauging_tank_map WHERE port_id = 1
--   ORDER BY source_base_url, external_tank_id;
--
--   SELECT tank_id, sampled_at, total_mass
--   FROM tank_gauging_samples
--   WHERE sampled_at BETWEEN '2026-08-04 09:00+00' AND '2026-08-04 10:00+00'
--   ORDER BY sampled_at;
--
-- Apply:
--   psql -U jps_user -d jps_db -f stock_update_${stamp}.sql

BEGIN;

`;
  fs.writeFileSync(sqlPath, header + batches.join('\n\n') + '\nCOMMIT;\n', 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, `stock_update_${stamp}-report.json`), JSON.stringify({ from: FROM, to: TO, report, sampleCount: samples.length, csvRows: allRows.length }, null, 2));

  console.log(`\nCSV  → ${csvPath} (${allRows.length} rows)`);
  console.log(`SQL  → ${sqlPath} (${samples.length} samples, ${batches.length} batches)`);

  try { await pool.end(); } catch { /* optional */ }
}

main().catch(async (err) => {
  console.error(err);
  try { await pool.end(); } catch { /* ignore */ }
  process.exit(1);
});
