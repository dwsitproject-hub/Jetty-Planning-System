/**
 * Sync shipment_plans.vessel_capacity from the sum of MT breakdown qty across all child SIs.
 * vessel_dwt (generated column) recomputes automatically when capacity changes.
 */
export async function syncPlanVesselCapacityFromBreakdown(client, planId) {
  if (planId == null) return null
  const sumRes = await client.query(
    `SELECT COALESCE(SUM(sib.qty), 0)::numeric AS total_mt
     FROM shipping_instruction_breakdown sib
     JOIN shipping_instructions si ON si.id = sib.shipping_instruction_id AND si.deleted_at IS NULL
     JOIN metric m ON m.id = sib.metric_id AND m.deleted_at IS NULL AND UPPER(m.code) = 'MT'
     WHERE si.shipment_plan_id = $1
       AND sib.deleted_at IS NULL
       AND sib.qty > 0`,
    [planId]
  )
  const totalMt = Number(sumRes.rows[0]?.total_mt ?? 0)
  const nextCapacity = totalMt > 0 ? totalMt : null
  await client.query(
    `UPDATE shipment_plans SET vessel_capacity = $1, updated_at = NOW() WHERE id = $2 AND deleted_at IS NULL`,
    [nextCapacity, planId]
  )
  return nextCapacity
}
