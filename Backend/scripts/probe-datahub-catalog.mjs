/**
 * Probe DHM catalog + sample sync for incoterm and commodity.
 *
 *   node scripts/probe-datahub-catalog.mjs
 *
 * Uses DHM_* env or effective config is not loaded here — set env vars.
 */
import {
  fetchEntityCatalog,
  fetchAllSyncRecords,
  normalizeHubIncoterm,
  normalizeHubCommodity,
  normalizeHubPortMaster,
} from '../src/lib/datahub-client.js';

function cfgFromEnv() {
  const baseUrl = process.env.DHM_BASE_URL?.trim();
  const publicKey = process.env.DHM_PUBLIC_KEY?.trim();
  const privateKey = process.env.DHM_PRIVATE_KEY?.trim();
  if (!baseUrl || !publicKey || !privateKey) {
    console.error('Set DHM_BASE_URL, DHM_PUBLIC_KEY, DHM_PRIVATE_KEY');
    process.exit(1);
  }
  return { baseUrl, publicKey, privateKey };
}

async function main() {
  const cfg = cfgFromEnv();
  for (const slug of ['incoterm', 'commodity', 'port_master']) {
    const catalog = await fetchEntityCatalog(cfg, slug);
    console.log('\n=== catalog', slug, '===');
    console.log(JSON.stringify(catalog, null, 2));
  }
  const inc = await fetchAllSyncRecords(cfg, 'incoterm', normalizeHubIncoterm);
  console.log('\n=== sync incoterm count', inc.length, 'sample ===');
  console.log(JSON.stringify(inc.slice(0, 3), null, 2));
  const cmd = await fetchAllSyncRecords(cfg, 'commodity', normalizeHubCommodity);
  console.log('\n=== sync commodity count', cmd.length, 'sample ===');
  console.log(JSON.stringify(cmd.slice(0, 3), null, 2));
  const ports = await fetchAllSyncRecords(cfg, 'port_master', normalizeHubPortMaster);
  console.log('\n=== sync port_master count', ports.length, 'sample ===');
  console.log(JSON.stringify(ports.slice(0, 3), null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
