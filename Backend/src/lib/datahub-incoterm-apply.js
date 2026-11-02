import { INCOTERM_COMPARED_COLUMNS } from './datahub-incoterm-sync.js';

/**
 * @param {import('pg').PoolClient} db
 * @param {{ vessel_id: number|null, payload: object }} item staged row
 * @param {number|null} actorId
 * @param {{ applySource?: string|null, applyRunId?: number|null }} [opts]
 */
export async function applyIncotermItem(db, item, actorId, opts = {}) {
  const { applySource = null, applyRunId = null } = opts;
  const payload = item.payload || {};
  const values = payload.values || {};
  const code = String(values.code ?? '').trim().toUpperCase();
  if (!code) throw new Error('Incoterm code is required');

  let targetId = item.vessel_id != null ? Number(item.vessel_id) : null;
  if (targetId != null) {
    const still = await db.query(
      `SELECT id FROM si_trade_terms WHERE id = $1 AND deleted_at IS NULL`,
      [targetId]
    );
    if (still.rows.length === 0) targetId = null;
  }
  // Same DataHub short name (Term): update existing row, never duplicate.
  if (targetId == null) {
    const byCode = await db.query(
      `SELECT id FROM si_trade_terms WHERE UPPER(code) = $1 AND deleted_at IS NULL`,
      [code]
    );
    targetId = byCode.rows[0]?.id != null ? Number(byCode.rows[0].id) : null;
  }

  const hubArgs = [
    payload.hubCode ?? null,
    payload.hubRecordId ?? null,
    payload.hubVersion ?? null,
    payload.hubUpdatedAt ?? null,
  ];
  const longName = values.long_name ?? null;
  const description = values.description ?? null;
  const auditSource = applySource || null;
  const auditRunId = applyRunId != null ? Number(applyRunId) : null;

  if (targetId == null) {
    const inserted = await db.query(
      `INSERT INTO si_trade_terms (
         code, long_name, description, sort_order,
         hub_code, hub_record_id, hub_version, hub_updated_at,
         datahub_last_apply_source, datahub_last_apply_run_id,
         created_by, updated_by)
       VALUES ($1,$2,$3,0,$4,$5,$6,$7,$8,$9,$10,$10)
       RETURNING id`,
      [
        code,
        longName,
        description,
        ...hubArgs,
        auditSource,
        auditRunId,
        actorId ?? null,
      ]
    );
    return { action: 'created', id: Number(inserted.rows[0].id) };
  }

  await db.query(
    `UPDATE si_trade_terms SET
       code = $1,
       long_name = COALESCE($2, long_name),
       description = COALESCE($3, description),
       hub_code = COALESCE($4, hub_code),
       hub_record_id = COALESCE($5, hub_record_id),
       hub_version = COALESCE($6, hub_version),
       hub_updated_at = COALESCE($7, hub_updated_at),
       datahub_last_apply_source = $8,
       datahub_last_apply_run_id = $9,
       updated_by = $10,
       updated_at = NOW()
     WHERE id = $11`,
    [
      code,
      longName,
      description,
      ...hubArgs,
      auditSource,
      auditRunId,
      actorId ?? null,
      targetId,
    ]
  );
  return { action: 'updated', id: targetId };
}

export { INCOTERM_COMPARED_COLUMNS };
