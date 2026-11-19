/**
 * DB side of cargo segment movement type: Kuras rules per port, manual tag carry-over
 * across segment re-saves, and auto re-tagging of a voyage after any cargo save.
 */
import { classifyKurasSegments } from './kuras-movement.js';

const toIso = (v) => (v ? new Date(v).toISOString() : null);

/** Active + inactive rules of a port, with their commodities. */
export async function loadKurasRules(db, portId) {
  const r = await db.query(
    `SELECT r.id, r.port_id, r.is_default, r.remaining_pct_below, r.rate_mt_per_hour_below,
            r.match_mode, r.is_active,
            COALESCE(array_agg(rc.commodity_id ORDER BY sc.short_name) FILTER (WHERE rc.commodity_id IS NOT NULL), '{}') AS commodity_ids,
            COALESCE(array_agg(COALESCE(NULLIF(TRIM(sc.short_name), ''), sc.name) ORDER BY sc.short_name)
              FILTER (WHERE rc.commodity_id IS NOT NULL), '{}') AS commodity_labels
     FROM master_kuras_rules r
     LEFT JOIN master_kuras_rule_commodities rc ON rc.rule_id = r.id
     LEFT JOIN si_commodities sc ON sc.id = rc.commodity_id
     WHERE r.port_id = $1 AND r.deleted_at IS NULL
     GROUP BY r.id`,
    [portId]
  );
  return r.rows.map((row) => ({
    id: Number(row.id),
    isDefault: row.is_default === true,
    isActive: row.is_active === true,
    remainingPctBelow: Number(row.remaining_pct_below),
    rateMtPerHourBelow: Number(row.rate_mt_per_hour_below),
    matchMode: row.match_mode,
    commodityIds: row.commodity_ids.map(Number),
    commodityLabels: row.commodity_labels,
  }));
}

/** Stored tags of an activity's segments, keyed by segment start, for carry-over on re-save. */
export async function loadPriorMovementTags(db, activityId) {
  const out = new Map();
  if (activityId == null) return out;
  const r = await db.query(
    `SELECT started_at, movement_type, movement_type_source, movement_type_reason,
            movement_type_set_by, movement_type_set_at
     FROM operation_cargo_load_lines WHERE operational_activity_id = $1`,
    [activityId]
  );
  for (const row of r.rows) out.set(toIso(row.started_at), row);
  return out;
}

/**
 * Columns to store for one segment. `requested` is the payload value: undefined keeps the
 * stored tag (operator app does not send it), 'auto' hands back to the rule, else manual.
 */
export function resolveMovementTypeColumns(requested, prior, actorUserId) {
  if (requested === undefined && prior) {
    return {
      movementType: prior.movement_type,
      source: prior.movement_type_source,
      reason: prior.movement_type_reason,
      setBy: prior.movement_type_set_by,
      setAt: prior.movement_type_set_at,
    };
  }
  if (requested === undefined || requested === 'auto') {
    return { movementType: null, source: 'auto', reason: null, setBy: null, setAt: null };
  }
  const unchanged = prior?.movement_type_source === 'manual' && prior.movement_type === requested;
  return {
    movementType: requested,
    source: 'manual',
    reason: { code: 'manual' },
    setBy: unchanged ? prior.movement_type_set_by : actorUserId,
    setAt: unchanged ? prior.movement_type_set_at : new Date().toISOString(),
  };
}

