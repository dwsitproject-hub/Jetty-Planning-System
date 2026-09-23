/**
 * Push the DHM vessel-master CSV into DataHub via the documented client API.
 *
 *   node scripts/push-datahub-vessels.mjs [vessels.csv]
 *
 * Defaults to Backend/exports/datahub/vessels-from-workbook-typed.csv.
 *
 * Credentials come from the environment:
 *
 *   DHM_BASE_URL       base of the /v1 API (not the portal), e.g. http://host:2001/api
 *   DHM_PUBLIC_KEY     dhm_pk_…
 *   DHM_PRIVATE_KEY    dhm_sk_…
 *
 * Uses the shared datahub-client (Bearer token auth). Existing vessels are read
 * from /v1/sync/vessel and skipped by Vessel_Name.
 *
 * `code` is never sent: DHM assigns VSL-NNNN on create.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fetchAllVessels, postInboundVessel } from '../src/lib/datahub-client.js';

const argv = process.argv.slice(2);
const takeFlag = (name) => {
  const i = argv.indexOf(name);
  if (i === -1) return null;
  const v = argv[i + 1] ?? null;
  argv.splice(i, 2);
  return v;
};
const EMIT = takeFlag('--emit-payloads');
const LIMIT = Number(takeFlag('--limit') ?? 0);
const DRY_RUN = argv.includes('--dry-run');
const positional = argv.filter((a) => !a.startsWith('--'));

const CSV =
  positional[0] ||
  path.join(import.meta.dirname, '..', 'exports', 'datahub', 'vessels-from-workbook-typed.csv');
const RESULTS = path.join(import.meta.dirname, '..', 'exports', 'datahub', 'push-results.csv');

const BASE = (process.env.DHM_BASE_URL || '').replace(/\/+$/, '');
const PUBLIC_KEY = process.env.DHM_PUBLIC_KEY || '';
const PRIVATE_KEY = process.env.DHM_PRIVATE_KEY || '';

/** CSV header label -> canonical hub field key, per the vessel contract. */
const FIELD = {
  'Vessel Name': 'Vessel_Name',
  'Vessel IMO': 'Vessel_IMO',
  'Vessel MMSI': 'Vessel_MMSI',
  'Vessel Code SAP': 'Vessel_Code_SAP',
  'Vessel Capacity MT': 'Vessel_Capacity_MT',
  'Vessel Gross Tonnage': 'Vessel_Gross_Tonnage',
  'Vessel Draft': 'Vessel_Draft',
  'Vessel Length Overral': 'Vessel_Length_Overral',
  'Vessel Type': 'Vessel_Type',
  Heater: 'Heater',
  'Type lambung': 'Type_lambung',
  'Type Charter': 'Type_Charter',
};
const NUMERIC = new Set(['Vessel_Capacity_MT', 'Vessel_Gross_Tonnage', 'Vessel_Draft']);

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

function toPayload(headers, cells) {
  const data = {};
  headers.forEach((h, i) => {
    const key = FIELD[h.trim()];
    const raw = (cells[i] ?? '').trim();
    if (!key || raw === '') return;
    if (key === 'Heater') data[key] = raw.toLowerCase() === 'true';
    else if (NUMERIC.has(key)) {
      const n = Number(raw.replace(/,/g, ''));
      if (Number.isFinite(n)) data[key] = n;
    } else data[key] = raw;
  });
  return data;
}

function hubCfg() {
  return { baseUrl: BASE, publicKey: PUBLIC_KEY, privateKey: PRIVATE_KEY };
}

async function fetchExistingNames() {
  const vessels = await fetchAllVessels(hubCfg());
  return new Set(vessels.map((v) => v.values?.vessel_name).filter(Boolean));
}

async function postVessel(data) {
  try {
    const { httpStatus, body } = await postInboundVessel(hubCfg(), data);
    const message = body?.message || body?.error || '';
    if (httpStatus === 409 || /already exists/i.test(message)) {
      return {
        status: 'duplicate',
        http: httpStatus,
        code: body?.code ?? body?.record?.data?.code ?? '',
        message: body?.status || message,
      };
    }
    if (httpStatus === 201 || httpStatus === 200) {
      return {
        status: httpStatus === 201 ? 'created' : 'updated',
        http: httpStatus,
        code: body?.code ?? body?.record?.data?.code ?? '',
        message: body?.status ?? '',
      };
    }
    return { status: 'failed', http: httpStatus, code: '', message: message || `HTTP ${httpStatus}` };
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

const rows = parseCsv(fs.readFileSync(CSV, 'utf8'));
const headers = rows[0];
let payloads = rows.slice(1).map((cells) => toPayload(headers, cells));
if (LIMIT > 0) payloads = payloads.slice(0, LIMIT);

if (EMIT) {
  fs.writeFileSync(EMIT, JSON.stringify(payloads, null, 1));
  console.log(`wrote ${payloads.length} payloads to ${EMIT}`);
  process.exit(0);
}

if (DRY_RUN) {
  console.log(JSON.stringify(payloads.slice(0, 5), null, 1));
  console.log(`… ${payloads.length} payloads total`);
  process.exit(0);
}

if (!BASE || !PUBLIC_KEY || !PRIVATE_KEY) {
  console.error('Set DHM_BASE_URL, DHM_PUBLIC_KEY and DHM_PRIVATE_KEY.');
  process.exit(1);
}

const existing = await fetchExistingNames();
const todo = payloads.filter((p) => !existing.has(p.Vessel_Name));
console.log(`${payloads.length} in CSV, ${existing.size} already in hub, pushing ${todo.length}`);

const results = await runPool(todo, 4, async (data) => {
  try {
    return { name: data.Vessel_Name, ...(await postVessel(data)) };
  } catch (err) {
    return { name: data.Vessel_Name, status: 'failed', http: 0, code: '', message: String(err) };
  }
});

const esc = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const skipped = payloads
  .filter((p) => existing.has(p.Vessel_Name))
  .map((p) => ({ name: p.Vessel_Name, status: 'skipped', http: '', code: '', message: 'already in hub' }));
fs.writeFileSync(
  RESULTS,
  ['Vessel Name,Status,HTTP,Code,Message']
    .concat([...skipped, ...results].map((r) => [r.name, r.status, r.http, r.code, r.message].map(esc).join(',')))
    .join('\n') + '\n'
);

const tally = {};
for (const r of [...skipped, ...results]) tally[r.status] = (tally[r.status] ?? 0) + 1;
console.log(tally);
console.log(`results written to ${RESULTS}`);
for (const r of results.filter((x) => x.status === 'failed')) console.log(`FAILED ${r.name}: ${r.http} ${r.message}`);
