/**
 * Write DataHub golden-record linkage back onto a local master_vessels row.
 */

/**
 * @param {object|null|undefined} record inbound `record` from DHM (201/200/409)
 * @returns {{ hubCode: string|null, hubRecordId: string|null, hubVersion: number|null, hubUpdatedAt: string|null }|null}
 */
export function hubRecordToLinkage(record) {
  if (!record || typeof record !== 'object') return null;
  const data = record.data && typeof record.data === 'object' ? record.data : {};
  const hubCode = data.code != null ? String(data.code).trim() : null;
  if (!hubCode) return null;
  return {
    hubCode,
    hubRecordId: record.id != null ? String(record.id) : null,
    hubVersion: Number.isFinite(Number(record.version)) ? Number(record.version) : null,
    hubUpdatedAt: record.updatedAt ?? null,
  };
}

/**
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {number} vesselId
 * @param {{ hubCode: string, hubRecordId?: string|null, hubVersion?: number|null, hubUpdatedAt?: string|null }} linkage
 * @param {number|null} actorId
 */
export async function applyHubLinkage(db, vesselId, linkage, actorId = null) {
  if (!linkage?.hubCode) throw new Error('hubCode is required to apply linkage');
  await db.query(
    `UPDATE master_vessels SET
       hub_code = $1,
       hub_record_id = COALESCE($2, hub_record_id),
       hub_version = COALESCE($3, hub_version),
       hub_updated_at = COALESCE($4::timestamptz, hub_updated_at),
       updated_by = COALESCE($5, updated_by),
       updated_at = NOW()
     WHERE id = $6 AND deleted_at IS NULL`,
    [
      linkage.hubCode,
      linkage.hubRecordId ?? null,
      linkage.hubVersion ?? null,
      linkage.hubUpdatedAt ?? null,
      actorId,
      vesselId,
    ]
  );
}
