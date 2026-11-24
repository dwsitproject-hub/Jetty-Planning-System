/**
 * Merge Management Dashboard bulk cargo-rate API into normalized voyage rows.
 */

/**
 * @param {object} row
 * @param {Record<string, { voyage?: object, byProduct?: Record<string, object> }>} ratesByOpId
 */
export function mergeCargoRatesIntoRow(row, ratesByOpId) {
  const entry = ratesByOpId?.[String(row.id)] ?? ratesByOpId?.[row.id]
  if (!entry) return row
  const v = entry.voyage || {}
  const merged = {
    ...row,
    voyageRateMtH: v.rateMtH ?? null,
    voyageMovedQty: v.movedQty ?? null,
    voyageLoggedHours: v.loggedHours ?? null,
    voyageActiveHours: v.activeHours ?? null,
    voyageActiveRateMtH: v.activeRateMtH ?? null,
    cargoRateSource: v.source ?? null,
    cargoRateAtgPartial: v.atgPartial ?? false,
    productRatesByKey: entry.byProduct ?? {},
  }
  return v.breakdown ? { ...merged, ...breakdownFields(v.breakdown) } : merged
}

/** Pumped / cleaned / downtime figures; only present while the API sends a breakdown (switch on). */
function breakdownFields(b) {
  return {
    rateBreakdown: b,
    stopHoursBefore: b.stopHours?.before ?? 0,
    stopHoursDuring: b.stopHours?.during ?? 0,
    stopHoursAfter: b.stopHours?.after ?? 0,
  }
}
