/**
 * Per-commodity default SI breakdown unit helpers.
 */

/** @param {object|null|undefined} commodity */
export function getCommodityDefaultMetric(commodity, lookups) {
  if (!commodity) return null
  const metricId = commodity.defaultMetricId
  if (metricId == null || metricId === '') return null
  const metric =
    (lookups?.metrics || []).find((m) => String(m.id) === String(metricId)) ||
    (commodity.defaultMetricCode
      ? (lookups?.metrics || []).find(
          (m) => String(m.code).toUpperCase() === String(commodity.defaultMetricCode).toUpperCase()
        )
      : null)
  return metric || null
}

/** @param {object} row @param {string|number} commodityId @param {object|null} lookups */
export function applyCommodityDefaultMetric(row, commodityId, lookups) {
  const commodity = (lookups?.commodities || []).find((c) => String(c.id) === String(commodityId))
  const defaultMetric = getCommodityDefaultMetric(commodity, lookups)
  if (!defaultMetric) return { ...row, commodityId: String(commodityId) }
  return {
    ...row,
    commodityId: String(commodityId),
    metricId: String(defaultMetric.id),
  }
}

/** @param {Array<object>} breakdown @param {object|null} lookups @returns {string|null} */
export function validateBreakdownMetricRules(breakdown, lookups) {
  const rows = breakdown || []
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]
    const commodity = (lookups?.commodities || []).find((c) => String(c.id) === String(row.commodityId))
    const defaultMetric = getCommodityDefaultMetric(commodity, lookups)
    if (!defaultMetric) continue
    if (String(row.metricId) !== String(defaultMetric.id)) {
      const label = commodity?.name || commodity?.shortName || `commodity ${row.commodityId}`
      return `Breakdown row ${i + 1}: ${label} must use ${defaultMetric.code} (configured default unit).`
    }
  }
  return null
}

/** @param {string|number|null|undefined} commodityId @param {object|null} lookups */
export function metricsForBreakdownRow(commodityId, lookups) {
  const all = lookups?.metrics || []
  const commodity = (lookups?.commodities || []).find((c) => String(c.id) === String(commodityId))
  const defaultMetric = getCommodityDefaultMetric(commodity, lookups)
  if (defaultMetric) return [defaultMetric]
  return all
}

/** Resolve metric id for a new breakdown row (commodity default, else MT). */
export function defaultMetricIdForBreakdownRow(commodityId, lookups) {
  const commodity = (lookups?.commodities || []).find((c) => String(c.id) === String(commodityId))
  const defaultMetric = getCommodityDefaultMetric(commodity, lookups)
  if (defaultMetric) return String(defaultMetric.id)
  const mt = (lookups?.metrics || []).find((m) => m.code === 'MT') || lookups?.metrics?.[0]
  return mt?.id != null ? String(mt.id) : ''
}
