#!/usr/bin/env node
/**
 * Seed tank_gauging_tank_map from external_tank_id:code pairs.
 * Usage:
 *   node scripts/seed-tank-gauging-map.js --portId=1 --pairs=1:302,2:1501,3:5005
 */
import 'dotenv/config';
import { pool, verifyConnection } from '../src/db.js';

function parseArgs(argv) {
  let portId = null;
  let pairsRaw = '';
  for (const arg of argv) {
    if (arg.startsWith('--portId=')) portId = Number(arg.slice('--portId='.length));
    if (arg.startsWith('--pairs=')) pairsRaw = arg.slice('--pairs='.length);
  }
  return { portId, pairsRaw };
}

function parsePairs(raw) {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((part) => {
      const [idPart, codePart] = part.split(':');
      const externalTankId = Number.parseInt(idPart, 10);
      const code = String(codePart || '').trim();
      if (!Number.isFinite(externalTankId) || !code) {
        throw new Error(`Invalid pair '${part}' (expected externalId:code)`);
      }
      return { externalTankId, code };
    });
}

async function main() {
  const { portId, pairsRaw } = parseArgs(process.argv.slice(2));
  if (!Number.isFinite(portId) || portId <= 0) {
    console.error('Usage: node scripts/seed-tank-gauging-map.js --portId=1 --pairs=1:302,2:1501');
    process.exit(1);
  }
  const pairs = parsePairs(pairsRaw);
  if (!pairs.length) {
    console.error('No pairs provided');
    process.exit(1);
  }

  await verifyConnection();
  const client = await pool.connect();
  const results = [];
  try {
    await client.query('BEGIN');
    for (const { externalTankId, code } of pairs) {
      const tank = await client.query(
        `SELECT id FROM master_tanks
         WHERE port_id = $1 AND deleted_at IS NULL AND LOWER(code) = LOWER($2)
         LIMIT 1`,
        [portId, code]
      );
      if (!tank.rows[0]) {
        results.push({ externalTankId, code, ok: false, error: 'tank_not_found' });
        continue;
      }
      const tankId = tank.rows[0].id;
      await client.query(
        `INSERT INTO tank_gauging_tank_map (port_id, external_tank_id, tank_id, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (port_id, external_tank_id) DO UPDATE SET
           tank_id = EXCLUDED.tank_id,
           updated_at = NOW()`,
        [portId, externalTankId, tankId]
      );
      results.push({ externalTankId, code, tankId: String(tankId), ok: true });
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  console.log(JSON.stringify({ portId, results }, null, 2));
  await pool.end();
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}

main().catch((err) => {
  console.error('[seed-tank-gauging-map]', err?.message || err);
  process.exit(1);
});
