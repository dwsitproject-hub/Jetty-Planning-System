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
  return {
    ...row,
    voyageRateMtH: v.rateMtH ?? null,
    voyageMovedQty: v.movedQty ?? null,
    voyageLoggedHours: v.loggedHours ?? null,
    cargoRateSource: v.source ?? null,
    cargoRateAtgPartial: v.atgPartial ?? false,
    productRatesByKey: entry.byProduct ?? {},
  }
}
