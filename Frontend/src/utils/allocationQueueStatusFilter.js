import { getEtcBreach } from './etcBreach.js'

/** Exclusive queue status stages (one selected at a time). */
export const QUEUE_STATUS_INCOMING = 'incoming'
export const QUEUE_STATUS_WAITING_TO_BERTH = 'waitingToBerth'
export const QUEUE_STATUS_BERTHED = 'berthed'
export const QUEUE_STATUS_ETC_BREACHED = 'etcBreached'

export const QUEUE_STATUS_STAGES = [
  QUEUE_STATUS_INCOMING,
  QUEUE_STATUS_WAITING_TO_BERTH,
  QUEUE_STATUS_BERTHED,
  QUEUE_STATUS_ETC_BREACHED,
]

/** Default queue view for plan-centric and legacy allocation. */
export const QUEUE_STATUS_FILTER_DEFAULT = QUEUE_STATUS_INCOMING
export const PLAN_CENTRIC_STATUS_FILTER_DEFAULT = QUEUE_STATUS_FILTER_DEFAULT
export const LEGACY_STATUS_FILTER_DEFAULT = QUEUE_STATUS_FILTER_DEFAULT

function hasQueueArrivalTime(row) {
  const ta = row?.taDateTime || row?.ta
  if (!ta) return false
  const t = new Date(ta).getTime()
  return !Number.isNaN(t)
}

function isSailedRow(row) {
  return String(row?.status || '').toUpperCase() === 'SAILED'
}

/**
 * Incoming-family row that has logged TA and is not sailed (dashboard Waiting to Berth).
 * @param {object|null|undefined} row
 * @param {'incoming'|'berthed'} rowStatus
 */
export function isAllocationQueueWaitingToBerth(row, rowStatus) {
  if (rowStatus !== 'incoming') return false
  if (isSailedRow(row)) return false
  return hasQueueArrivalTime(row)
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
 * @param {'incoming'|'waitingToBerth'|'berthed'|'etcBreached'} queueStatusFilter
 * @param {{ breachNowMs?: number, planCentric?: boolean }|boolean} [options]
 */
export function rowPassesAllocationStatusFilter(row, rowStatus, queueStatusFilter, options = {}) {
  const opts = typeof options === 'boolean' ? { planCentric: options } : options || {}
  const stage = String(queueStatusFilter || '')
  const waiting = isAllocationQueueWaitingToBerth(row, rowStatus)

  if (stage === QUEUE_STATUS_INCOMING) {
    return rowStatus === 'incoming' && !hasQueueArrivalTime(row)
  }
  if (stage === QUEUE_STATUS_WAITING_TO_BERTH) {
    return waiting
  }
  if (stage === QUEUE_STATUS_BERTHED) {
    return rowStatus === 'berthed'
  }
  if (stage === QUEUE_STATUS_ETC_BREACHED) {
    if (rowStatus !== 'berthed') return false
    return Boolean(getEtcBreach(row, opts.breachNowMs))
  }
  return false
}
