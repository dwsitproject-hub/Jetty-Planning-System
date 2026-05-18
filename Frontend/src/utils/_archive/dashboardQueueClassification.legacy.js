/**
 * Legacy dashboard queue helpers (retired). Active UI: `pages/DashboardV2.jsx` at `/`.
 * Queue row classification for Dashboard pipeline parity (allocation overview `queue` rows).
 * @see Docs/Plan/DASHBOARD-ACTIVITY-CHART-PLAN.md
 */

/**
 * Stable key for one physical vessel call: shared Shipment Plan rows collapse to one id.
 * @param {unknown} row
 */
export function allocationQueueVesselCallKey(row) {
  const pid = row?.shipmentPlanId
  if (pid != null && pid !== '') return `plan:${pid}`
  const op = row?.operationId
  if (op != null && op !== '') return `op:${op}`
  const vid = row?.vesselId
  const j = (row?.jetty || '').trim()
  return `v:${j}:${vid ?? ''}`
}

/**
 * Planned berthing: jetty assigned, not yet alongside (aligned with Vessel pipeline sublabel).
 */
export function isPlannedBerthingQueueRow(row) {
  const jetty = (row?.jetty || '').trim()
  if (!jetty) return false
  const hasTb = Boolean(row?.tbDateTime)
  const opStatus = String(row?.status || '').toUpperCase()
  if (
    hasTb ||
    ['DOCKED', 'IN_PROGRESS', 'POST_OPS', 'SIGNOFF_REQUESTED', 'SIGNOFF_APPROVED'].includes(opStatus)
  ) {
    return false
  }
  return true
}

/**
 * Alongside / at berth for chart: TB set or operation in alongside statuses.
 * Shifting-out rows are excluded (not occupying the berth for mix purposes).
 */
export function isQueueRowBerthing(row) {
  if (row?.shiftingOut) return false
  const hasTb = Boolean(row?.tbDateTime)
  const opStatus = String(row?.status || '').toUpperCase()
  if (
    hasTb ||
    ['DOCKED', 'IN_PROGRESS', 'POST_OPS', 'SIGNOFF_REQUESTED', 'SIGNOFF_APPROVED'].includes(opStatus)
  ) {
    return true
  }
  return false
}

/** @param {unknown} purpose */
export function normalizeQueuePurpose(purpose) {
  const s = String(purpose || '').trim()
  if (!s) return null
  const u = s.toLowerCase()
  if (u === 'loading') return 'Loading'
  if (u === 'unloading') return 'Unloading'
  return null
}