async function loadVoyageContext(db, operationId) {
  const r = await db.query(
    `SELECT COALESCE(o.port_id, j.port_id) AS port_id,
            (SELECT SUM(b.qty::numeric) FROM shipping_instruction_breakdown b
             WHERE b.shipping_instruction_id = si.id AND b.deleted_at IS NULL) AS si_qty,
            (SELECT UPPER(m.code) FROM shipping_instruction_breakdown b
             LEFT JOIN metric m ON m.id = b.metric_id AND m.deleted_at IS NULL
             WHERE b.shipping_instruction_id = si.id AND b.deleted_at IS NULL
             ORDER BY b.line_order, b.id LIMIT 1) AS si_metric
     FROM operations o
     LEFT JOIN jetties j ON j.id = o.jetty_id AND j.deleted_at IS NULL
     JOIN shipping_instructions si ON si.id = o.shipping_instruction_id AND si.deleted_at IS NULL
     WHERE o.id = $1 AND o.deleted_at IS NULL`,
    [operationId]
  );
  const row = r.rows[0];
  if (!row?.port_id) return null;
  const products = await db.query(
    `SELECT b.commodity_id, SUM(b.qty::numeric) AS planned_qty, MAX(sc.kl_to_mt_factor) AS kl_to_mt_factor
     FROM operations o
     JOIN shipping_instruction_breakdown b ON b.shipping_instruction_id = o.shipping_instruction_id AND b.deleted_at IS NULL
     JOIN si_commodities sc ON sc.id = b.commodity_id
     WHERE o.id = $1
     GROUP BY b.commodity_id`,
    [operationId]
  );
  return {
    portId: Number(row.port_id),
    siQty: row.si_qty != null ? Number(row.si_qty) : null,
    siMetric: row.si_metric || 'MT',
    siProducts: products.rows.map((p) => ({
      commodityId: Number(p.commodity_id),
      plannedQty: p.planned_qty != null ? Number(p.planned_qty) : null,
      klToMtFactor: p.kl_to_mt_factor != null ? Number(p.kl_to_mt_factor) : null,
    })),
  };
}

function mtFactorResolver(ctx) {
  if (ctx.siMetric === 'MT') return () => 1;
  if (ctx.siMetric !== 'KL') return () => null;
  const byId = new Map(ctx.siProducts.map((p) => [String(p.commodityId), p.klToMtFactor]));
  const only = ctx.siProducts.length === 1 ? ctx.siProducts[0].klToMtFactor : null;
  return (commodityId) => (commodityId != null ? byId.get(String(commodityId)) ?? null : only);
}

/** Re-run the port rule over every auto-tagged segment of the voyage. */
export async function retagKurasForOperation(db, operationId) {
  const ctx = await loadVoyageContext(db, operationId);
  if (!ctx) return { updated: 0 };
  const linesR = await db.query(
    `SELECT l.id, l.qty, l.started_at, l.ended_at, l.commodity_id, l.movement_type_source
     FROM operation_cargo_load_lines l
     JOIN operation_operational_activities oa ON oa.id = l.operational_activity_id AND oa.deleted_at IS NULL
     WHERE oa.operation_id = $1 AND oa.milestone_key = 'cargo_operations'`,
    [operationId]
  );
  if (!linesR.rows.length) return { updated: 0 };
  const lines = linesR.rows.map((row) => ({
    id: Number(row.id),
    qty: row.qty != null ? Number(row.qty) : null,
    startedAt: toIso(row.started_at),
    endedAt: toIso(row.ended_at),
    commodityId: row.commodity_id != null ? Number(row.commodity_id) : null,
    source: row.movement_type_source,
  }));
  const results = classifyKurasSegments({
    lines,
    siQty: ctx.siQty,
    siProducts: ctx.siProducts,
    rules: await loadKurasRules(db, ctx.portId),
    mtFactorFor: mtFactorResolver(ctx),
  });
  const auto = lines.filter((l) => l.source === 'auto');
  if (!auto.length) return { updated: 0 };
  await db.query(
    `UPDATE operation_cargo_load_lines l
     SET movement_type = v.movement_type, movement_type_reason = v.reason
     FROM unnest($1::bigint[], $2::text[], $3::jsonb[]) AS v(id, movement_type, reason)
     WHERE l.id = v.id AND l.movement_type_source = 'auto'`,
    [
      auto.map((l) => l.id),
      auto.map((l) => results.get(l.id).movementType),
      auto.map((l) => JSON.stringify(results.get(l.id).reason)),
    ]
  );
  return { updated: auto.length };
}

/** Re-tag every voyage at a port that has cargo segments (after a rule change). */
export async function retagKurasForPort(db, portId) {
  const r = await db.query(
    `SELECT DISTINCT oa.operation_id
     FROM operation_operational_activities oa
     JOIN operations o ON o.id = oa.operation_id AND o.deleted_at IS NULL
     LEFT JOIN jetties j ON j.id = o.jetty_id
     JOIN operation_cargo_load_lines l ON l.operational_activity_id = oa.id
     WHERE oa.deleted_at IS NULL AND oa.milestone_key = 'cargo_operations'
       AND COALESCE(o.port_id, j.port_id) = $1`,
    [portId]
  );
  let updated = 0;
  for (const row of r.rows) updated += (await retagKurasForOperation(db, Number(row.operation_id))).updated;
  return { operations: r.rows.length, updated };
}
