#!/usr/bin/env node
/**
 * Convert Tankvision archive CSV → SQL INSERTs for tank_gauging_samples.
 *
 * CSV format (from pull-tankvision-archive.mjs):
 *   tank_id,tank_name,param_id,param_name,sampled_at_utc,value,status
 *
 * Rows with the same external tank id + sampled_at are merged into one sample
 * (matching the poller's one-row-per-timestamp shape).
 *
 * tank_id in CSV = Tankvision external_tank_id; resolved via tank_gauging_tank_map.
 *
 * Usage:
 *   node scripts/csv-to-tank-gauging-samples-sql.mjs \
 *     --in=exports/tankvision-archive/archive_20260801_to_20260804_172-16-246-10.csv \
 *     --sourceBaseUrl=http://172.16.246.10 \
 *     --portId=1
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PARAM_COLUMNS = {
  622: 'level_mm',
  625: 'temperature_c',
  628: 'observed_density_kg_m3',
  717: 'total_observed_volume',
  730: 'total_mass',
};

const STATUS_RANK = {
  NODATA: 100,
  FAIL: 90,
  INVALIDDATA: 80,
  INIT: 70,
  MANUAL: 60,
  LASTVALIDVALUE: 50,
  OK: 10,
};

function parseArgs(argv) {
  const out = {
    inFile: null,
    outFile: null,
    sourceBaseUrl: 'http://172.16.246.10',
    portId: 1,
    batchSize: 200,
  };
  for (const arg of argv) {
    if (arg.startsWith('--in=')) out.inFile = path.resolve(process.cwd(), arg.slice('--in='.length));
    else if (arg.startsWith('--out=')) out.outFile = path.resolve(process.cwd(), arg.slice('--out='.length));
    else if (arg.startsWith('--sourceBaseUrl=')) out.sourceBaseUrl = arg.slice('--sourceBaseUrl='.length).replace(/\/+$/, '');
    else if (arg.startsWith('--portId=')) out.portId = Number(arg.slice('--portId='.length));
    else if (arg.startsWith('--batchSize=')) out.batchSize = Number(arg.slice('--batchSize='.length));
  }
  if (!out.inFile) {
    throw new Error('--in=<csv path> is required');
  }
  if (!out.outFile) {
    const base = path.basename(out.inFile, path.extname(out.inFile));
    out.outFile = path.join(path.dirname(out.inFile), `${base}.sql`);
  }
  return out;
}

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const header = lines[0].split(',').map((h) => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = [];
    let cur = '';
    let inQuotes = false;
    for (const ch of lines[i]) {
      if (ch === '"') {
        inQuotes = !inQuotes;
        continue;
      }
      if (ch === ',' && !inQuotes) {
        parts.push(cur);
        cur = '';
        continue;
      }
      cur += ch;
    }
    parts.push(cur);
    const row = {};
    for (let j = 0; j < header.length; j++) row[header[j]] = parts[j] ?? '';
    rows.push(row);
  }
  return rows;
}

function sqlLiteral(value) {
  if (value == null || value === '') return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlNumeric(value) {
  if (value == null || value === '') return 'NULL';
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : 'NULL';
}

function pickWorstStatus(statuses) {
  let worst = null;
  let worstRank = -1;
  for (const raw of statuses) {
    if (!raw) continue;
    const key = String(raw).trim().toUpperCase().replace(/\s+/g, '');
    const rank = STATUS_RANK[key] ?? 40;
    if (rank > worstRank) {
      worstRank = rank;
      worst = String(raw).trim();
    }
  }
  return worst;
}

function mergeRows(csvRows) {
  /** @type {Map<string, object>} */
  const byKey = new Map();
  for (const row of csvRows) {
    const externalTankId = Number(row.tank_id);
    const paramId = Number(row.param_id);
    const sampledAt = String(row.sampled_at_utc || '').trim();
    if (!Number.isFinite(externalTankId) || !sampledAt) continue;

    const key = `${externalTankId}|${sampledAt}`;
    let sample = byKey.get(key);
    if (!sample) {
      sample = {
        externalTankId,
        tankName: row.tank_name || null,
        sampledAt,
        statuses: [],
        values: {},
      };
      byKey.set(key, sample);
    }
    if (row.status) sample.statuses.push(row.status);
    const col = PARAM_COLUMNS[paramId];
    if (col) sample.values[col] = row.value;
  }

  return [...byKey.values()]
    .map((s) => ({
      ...s,
      statusText: pickWorstStatus(s.statuses),
    }))
    .sort((a, b) => {
      const t = a.sampledAt.localeCompare(b.sampledAt);
      return t !== 0 ? t : a.externalTankId - b.externalTankId;
    });
}

function buildInsertBatch(samples, args) {
  const valueRows = samples.map((s) => {
    const v = s.values;
    return `(
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
  });

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
  ${sqlLiteral(args.sourceBaseUrl)},
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
${valueRows.join(',\n')}
) AS v(
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
 AND m.source_base_url = ${sqlLiteral(args.sourceBaseUrl)}
 AND m.port_id = ${args.portId}
WHERE NOT EXISTS (
  SELECT 1
  FROM tank_gauging_samples s
  WHERE s.tank_id = m.tank_id
    AND s.source_base_url = ${sqlLiteral(args.sourceBaseUrl)}
    AND s.sampled_at = v.sampled_at
);`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const csvText = fs.readFileSync(args.inFile, 'utf8');
  const csvRows = parseCsv(csvText);
  const samples = mergeRows(csvRows);

  if (!samples.length) {
    throw new Error('No sample rows parsed from CSV');
  }

  const chunks = [];
  for (let i = 0; i < samples.length; i += args.batchSize) {
    chunks.push(samples.slice(i, i + args.batchSize));
  }

  const header = `-- Tankvision archive → tank_gauging_samples
-- Source CSV : ${path.basename(args.inFile)}
-- Generated  : ${new Date().toISOString()}
-- ATG host   : ${args.sourceBaseUrl}
-- Port id    : ${args.portId}
-- Samples    : ${samples.length}
--
-- Resolves Tankvision external tank id via tank_gauging_tank_map.
-- Skips rows that already exist for the same tank_id + source_base_url + sampled_at.
--
-- Preflight (run on production before import):
--   SELECT count(*) FROM tank_gauging_tank_map
--   WHERE port_id = ${args.portId} AND source_base_url = '${args.sourceBaseUrl.replace(/'/g, "''")}';
--
-- Apply:
--   psql -U jps_user -d jps_db -f ${path.basename(args.outFile)}

BEGIN;

`;

  const body = chunks.map((chunk) => buildInsertBatch(chunk, args)).join('\n\n');
  const footer = `
COMMIT;

-- Verify:
-- SELECT tank_id, count(*) AS n, min(sampled_at), max(sampled_at)
-- FROM tank_gauging_samples
-- WHERE source_base_url = '${args.sourceBaseUrl.replace(/'/g, "''")}'
--   AND sampled_at >= '2026-08-01'::timestamptz
--   AND sampled_at <  '2026-08-05'::timestamptz
-- GROUP BY 1
-- ORDER BY 1;
`;

  fs.writeFileSync(args.outFile, header + body + footer, 'utf8');
  console.log(`Parsed ${csvRows.length} CSV rows → ${samples.length} merged samples`);
  console.log(`Wrote ${chunks.length} INSERT batch(es) → ${args.outFile}`);
}

main();
