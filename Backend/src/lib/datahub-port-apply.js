/**
 * Apply staged port_master sync items to ports.
 */
export async function applyPortItem(db, item, actorId, opts = {}) {
  const { applySource = null, applyRunId = null } = opts;
  const payload = item.payload || {};
  const values = payload.values || {};
  const name = String(values.name ?? '').trim();
  if (!name) throw new Error('Port name is required');

  let targetId = item.vessel_id != null ? Number(item.vessel_id) : null;
  if (targetId != null) {
    const still = await db.query(`SELECT id FROM ports WHERE id = $1 AND deleted_at IS NULL`, [targetId]);
    if (still.rows.length === 0) targetId = null;
  }
  if (targetId == null) {
    const byName = await db.query(
      `SELECT id FROM ports WHERE LOWER(name) = LOWER($1) AND deleted_at IS NULL`,
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
  const unlocode = values.unlocode ?? null;
  const country = values.country ?? null;
  const isActive = values.is_active !== false;
  const hubSiteId = values.hub_site_id ?? null;
  const auditSource = applySource || null;
  const auditRunId = applyRunId != null ? Number(applyRunId) : null;

  if (targetId == null) {
    const inserted = await db.query(
      `INSERT INTO ports (
         name, description, schedule_timezone, operational_day_start, allow_multi_jetty_berthing,
         unlocode, country, is_active, hub_site_id,
         hub_code, hub_record_id, hub_version, hub_updated_at,
         datahub_last_apply_source, datahub_last_apply_run_id,
         created_by, updated_by)
       VALUES ($1, NULL, 'Asia/Jakarta', '06:00:00', false,
               $2, $3, $4, $5,
               $6, $7, $8, $9,
               $10, $11,
               $12, $12)
       RETURNING id`,
      [
        name,
        unlocode,
        country,
        isActive,
        hubSiteId,
        ...hubArgs,
        auditSource,
        auditRunId,
        actorId ?? null,
      ]
    );
    return { action: 'created', id: Number(inserted.rows[0].id) };
  }

  await db.query(
    `UPDATE ports SET
       name = $1,
       unlocode = COALESCE($2, unlocode),
       country = COALESCE($3, country),
       is_active = $4,
       hub_site_id = COALESCE($5, hub_site_id),
       hub_code = COALESCE($6, hub_code),
       hub_record_id = COALESCE($7, hub_record_id),
       hub_version = COALESCE($8, hub_version),
       hub_updated_at = COALESCE($9::timestamptz, hub_updated_at),
       datahub_last_apply_source = $10,
       datahub_last_apply_run_id = $11,
       updated_by = $12,
       updated_at = NOW()
     WHERE id = $13`,
    [
      name,
      unlocode,
      country,
      isActive,
      hubSiteId,
      ...hubArgs,
      auditSource,
      auditRunId,
      actorId ?? null,
      targetId,
    ]
  );
  return { action: 'updated', id: targetId };
}
