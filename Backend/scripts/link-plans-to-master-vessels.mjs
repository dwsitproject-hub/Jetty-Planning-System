/**
 * One-time link of legacy shipment plans (master_vessel_id null) to master vessels by exact name.
 * Dry run by default; prints matched, ambiguous and unmatched plans. Writes only with --apply.
 * Plan vessel name and dimensions stay as recorded; only master_vessel_id is set.
 *
 *   docker compose ... exec jps-api node scripts/link-plans-to-master-vessels.mjs
 *   docker compose ... exec jps-api node scripts/link-plans-to-master-vessels.mjs --apply
 */
import 'dotenv/config';
import { pool } from '../src/db.js';
import { matchPlansToMasterVessels } from '../src/lib/plan-master-vessel-backfill.js';

const apply = process.argv.includes('--apply');

async function main() {
  const { rows: plans } = await pool.query(
    `SELECT id, vessel_name FROM shipment_plans
      WHERE master_vessel_id IS NULL AND deleted_at IS NULL ORDER BY id`
  );
  const { rows: vessels } = await pool.query(
    `SELECT id, vessel_name FROM master_vessels WHERE deleted_at IS NULL AND is_active`
  );
  const { matched, unmatched, ambiguous } = matchPlansToMasterVessels(plans, vessels);

  console.log(`Legacy plans: ${plans.length} · matched ${matched.length} · ambiguous ${ambiguous.length} · unmatched ${unmatched.length}`);
  for (const a of ambiguous) console.log(`AMBIGUOUS plan ${a.planId} "${a.vesselName}" → master ${a.masterVesselIds.join(', ')}`);
  const names = [...new Set(unmatched.map((u) => u.vesselName))].sort();
  for (const n of names) console.log(`UNMATCHED "${n}" (${unmatched.filter((u) => u.vesselName === n).length} plans)`);

  if (!apply) {
    console.log('Dry run: nothing written. Re-run with --apply to link the matched plans.');
    return;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const m of matched) {
      await client.query(
        `UPDATE shipment_plans SET master_vessel_id = $1, updated_at = NOW()
          WHERE id = $2 AND master_vessel_id IS NULL`,
        [m.masterVesselId, m.planId]
      );
    }
    await client.query('COMMIT');
    console.log(`Linked ${matched.length} plans.`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

main()
  .catch((err) => {
    console.error(err?.message || err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
