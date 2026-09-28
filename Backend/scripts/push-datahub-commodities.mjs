/**
 * Push JPS commodity catalog into DataHub via POST/PUT /v1/inbound/commodity.
 *
 *   node scripts/push-datahub-commodities.mjs [commodities.csv]
 *
 * Default CSV: Backend/exports/datahub/commodities-catalog-jps.csv
 *
 * Credentials (same as vessel push):
 *   DHM_BASE_URL, DHM_PUBLIC_KEY, DHM_PRIVATE_KEY
 *
 * Options:
 *   --dry-run          print first payloads only
 *   --limit N          push first N rows only
 *   --update           PUT when short_name already exists in hub (refresh name/type/uom)
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  fetchAllSyncRecords,
  hubCommodityTypeForPush,
  normalizeHubCommodity,
  postInboundEntity,
  putInboundEntity,
} from '../src/lib/datahub-client.js';
import { expandCommodityValues } from '../src/lib/datahub-commodity-sync.js';

const argv = process.argv.slice(2);
const takeFlag = (name) => {
  const i = argv.indexOf(name);
  if (i === -1) return null;
  const v = argv[i + 1] ?? null;
  argv.splice(i, v != null && !v.startsWith('--') ? 2 : 1);
  return v;
};
const LIMIT = Number(takeFlag('--limit') ?? 0);
const DRY_RUN = argv.includes('--dry-run');
const UPDATE = argv.includes('--update');
const positional = argv.filter((a) => !a.startsWith('--'));

const CSV =
  positional[0] ||
  path.join(import.meta.dirname, '..', 'exports', 'datahub', 'commodities-catalog-jps.csv');
const RESULTS = path.join(import.meta.dirname, '..', 'exports', 'datahub', 'commodities-push-results.csv');

const BASE = (process.env.DHM_BASE_URL || '').replace(/\/+$/, '');
const PUBLIC_KEY = process.env.DHM_PUBLIC_KEY || '';
const PRIVATE_KEY = process.env.DHM_PRIVATE_KEY || '';

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

function nameKey(v) {
  return String(v ?? '').trim().toLowerCase();
}

function rowToInbound(row) {
  const short_name = shortKey(row.short_name);
  const name = String(row.name ?? '').trim();
  const typeRaw = String(row.type ?? 'Liquid').trim();
  const type = typeRaw === 'Solid' ? 'Solid' : 'Liquid';
  const uom = type === 'Liquid' ? 'KL' : 'MT';
  if (!short_name || !name) throw new Error('short_name and name are required');
  const payload = {
    short_name,
    long_name: name,
    type: hubCommodityTypeForPush(type),
    uom,
  };
  return { short_name, name, type, uom, payload };
}

function hubCfg() {
  return { baseUrl: BASE, publicKey: PUBLIC_KEY, privateKey: PRIVATE_KEY };
}

function linkageFromBody(body) {
  const code = body?.code ?? body?.record?.data?.code ?? null;
  return code ? String(code).trim() : null;
}

async function fetchHubIndex() {
  const records = await fetchAllSyncRecords(hubCfg(), 'commodity', normalizeHubCommodity);
  const metricIdByCode = { KL: 1, MT: 2 };
  const byShort = new Map();
  const byName = new Map();
  for (const hub of records) {
    if (hub.isDeleted || !hub.values?.name) continue;
    const expanded = expandCommodityValues(hub.values, metricIdByCode, null);
    const sn = shortKey(expanded.short_name);
    if (sn) byShort.set(sn, hub);
    byName.set(nameKey(hub.values.name), hub);
  }
  return { byShort, byName, count: records.length };
}

async function pushOne(inbound, hubMatch) {
  const cfg = hubCfg();
  const hubCode = hubMatch?.hubCode ? String(hubMatch.hubCode) : null;
  try {
    if (hubCode && UPDATE) {
      const { httpStatus, body } = await putInboundEntity(cfg, 'commodity', hubCode, inbound);
      if (httpStatus === 200 || httpStatus === 201) {
        return { status: 'updated', http: httpStatus, code: hubCode, message: body?.status ?? '' };
      }
      return {
        status: 'failed',
        http: httpStatus,
        code: hubCode,
        message: body?.message || body?.error || `HTTP ${httpStatus}`,
      };
    }
    if (hubCode && !UPDATE) {
      return { status: 'skipped', http: '', code: hubCode, message: 'short_name already in hub' };
    }
    const { httpStatus, body } = await postInboundEntity(cfg, 'commodity', inbound);
    const code = linkageFromBody(body);
    if (httpStatus === 201 || httpStatus === 200) {
      return { status: 'created', http: httpStatus, code: code ?? '', message: body?.status ?? '' };
    }
    if (httpStatus === 409 && code) {
      if (UPDATE) {
        const put = await putInboundEntity(cfg, 'commodity', code, inbound);
        if (put.httpStatus === 200 || put.httpStatus === 201) {
          return { status: 'updated', http: put.httpStatus, code, message: put.body?.status ?? 'linked' };
        }
      }
      return { status: 'duplicate', http: httpStatus, code, message: body?.message ?? 'duplicate' };
    }
    return {
      status: 'failed',
      http: httpStatus,
      code: code ?? '',
      message: body?.message || body?.error || `HTTP ${httpStatus}`,
    };
  } catch (err) {
    return { status: 'failed', http: err.status ?? 0, code: '', message: String(err.message) };
  }
}

async function runPool(items, size, worker) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next;
        next += 1;
        out[i] = await worker(items[i], i);
      }
    })
  );
  return out;
}

const table = parseCsv(fs.readFileSync(CSV, 'utf8'));
const headers = table[0].map((h) => h.trim().toLowerCase());
const idx = (col) => headers.indexOf(col);
let rows = table.slice(1).map((cells) => ({
  short_name: cells[idx('short_name')] ?? '',
  name: cells[idx('name')] ?? '',
  type: cells[idx('type')] ?? 'Liquid',
}));
if (LIMIT > 0) rows = rows.slice(0, LIMIT);

const payloads = rows.map((r) => ({ row: r, inbound: rowToInbound(r) }));

if (DRY_RUN) {
  console.log(JSON.stringify(payloads.slice(0, 3).map((p) => p.inbound.payload ?? p.inbound), null, 2));
  console.log(`… ${payloads.length} commodities total`);
  process.exit(0);
}

if (!BASE || !PUBLIC_KEY || !PRIVATE_KEY) {
  console.error('Set DHM_BASE_URL, DHM_PUBLIC_KEY and DHM_PRIVATE_KEY.');
  process.exit(1);
}

const { byShort, byName, count: hubCount } = await fetchHubIndex();
console.log(`Hub has ${hubCount} commodity sync records; pushing ${payloads.length} from CSV`);

const results = await runPool(payloads, 3, async ({ row, inbound }) => {
  const hub =
    byShort.get(shortKey(inbound.short_name)) ?? byName.get(nameKey(inbound.name)) ?? null;
  const result = await pushOne(inbound.payload ?? inbound, hub);
  return {
    short_name: inbound.short_name,
    name: inbound.name,
    ...result,
  };
});

const esc = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
fs.writeFileSync(
  RESULTS,
  ['short_name,name,status,http,code,message']
    .concat(results.map((r) => [r.short_name, r.name, r.status, r.http, r.code, r.message].map(esc).join(',')))
    .join('\n') + '\n'
);

const tally = {};
for (const r of results) tally[r.status] = (tally[r.status] ?? 0) + 1;
console.log(tally);
console.log(`results written to ${RESULTS}`);
for (const r of results.filter((x) => x.status === 'failed')) {
  console.log(`FAILED ${r.short_name}: ${r.http} ${r.message}`);
}
