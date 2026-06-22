/** Default queue view for plan-centric allocation-plans. */
export const PLAN_CENTRIC_STATUS_FILTER_DEFAULT = {
  showIncoming: true,
  showBerthed: false,
}

/** Default queue view for legacy allocation. */
export const LEGACY_STATUS_FILTER_DEFAULT = {
  showIncoming: true,
  showBerthed: false,
}

/** When ETC-breach-only mode is on (plan-centric). */
export const ETC_BREACH_STATUS_FILTER_PLAN = {
  showIncoming: false,
  showBerthed: true,
}

export const ETC_BREACH_STATUS_FILTER_LEGACY = {
  showIncoming: false,
  showBerthed: true,
}

/**
 * Flat queue row (pre-merge) has a shipping instruction linked.
 * @param {object|null|undefined} row
 */
export function planCentricRowHasSi(row) {
  if (!row) return false
  if (row.source === 'incoming-si' || row.source === 'operation') return true
  const entries = row.planQueueSiEntries
  if (Array.isArray(entries) && entries.length > 0) return true
  const sid = row.shippingInstructionId
  if (sid != null && sid !== '' && Number.isFinite(Number(sid))) return true
  if (row.source === 'incoming-plan') return false
  return false
}

/**
 * True when merged row's Shipping Instructions column is plan ref only (no SI).
 * @param {object|null|undefined} row
 */
export function mergedPlanRowSiColumnIsPlanRefOnly(row) {
  if (!row) return true
  const planRef = String(row.planReference || '').trim()
  const siCol = String(row.shippingInstruction || '').trim()
  if (!siCol || siCol === '—') return true
  if (planRef && siCol === planRef) return true
  if (row.shipmentPlanId != null && siCol === `Plan #${row.shipmentPlanId}`) return true
  return false
}

/**
 * Merged plan-centric queue row: true if the shipment plan has any SI.
 * Uses planQueueSiEntries, row source, ids, and the same SI column text shown in the table.
 * @param {object|null|undefined} row
 */
export function planCentricQueueRowHasSi(row) {
  if (!row) return false
  if (row.hasShippingInstructions === true) return true
  const entries = row.planQueueSiEntries
  if (Array.isArray(entries) && entries.length > 0) return true
  if (row.source === 'incoming-si' || row.source === 'operation') return true
  const sid = row.shippingInstructionId
  if (sid != null && sid !== '' && Number.isFinite(Number(sid))) return true
  if (row.source === 'incoming-plan') return false
  return !mergedPlanRowSiColumnIsPlanRefOnly(row)
}

/**
 * Shipping Instructions column text for plan-centric queue (never plan ref as SI).
 * @param {object|null|undefined} row
 */
export function planCentricSiColumnDisplay(row) {
  if (!row) return '—'
  const entries = row.planQueueSiEntries
  if (Array.isArray(entries) && entries.length > 0) {
    return entries.map((e) => e.label).filter(Boolean).join(', ') || '—'
  }
  if (mergedPlanRowSiColumnIsPlanRefOnly(row)) return '—'
  const si = String(row.shippingInstruction || '').trim()
  return si && si !== '—' ? si : '—'
}

/**
 * @param {object} row
 * @param {'incoming'|'berthed'} rowStatus
 * @param {{ showIncoming?: boolean, showBerthed?: boolean }} statusFilter
 * @param {boolean} isPlanCentric
 */
export function rowPassesAllocationStatusFilter(row, rowStatus, statusFilter, isPlanCentric) {
  if (rowStatus === 'berthed') return Boolean(statusFilter.showBerthed)
  if (rowStatus !== 'incoming') return false
  if (!statusFilter.showIncoming) return false
  return true
}
