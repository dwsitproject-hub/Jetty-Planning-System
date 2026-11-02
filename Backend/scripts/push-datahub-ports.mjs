/**
 * Push port names to DataHub port_master (inbound POST).
 *
 *   node scripts/push-datahub-ports.mjs --site-id SITE-0001 [options] [names.txt]
 *
 * Credentials: effective DataHub config from DB (DATABASE_URL + Backend/.env) or
 * DHM_BASE_URL, DHM_PUBLIC_KEY, DHM_PRIVATE_KEY.
 *
 * Options:
 *   --site-id CODE     Required DHM site code for every port (unless row has hub_site_id)
 *   --country TEXT     Default country on push when not in DB (default: Indonesia)
 *   --from-db          Merge unlocode/country/hub_code from JPS ports by name match
 *   --link-db          After success, write hub_code (+ site) back to matching JPS port row
 *   --dry-run          Print payloads only
 *   --limit N          Push at most N ports
 *
 * If no names file is given, uses the built-in Exim port list.
 */
import fs from 'node:fs';
import path from 'node:path';
import 'dotenv/config';
import { pool } from '../src/db.js';
import { getEffectiveDataHubConfig } from '../src/lib/datahub-config.js';
import {
  fetchAllSyncRecords,
  normalizeHubPortMaster,
} from '../src/lib/datahub-client.js';
import { pushPortToDataHub, localPortToHubPayload } from '../src/lib/datahub-port-push.js';
import { hubRecordToLinkage } from '../src/lib/datahub-vessel-linkage.js';

const DEFAULT_PORTS = [
  'PORT ASIKE',
  'PORT BATAM',
  'PORT BELANG BELANG',
  'PORT BELINYU',
  'PORT BONTANG',
  'PORT BUDONG BUDONG',
  'PORT BULUNGAN',
  'PORT BUNGKUTOKO',
  'PORT DUMAI',
  'PORT HUK SUNGAI LILIN',
  'PORT KENDAWANGAN',
  'PORT KETAPANG',
  'PORT KUBU',
  'PORT KUBU RAYA',
  'PORT KUMAI',
  'PORT KUMALINGON, LEOK',
  'PORT LABANAN',
  'PORT LEMPAKE',
  'PORT LOKTUAN',
  'PORT MALOY',
  'PORT MAMUJU',
  'PORT MANUBAR',
  'PORT MARABAHAN',
  'PORT MARUNDA CENTRAL (MCT)',
  'PORT MATAN',
  'PORT MERAUKE',
  'PORT MUARA KAMAN',
  'PORT NUNUKAN',
  'PORT BONE MANJING',
  'PORT PANGKAL BALAM',
  'PORT PELINDO KIJING',
  'PORT PENGANDAN',
  'PORT PENITI',
  'PORT PONDONG',
  'PORT SADAI',
  'PORT SANGKULIRANG',
  'PORT SEBAKIS',
  'PORT SEBULU',
  'PORT SEI MATAN',
  'PORT SINTANG',
  'PORT SUNGAI GUNTUNG',
  'PORT TALANG DUKU',
  'PORT TANJUNG API-API',
  'PORT TANJUNG BATU - BERAU',
  'PORT TANJUNG PRIOK',
  'PORT TAYAN',
];

const argv = process.argv.slice(2);
const takeFlag = (name) => {
  const i = argv.indexOf(name);
  if (i === -1) return null;
  const v = argv[i + 1] ?? null;
  argv.splice(i, v != null && !v.startsWith('--') ? 2 : 1);
  return v != null && !v.startsWith('--') ? v : true;
};

const SITE_ID = takeFlag('--site-id') || process.env.DHM_DEFAULT_SITE_ID || null;
const DEFAULT_COUNTRY = takeFlag('--country') || 'Indonesia';
const FROM_DB = argv.includes('--from-db');
const LINK_DB = argv.includes('--link-db');
const DRY_RUN = argv.includes('--dry-run');
const LIMIT = Number(takeFlag('--limit') ?? 0);
const positional = argv.filter((a) => !a.startsWith('--'));

const RESULTS = path.join(import.meta.dirname, '..', 'exports', 'datahub', 'ports-push-results.csv');

