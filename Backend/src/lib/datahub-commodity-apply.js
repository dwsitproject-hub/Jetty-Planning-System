import { COMMODITY_COMPARED_COLUMNS } from './datahub-commodity-sync.js';

/**
 * @param {import('pg').PoolClient} db
 * @param {{ vessel_id: number|null, payload: object }} item
 * @param {number|null} actorId
 * @param {{ applySource?: string|null, applyRunId?: number|null }} [opts]
 */
export async function applyCommodityItem(db, item, actorId, opts = {}) {
  const { applySource = null, applyRunId = null } = opts;
  const payload = item.payload || {};
  const values = payload.values || {};
  const name = String(values.name ?? '').trim();
  if (!name) throw new Error('Commodity name is required');

  let targetId = item.vessel_id != null ? Number(item.vessel_id) : null;
  if (targetId != null) {
    const still = await db.query(
      `SELECT id FROM si_commodities WHERE id = $1 AND deleted_at IS NULL`,
      [targetId]
    );
    if (still.rows.length === 0) targetId = null;
  }
  if (targetId == null) {
    const byName = await db.query(
      `SELECT id FROM si_commodities WHERE LOWER(name) = LOWER($1) AND deleted_at IS NULL`,
      [name]
    );
    targetId = byName.rows[0]?.id != null ? Number(byName.rows[0].id) : null;
  }

  const shortName = String(values.short_name ?? '').trim().toUpperCase();
  const commodityType = values.commodity_type === 'Solid' ? 'Solid' : 'Liquid';
  const klFactor = values.kl_to_mt_factor != null ? Number(values.kl_to_mt_factor) : null;
  const defaultMetricId =
    values.default_metric_id != null ? Number(values.default_metric_id) : null;
  const hsCode = values.hs_code ?? null;

  const hubArgs = [
    payload.hubCode ?? null,
    payload.hubRecordId ?? null,
    payload.hubVersion ?? null,
    payload.hubUpdatedAt ?? null,
  ];
  const auditSource = applySource || null;
  const auditRunId = applyRunId != null ? Number(applyRunId) : null;

  if (targetId == null) {
    const inserted = await db.query(
      `INSERT INTO si_commodities (
         name, short_name, commodity_type, kl_to_mt_factor, default_metric_id, hs_code, sort_order,
         hub_code, hub_record_id, hub_version, hub_updated_at,
         datahub_last_apply_source, datahub_last_apply_run_id,
         created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,0,$7,$8,$9,$10,$11,$12,$13,$13)
       RETURNING id`,
      [
        name,
        shortName,
        commodityType,
        klFactor,
        defaultMetricId,
        hsCode,
        ...hubArgs,
        auditSource,
        auditRunId,
        actorId ?? null,
      ]
    );
    return { action: 'created', id: Number(inserted.rows[0].id) };
  }

  await db.query(
    `UPDATE si_commodities SET
       name = $1,
       short_name = COALESCE(NULLIF($2, ''), short_name),
       commodity_type = $3,
       kl_to_mt_factor = COALESCE($4, kl_to_mt_factor),
       default_metric_id = COALESCE($5, default_metric_id),
       hs_code = COALESCE($6, hs_code),
       hub_code = COALESCE($7, hub_code),
       hub_record_id = COALESCE($8, hub_record_id),
       hub_version = COALESCE($9, hub_version),
       hub_updated_at = COALESCE($10, hub_updated_at),
       datahub_last_apply_source = $11,
       datahub_last_apply_run_id = $12,
       updated_by = $13,
       updated_at = NOW()
     WHERE id = $14`,
    [
      name,
      shortName,
      commodityType,
      klFactor,
      defaultMetricId,
      hsCode,
      ...hubArgs,
      auditSource,
      auditRunId,
      actorId ?? null,
      targetId,
    ]
  );
  return { action: 'updated', id: targetId };
}

export { COMMODITY_COMPARED_COLUMNS };
