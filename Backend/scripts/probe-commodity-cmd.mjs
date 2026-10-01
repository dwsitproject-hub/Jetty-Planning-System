/**
 * Print sync payload for one commodity hub code (field keys + uom-related values).
 *   node scripts/probe-commodity-cmd.mjs CMD-0006
 */
import 'dotenv/config';
import { pool } from '../src/db.js';
import { getEffectiveDataHubConfig } from '../src/lib/datahub-config.js';
import { fetchAllSyncRecords, normalizeHubCommodity } from '../src/lib/datahub-client.js';

const code = (process.argv[2] || 'CMD-0006').trim().toUpperCase();

const cfg = await getEffectiveDataHubConfig(pool);
if (!cfg?.enabled) {
  console.error('DataHub not configured');
  process.exit(1);
}

const records = await fetchAllSyncRecords(cfg, 'commodity', (r) => r);
const match = records.find((r) => {
  const c = r?.data?.code ?? r?.data?.Code;
  return c && String(c).toUpperCase() === code;
});

if (!match) {
  console.log('No sync record for', code, 'among', records.length, 'commodities');
  await pool.end();
  process.exit(1);
}

console.log('Raw data keys:', Object.keys(match.data || {}));
console.log('Raw data:', JSON.stringify(match.data, null, 2));
const norm = normalizeHubCommodity(match);
console.log('Normalized:', JSON.stringify(norm, null, 2));
await pool.end();