function normName(s) {
  return String(s || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

function loadNames() {
  if (positional[0]) {
    const text = fs.readFileSync(path.resolve(positional[0]), 'utf8');
    return text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
  }
  return [...DEFAULT_PORTS];
}

async function cfgFromDbOrEnv() {
  try {
    const cfg = await getEffectiveDataHubConfig(pool);
    if (cfg?.enabled && cfg.publicKey && cfg.privateKey) return cfg;
  } catch {
    /* fall through */
  }
  const baseUrl = process.env.DHM_BASE_URL?.trim();
  const publicKey = process.env.DHM_PUBLIC_KEY?.trim();
  const privateKey = process.env.DHM_PRIVATE_KEY?.trim();
  if (!baseUrl || !publicKey || !privateKey) return null;
  return { baseUrl, publicKey, privateKey, enabled: true };
}

async function loadDbPortsByName() {
  const r = await pool.query(
    `SELECT id, name, unlocode, country, hub_code, hub_site_id, is_active
     FROM ports WHERE deleted_at IS NULL`
  );
  const map = new Map();
  for (const row of r.rows) {
    map.set(normName(row.name), row);
  }
  return map;
}

async function fetchExistingHubNames(cfg) {
  try {
    const records = await fetchAllSyncRecords(cfg, 'port_master', normalizeHubPortMaster);
    return new Set(records.map((r) => normName(r.values?.name)).filter(Boolean));
  } catch (e) {
    if (e.status === 403) {
      console.warn('Warning: sync/port_master not allowlisted — skipping pre-check; POST may still work.');
      return null;
    }
    throw e;
  }
}

async function linkPortRow(portId, linkage, siteId) {
  if (!LINK_DB || !portId || !linkage?.hubCode) return;
  await pool.query(
    `UPDATE ports SET
       hub_code = $1,
       hub_record_id = COALESCE($2, hub_record_id),
       hub_version = COALESCE($3, hub_version),
       hub_updated_at = COALESCE($4::timestamptz, hub_updated_at),
       hub_site_id = COALESCE(hub_site_id, $5),
       updated_at = NOW()
     WHERE id = $6 AND deleted_at IS NULL`,
    [
      linkage.hubCode,
      linkage.hubRecordId ?? null,
      linkage.hubVersion ?? null,
      linkage.hubUpdatedAt ?? null,
      SITE_ID,
      portId,
    ]
  );
}

async function main() {
  const names = loadNames();
  if (!SITE_ID) {
    console.error('Required: --site-id SITE-NNNN (DHM site code) or env DHM_DEFAULT_SITE_ID');
    console.error('port_master inbound requires site_id — ask your DHM integrator for the site code.');
    process.exit(1);
  }

  const rows = names.map((name) => ({
    name: name.trim(),
    country: DEFAULT_COUNTRY,
    is_active: true,
  }));

  if (FROM_DB || LINK_DB) {
    const byName = await loadDbPortsByName();
    for (const row of rows) {
      const local = byName.get(normName(row.name));
      if (!local) continue;
      row.id = local.id;
      if (local.unlocode) row.unlocode = local.unlocode;
      if (local.country) row.country = local.country;
      if (local.hub_code) row.hub_code = local.hub_code;
      if (local.hub_site_id) row.hub_site_id = local.hub_site_id;
      row.is_active = local.is_active !== false;
    }
  }

  let todo = rows;
  if (LIMIT > 0) todo = todo.slice(0, LIMIT);

  if (DRY_RUN) {
    for (const row of todo) {
      console.log(JSON.stringify(localPortToHubPayload(row, SITE_ID).payload));
    }
    console.log(`… ${todo.length} payload(s)`);
    await pool.end().catch(() => {});
    return;
  }

  const cfg = await cfgFromDbOrEnv();
  if (!cfg) {
    console.error('DataHub not configured (DB row or DHM_* env).');
    process.exit(1);
  }

  const existing = await fetchExistingHubNames(cfg);
  if (existing) {
    todo = todo.filter((r) => !existing.has(normName(r.name)));
    console.log(`${names.length} requested, ${existing.size} already in hub sync, pushing ${todo.length}`);
  } else {
    console.log(`Pushing ${todo.length} port(s) to ${cfg.baseUrl}`);
  }

  const results = [];
  for (const row of todo) {
    const siteForRow = row.hub_site_id || SITE_ID;
    try {
      const push = await pushPortToDataHub(cfg, row, siteForRow);
      const linkage = push.linkage ?? hubRecordToLinkage(null);
      if (push.ok && push.linkage) {
        await linkPortRow(row.id, push.linkage, siteForRow);
      }
      results.push({
        name: row.name,
        status: push.ok ? push.message || 'ok' : 'failed',
        http: push.httpStatus ?? '',
        code: push.linkage?.hubCode ?? '',
        message: push.message ?? '',
      });
      console.log(`${push.ok ? 'OK' : 'FAIL'} ${row.name} ${push.httpStatus} ${push.linkage?.hubCode ?? ''} ${push.message ?? ''}`);
    } catch (e) {
      results.push({
        name: row.name,
        status: 'failed',
        http: e.status ?? '',
        code: '',
        message: e.message,
      });
      console.log(`FAIL ${row.name} ${e.message}`);
    }
  }

  fs.mkdirSync(path.dirname(RESULTS), { recursive: true });
  const esc = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  fs.writeFileSync(
    RESULTS,
    ['Port Name,Status,HTTP,Hub Code,Message']
      .concat(results.map((r) => [r.name, r.status, r.http, r.code, r.message].map(esc).join(',')))
      .join('\n') + '\n'
  );
  console.log(`Results: ${RESULTS}`);
  await pool.end().catch(() => {});
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
