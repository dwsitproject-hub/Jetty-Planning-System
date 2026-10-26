/**
 * Apply staged company/organization sync items to master_companies.
 * Does not touch port_companies.
 */
export async function applyOrganizationItem(db, item, actorId, opts = {}) {
  const { applySource = null, applyRunId = null } = opts;
  const payload = item.payload || {};
  const values = payload.values || {};
  const name = String(values.name ?? '').trim();
  if (!name) throw new Error('Company name is required');

  let targetId = item.vessel_id != null ? Number(item.vessel_id) : null;
  if (targetId != null) {
    const still = await db.query(
      `SELECT id FROM master_companies WHERE id = $1 AND deleted_at IS NULL`,
      [targetId]
    );
    if (still.rows.length === 0) targetId = null;
  }
  if (targetId == null && payload.hubCode) {
    const byHub = await db.query(
      `SELECT id FROM master_companies WHERE hub_code = $1 AND deleted_at IS NULL`,
      [payload.hubCode]
    );
    targetId = byHub.rows[0]?.id != null ? Number(byHub.rows[0].id) : null;
  }
  if (targetId == null) {
    const byName = await db.query(
      `SELECT id FROM master_companies
       WHERE LOWER(name) = LOWER($1) AND hub_code IS NULL AND deleted_at IS NULL`,
      [name]
    );
    targetId = byName.rows[0]?.id != null ? Number(byName.rows[0].id) : null;
  }

  const hubArgs = [
    payload.hubCode ?? null,
    payload.hubRecordId ?? null,
    payload.hubVersion ?? null,
    payload.hubUpdatedAt ?? null,
  ];
  const shortName = values.short_name ?? null;
  const sapCode = values.company_code_sap ?? null;
  const country = values.country ?? null;
  const isActive = values.is_active !== false;
  const auditSource = applySource || null;
  const auditRunId = applyRunId != null ? Number(applyRunId) : null;

  if (targetId == null) {
    const inserted = await db.query(
      `INSERT INTO master_companies (
         name, short_name, company_code_sap, country, is_active,
         hub_code, hub_record_id, hub_version, hub_updated_at,
         datahub_last_apply_source, datahub_last_apply_run_id,
         created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)
       RETURNING id`,
      [name, shortName, sapCode, country, isActive, ...hubArgs, auditSource, auditRunId, actorId ?? null]
    );
    return { action: 'created', id: Number(inserted.rows[0].id) };
  }

  await db.query(
    `UPDATE master_companies SET
       name = $1,
       short_name = $2,
       company_code_sap = $3,
       country = $4,
       is_active = $5,
       hub_code = COALESCE($6, hub_code),
       hub_record_id = COALESCE($7, hub_record_id),
       hub_version = COALESCE($8, hub_version),
       hub_updated_at = COALESCE($9::timestamptz, hub_updated_at),
       datahub_last_apply_source = $10,
       datahub_last_apply_run_id = $11,
       updated_by = $12,
       updated_at = NOW()
     WHERE id = $13 AND deleted_at IS NULL`,
    [name, shortName, sapCode, country, isActive, ...hubArgs, auditSource, auditRunId, actorId ?? null, targetId]
  );
  return { action: 'updated', id: targetId };
}
