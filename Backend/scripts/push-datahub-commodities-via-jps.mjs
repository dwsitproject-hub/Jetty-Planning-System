/**
 * Upsert commodities in JPS (si_commodities) and push to DataHub using the
 * same path as Master → Commodity save (tryPushCommodityAfterSave).
 *
 *   cd Backend && node scripts/push-datahub-commodities-via-jps.mjs [csv]
 *
 * Requires DATABASE_URL and DataHub enabled in Admin (or DHM_* in .env).
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { pool } from '../src/db.js';
import { tryPushCommodityAfterSave } from '../src/lib/datahub-si-master-push.js';

const CSV =
  process.argv[2] ||
  path.join(import.meta.dirname, '..', 'exports', 'datahub', 'commodities-catalog-jps.csv');
const RESULTS = path.join(import.meta.dirname, '..', 'exports', 'datahub', 'commodities-push-via-jps-results.csv');

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function shortKey(v) {
  return String(v ?? '').trim().toUpperCase();
}

async function loadMetricIds() {
  const r = await pool.query(
    `SELECT id, UPPER(code) AS code FROM metric WHERE deleted_at IS NULL AND UPPER(code) IN ('KL', 'MT')`
  );
  const map = {};
  for (const row of r.rows) map[row.code] = Number(row.id);
  return map;
}

async function upsertCommodity(row, metricIds) {
  const short_name = shortKey(row.short_name);
  const name = String(row.name ?? '').trim();
  const commodity_type = String(row.type ?? 'Liquid').trim() === 'Solid' ? 'Solid' : 'Liquid';
  const default_metric_id =
    commodity_type === 'Liquid' ? metricIds.KL ?? null : metricIds.MT ?? null;
  if (!short_name || !name) throw new Error('short_name and name required');

  const existing = await pool.query(
    `SELECT id FROM si_commodities WHERE UPPER(short_name) = $1 AND deleted_at IS NULL`,
    [short_name]
  );
  if (existing.rows.length > 0) {
    const id = Number(existing.rows[0].id);
    await pool.query(
      `UPDATE si_commodities SET
         name = $1,
         commodity_type = $2,
         default_metric_id = COALESCE($3, default_metric_id),
         updated_at = NOW()
       WHERE id = $4`,
      [name, commodity_type, default_metric_id, id]
    );
    return id;
  }
  const ins = await pool.query(
    `INSERT INTO si_commodities (name, short_name, commodity_type, default_metric_id, sort_order)
     VALUES ($1, $2, $3, $4, 0)
     RETURNING id`,
    [name, short_name, commodity_type, default_metric_id]
  );
  return Number(ins.rows[0].id);
}

async function fetchRowForPush(id) {
  const r = await pool.query(
    `SELECT c.*, dm.code AS default_metric_code
     FROM si_commodities c
     LEFT JOIN metric dm ON dm.id = c.default_metric_id AND dm.deleted_at IS NULL
     WHERE c.id = $1 AND c.deleted_at IS NULL`,
    [id]
  );
  return r.rows[0] ?? null;
}

const table = parseCsv(fs.readFileSync(CSV, 'utf8'));
const headers = table[0].map((h) => h.trim().toLowerCase());
const idx = (col) => headers.indexOf(col);
const rows = table.slice(1).map((cells) => ({
  short_name: cells[idx('short_name')] ?? '',
  name: cells[idx('name')] ?? '',
  type: cells[idx('type')] ?? 'Liquid',
}));

const metricIds = await loadMetricIds();
const results = [];

for (const row of rows) {
  try {
    const id = await upsertCommodity(row, metricIds);
    const localRow = await fetchRowForPush(id);
    const push = await tryPushCommodityAfterSave(localRow, null);
    results.push({
      short_name: shortKey(row.short_name),
      name: row.name,
      jps_id: id,
      push_ok: push.ok,
      push_skipped: push.skipped ?? false,
      hub_code: push.code ?? localRow?.hub_code ?? '',
      message: push.error ?? push.reason ?? push.message ?? '',
    });
    console.log(
      `${shortKey(row.short_name)}: jps=${id} push=${push.ok ? 'ok' : push.skipped ? 'skipped' : 'fail'} ${push.code ?? ''} ${push.error ?? push.message ?? ''}`
    );
  } catch (e) {
    results.push({
      short_name: shortKey(row.short_name),
      name: row.name,
      jps_id: '',
      push_ok: false,
      push_skipped: false,
      hub_code: '',
      message: String(e.message),
    });
    console.error(`FAILED ${row.short_name}: ${e.message}`);
  }
}

const esc = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
fs.writeFileSync(
  RESULTS,
  ['short_name,name,jps_id,push_ok,push_skipped,hub_code,message']
    .concat(
      results.map((r) =>
        [r.short_name, r.name, r.jps_id, r.push_ok, r.push_skipped, r.hub_code, r.message].map(esc).join(',')
      )
    )
    .join('\n') + '\n'
);

console.log('Summary:', {
  total: results.length,
  push_ok: results.filter((r) => r.push_ok).length,
  skipped: results.filter((r) => r.push_skipped).length,
  failed: results.filter((r) => !r.push_ok && !r.push_skipped).length,
});
console.log(`Results: ${RESULTS}`);

await pool.end();
