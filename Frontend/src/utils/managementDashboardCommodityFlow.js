/**
 * Commodity-grain KPIs for the Management Dashboard top cards.
 * Input rows are deduped sailed calls. Each product on a call is one shipment.
 * Shared berth and wait are repeated once per commodity.
 * Throughput sums logged moved tons per commodity, not the shipment-plan quantity.
 * Flow rate uses the product rate.
 */
import { mean, median } from './managementDashboardFlow.js'
import { expandVoyageToProductSlices, productSliceFlowRate } from './managementDashboardProduct.js'

function isCargoPurpose(purpose) {
  return purpose === 'Loading' || purpose === 'Unloading'
}

/** Logged cargo movement for one commodity. Missing or non-positive movement is null. */
export function sliceMovedQty(slice) {
  const n = Number(slice?.productMovedQty)
  return Number.isFinite(n) && n > 0 ? n : null
}

function metricsFor(slices) {
  return {
    shipments: slices.length,
    throughput: slices.reduce((s, r) => s + (sliceMovedQty(r) || 0), 0),
    berth: median(slices.map((r) => r.berth)),
    wait: mean(slices.map((r) => r.wait)),
    rate: mean(slices.map(productSliceFlowRate)),
  }
}

/**
 * @param {Array<object>} rows deduped sailed rows in the selected cast-off window
 */
export function computeCommodityFlow(rows) {
  const list = Array.isArray(rows) ? rows : []
  const slices = []
  for (const r of list) {
    if (!isCargoPurpose(r.purpose)) continue
    slices.push(...expandVoyageToProductSlices(r))
  }
  return {
    ...metricsFor(slices),
    loading: metricsFor(slices.filter((s) => s.purpose === 'Loading')),
    unloading: metricsFor(slices.filter((s) => s.purpose === 'Unloading')),
    slices,
  }
}
