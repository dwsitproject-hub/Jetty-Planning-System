/**
 * Sync shipment_plans.vessel_capacity from MT + converted KL breakdown qty across all child SIs.
 * vessel_dwt (generated column) recomputes automatically when capacity changes.
 */
const VESSEL_CAPACITY_SUM_SQL = `COALESCE(SUM(
  CASE UPPER(m.code)
    WHEN 'MT' THEN sib.qty
    WHEN 'KL' THEN sib.qty * COALESCE(c.kl_to_mt_factor, 0)
    ELSE 0
  END
), 0)::numeric`;

export async function syncPlanVesselCapacityFromBreakdown(client, planId) {
  if (planId == null) return null;
  const sumRes = await client.query(
    `SELECT ${VESSEL_CAPACITY_SUM_SQL} AS total_mt
     FROM shipping_instruction_breakdown sib
     JOIN shipping_instructions si ON si.id = sib.shipping_instruction_id AND si.deleted_at IS NULL
     JOIN metric m ON m.id = sib.metric_id AND m.deleted_at IS NULL
     JOIN si_commodities c ON c.id = sib.commodity_id AND c.deleted_at IS NULL
     WHERE si.shipment_plan_id = $1
       AND sib.deleted_at IS NULL
       AND sib.qty > 0`,
    [planId]
  );
  const totalMt = Number(sumRes.rows[0]?.total_mt ?? 0);
  const nextCapacity = totalMt > 0 ? totalMt : null;
  await client.query(
    `UPDATE shipment_plans SET vessel_capacity = $1, updated_at = NOW() WHERE id = $2 AND deleted_at IS NULL`,
    [nextCapacity, planId]
  );
  return nextCapacity;
}

/** Re-sync vessel_capacity for all plans using the given commodity (e.g. after kl_to_mt_factor change). */
export async function syncPlanVesselCapacityForCommodity(client, commodityId) {
  if (commodityId == null) return;
  await client.query(
    `UPDATE shipment_plans sp
     SET vessel_capacity = CASE WHEN sub.total_mt > 0 THEN sub.total_mt ELSE NULL END,
         updated_at = NOW()
     FROM (
       SELECT si.shipment_plan_id AS plan_id,
              ${VESSEL_CAPACITY_SUM_SQL} AS total_mt
       FROM shipping_instruction_breakdown sib
       JOIN shipping_instructions si ON si.id = sib.shipping_instruction_id AND si.deleted_at IS NULL
       JOIN metric m ON m.id = sib.metric_id AND m.deleted_at IS NULL
       JOIN si_commodities c ON c.id = sib.commodity_id AND c.deleted_at IS NULL
       WHERE si.shipment_plan_id IS NOT NULL
         AND sib.deleted_at IS NULL
         AND sib.qty > 0
         AND si.shipment_plan_id IN (
           SELECT DISTINCT si2.shipment_plan_id
           FROM shipping_instruction_breakdown sib2
           JOIN shipping_instructions si2 ON si2.id = sib2.shipping_instruction_id AND si2.deleted_at IS NULL
           WHERE sib2.commodity_id = $1
             AND sib2.deleted_at IS NULL
             AND si2.shipment_plan_id IS NOT NULL
         )
       GROUP BY si.shipment_plan_id
     ) sub
     WHERE sp.id = sub.plan_id
       AND sp.deleted_at IS NULL`,
    [commodityId]
  );
}
