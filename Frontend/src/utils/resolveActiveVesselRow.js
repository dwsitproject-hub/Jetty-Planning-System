import { pickRepresentativeQueueChild } from './allocationPlanPovMerge.js'

/** Resolve overview row for modal — merged Gantt rows use plan-* ids; clicks may pass op-* / si-*. */
export function resolveActiveVesselRow(vesselId, vesselDetailRows, planQueueRows = []) {
  if (!vesselId) return null
  const rows = Array.isArray(vesselDetailRows) ? vesselDetailRows : []
  const direct = rows.find((r) => r.vesselId === vesselId)
  if (direct) return direct

  const opMatch =
    typeof vesselId === 'string' && vesselId.startsWith('op-')
      ? parseInt(vesselId.slice(3), 10)
      : NaN
  if (Number.isFinite(opMatch)) {
    const byOp = rows.find((r) => Number(r.operationId) === opMatch)
    if (byOp) return byOp
    const planRows = Array.isArray(planQueueRows) ? planQueueRows : []
    const fromPlan = planRows.find((r) => Number(r.operationId) === opMatch)
    if (fromPlan) return fromPlan
  }

  const planRows = Array.isArray(planQueueRows) ? planQueueRows : []
  if (planRows.length > 0) {
    return pickRepresentativeQueueChild(planRows) || planRows[0]
  }
  return null
}
