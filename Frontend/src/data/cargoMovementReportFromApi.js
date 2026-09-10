/**
 * Cargo Movement Report: lookup by vessel / plan ref / jetty op ID / SI,
 * then header + hourly transfer-rate blocks per matching operation.
 */

import {
  buildPlanRefByShipmentPlanId,
  operationScheduleOverlapsRange,
  resolveOperationPlanReference,
} from './dailyActivitiesReportFromApi.js'

export { buildPlanRefByShipmentPlanId }

export const CARGO_MOVEMENT_HEADER_FIELDS = [
  { key: 'planRef', labelKey: 'cargoMovementHeaderPlanRef', label: 'Plan Ref' },
  { key: 'shippingInstruction', labelKey: 'cargoMovementHeaderSi', label: 'Shipping Instruction' },
  { key: 'jettyOperationId', labelKey: 'cargoMovementHeaderJettyOp', label: 'Jetty Operation ID' },
  { key: 'commodity', labelKey: 'cargoMovementHeaderCommodity', label: 'Commodity' },
  { key: 'quantity', labelKey: 'cargoMovementHeaderQty', label: 'Qty' },
  { key: 'purpose', labelKey: 'cargoMovementHeaderPurpose', label: 'Purpose' },
]

export const CARGO_MOVEMENT_HOURLY_COLUMNS = [
  { key: 'clockHour', label: 'Clock hour' },
  { key: 'tank', label: 'Tank' },
  { key: 'moved', label: 'Moved' },
  { key: 'rate', label: 'Rate' },
  { key: 'status', label: 'Status' },
  { key: 'source', label: 'Source' },
]

const CARGO_PROGRESS_CONCURRENCY = 4

export function resolveCargoPlanRef(op, planRefByShipmentPlanId) {
  if (op?.planReference) return op.planReference
  return resolveOperationPlanReference(op, null, planRefByShipmentPlanId)
}

function fieldContains(value, needle) {
  if (value == null) return false
  return String(value).toLowerCase().includes(needle)
}

/**
 * Case-insensitive contains match on vessel name, plan ref, jetty operation ID, or SI.
 * @param {object} op
 * @param {string} term
 * @param {Map<number, string>|null|undefined} planRefByShipmentPlanId
 */
export function operationMatchesCargoLookup(op, term, planRefByShipmentPlanId) {
  const needle = String(term || '').trim().toLowerCase()
  if (!needle || !op) return false
  const planRef = resolveCargoPlanRef(op, planRefByShipmentPlanId)
  const siFallback = op.shippingInstructionId != null ? `SI-${op.shippingInstructionId}` : null
  return (
    fieldContains(op.vesselName, needle) ||
    fieldContains(planRef, needle) ||
    fieldContains(op.jettyOperationCode, needle) ||
    fieldContains(op.referenceNumber, needle) ||
    fieldContains(siFallback, needle)
  )
}

/**
 * Optional date range: applied only when both start and end are set.
 */
export function operationMatchesCargoDateRange(op, startDate, endDate) {
  const start = String(startDate || '').trim()
  const end = String(endDate || '').trim()
  if (!start || !end) return true
  return operationScheduleOverlapsRange(op, null, start, end)
}

export function formatCargoMovementQty(op, progress) {
  if (op?.totalQtyDisplay && String(op.totalQtyDisplay).trim()) {
    return String(op.totalQtyDisplay).trim()
  }
  const qty = op?.cargoSiQty ?? progress?.siQty
  const unit = op?.cargoSiMetricCode || op?.cargoSiMetricName || progress?.siMetric || ''
  if (qty == null || qty === '' || !Number.isFinite(Number(qty))) return '—'
  const n = Number(qty)
  return unit ? `${n} ${unit}` : String(n)
}

export function buildCargoMovementHeader(op, planRefByShipmentPlanId, progress) {
  return {
    planRef: resolveCargoPlanRef(op, planRefByShipmentPlanId) || '—',
    shippingInstruction:
      op?.referenceNumber || (op?.shippingInstructionId ? `SI-${op.shippingInstructionId}` : '—'),
    jettyOperationId: op?.jettyOperationCode || '—',
    commodity: op?.commodityShortDisplay || op?.commodity || '—',
    quantity: formatCargoMovementQty(op, progress),
    purpose: progress?.purpose || op?.purpose || '—',
  }
}

/**
 * @returns {{ vesselId, vesselName, header, hourlyBuckets, purpose, unit, createdAt }}
 */
export function buildCargoMovementBlock(op, progress, planRefByShipmentPlanId) {
  return {
    vesselId: String(op?.id ?? ''),
    vesselName: op?.vesselName || '—',
    header: buildCargoMovementHeader(op, planRefByShipmentPlanId, progress),
    hourlyBuckets: Array.isArray(progress?.hourlyBuckets) ? progress.hourlyBuckets : [],
    purpose: progress?.purpose || op?.purpose || null,
    unit: progress?.siMetric || op?.cargoSiMetricCode || 'MT',
    createdAt: op?.createdAt || null,
    operationId: op?.id ?? null,
  }
}

export function sortCargoMovementBlocksNewestFirst(blocks) {
  return [...(Array.isArray(blocks) ? blocks : [])].sort((a, b) => {
    const ta = a?.createdAt ? new Date(a.createdAt).getTime() : 0
    const tb = b?.createdAt ? new Date(b.createdAt).getTime() : 0
    const aTime = Number.isFinite(ta) ? ta : 0
    const bTime = Number.isFinite(tb) ? tb : 0
    if (bTime !== aTime) return bTime - aTime
    return Number(b?.operationId || 0) - Number(a?.operationId || 0)
  })
}

export async function mapWithConcurrency(items, concurrency, mapper) {
  const list = Array.isArray(items) ? items : []
  const limit = Math.max(1, Number(concurrency) || 1)
  const results = new Array(list.length)
  let next = 0

  async function worker() {
    while (next < list.length) {
      const i = next
      next += 1
      results[i] = await mapper(list[i], i)
    }
  }

  const workerCount = Math.min(limit, list.length)
  if (workerCount === 0) return results
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results
}

export function filterOperationsForCargoMovement(operations, { lookup, startDate, endDate, planRefByShipmentPlanId }) {
  return (Array.isArray(operations) ? operations : []).filter(
    (op) =>
      operationMatchesCargoLookup(op, lookup, planRefByShipmentPlanId) &&
      operationMatchesCargoDateRange(op, startDate, endDate)
  )
}

export const CARGO_MOVEMENT_PROGRESS_CONCURRENCY = CARGO_PROGRESS_CONCURRENCY
