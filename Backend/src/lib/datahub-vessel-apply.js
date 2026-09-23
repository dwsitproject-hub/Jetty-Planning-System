/**
 * Write one approved staged item into master_vessels.
 *
 * Split out of routes/master-vessels.js so the upsert can be exercised directly
 * against a database without going through HTTP.
 */
import { COMPARED_COLUMNS } from './datahub-vessel-sync.js';

/**
 * @param {import('pg').PoolClient} db a client already inside a transaction
 * @param {{ vessel_id: number|null, vessel_name: string, payload: object }} item
 * @param {number | null} actorId
 * @returns {Promise<{ action: 'created' | 'updated', vesselId: number }>}
 */
export async function applyVesselItem(db, item, actorId) {
  const payload = item.payload || {};
  const values = payload.values || {};
  const cols = COMPARED_COLUMNS;
  const vals = cols.map((c) => (values[c] === undefined ? null : values[c]));

  // Re-resolve the target: the replica may have moved since the run was staged.
  let targetId = item.vessel_id != null ? Number(item.vessel_id) : null;
  if (targetId != null) {
    const still = await db.query(
      `SELECT id FROM master_vessels WHERE id = $1 AND deleted_at IS NULL`,
      [targetId]
    );
    if (still.rows.length === 0) targetId = null;
  }
  if (targetId == null) {
    const byName = await db.query(
      `SELECT id FROM master_vessels WHERE LOWER(vessel_name) = LOWER($1) AND deleted_at IS NULL`,
      [item.vessel_name]
    );
    targetId = byName.rows[0]?.id != null ? Number(byName.rows[0].id) : null;
  }

  const hubArgs = [
    payload.hubCode ?? null,
    payload.hubRecordId ?? null,
    payload.hubVersion ?? null,
    payload.hubUpdatedAt ?? null,
  ];
  const n = cols.length;

  if (targetId == null) {
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
    const inserted = await db.query(
      `INSERT INTO master_vessels (${cols.join(', ')},
         hub_code, hub_record_id, hub_version, hub_updated_at, created_by, updated_by)
       VALUES (${placeholders}, $${n + 1}, $${n + 2}, $${n + 3}, $${n + 4}, $${n + 5}, $${n + 5})
       RETURNING id`,
      [...vals, ...hubArgs, actorId ?? null]
    );
    return { action: 'created', vesselId: Number(inserted.rows[0].id) };
  }

  const assignments = cols.map((c, i) => `${c} = $${i + 1}`).join(', ');
  await db.query(
    `UPDATE master_vessels SET ${assignments},
       hub_code = COALESCE($${n + 1}, hub_code),
       hub_record_id = COALESCE($${n + 2}, hub_record_id),
       hub_version = COALESCE($${n + 3}, hub_version),
       hub_updated_at = COALESCE($${n + 4}, hub_updated_at),
       updated_by = $${n + 5},
       updated_at = NOW()
     WHERE id = $${n + 6}`,
    [...vals, ...hubArgs, actorId ?? null, targetId]
  );
  return { action: 'updated', vesselId: targetId };
}
