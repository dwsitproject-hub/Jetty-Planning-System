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

/** Net-rate fields; only present while the API sends a breakdown (net-rate feature on). */
function breakdownFields(b) {
  return {
    rateBreakdown: b,
    voyageNetRateMtH: b.netRateMtH ?? null,
    voyagePumpingHours: b.pumpingHours ?? null,
    voyageNormalRateMtH: b.normal?.rateMtH ?? null,
    voyageKurasRateMtH: b.kuras?.rateMtH ?? null,
    stopHoursBefore: b.stopHours?.before ?? 0,
    stopHoursDuring: b.stopHours?.during ?? 0,
    stopHoursAfter: b.stopHours?.after ?? 0,
    stopHoursTotal: b.stopHours?.total ?? 0,
  }
}

/** Net rate of a voyage row; null when none was computed. */
export function voyageNetRate(r) {
  const v = r?.voyageNetRateMtH
  return v != null && Number.isFinite(v) && v > 0 ? v : null
}
