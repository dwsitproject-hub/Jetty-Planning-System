/** Resolve metric code (MT/KL) from a breakdown row. */
function metricCodeForRow(row, lookups) {
  if (row?.metricCode) return String(row.metricCode).toUpperCase()
  const mid = row?.metricId
  if (mid == null || mid === '') return null
  const m = lookups?.metrics?.find((x) => String(x.id) === String(mid))
  return m?.code ? String(m.code).toUpperCase() : null
}

/** Resolve per-commodity KL→MT factor for a breakdown row. */
export function getKlToMtFactorForRow(row, lookups) {
  const cid = row?.commodityId
  if (cid == null || cid === '') return null
  const c = lookups?.commodities?.find((x) => String(x.id) === String(cid))
  const f = c?.klToMtFactor
  if (f == null || f === '') return null
  const n = Number(f)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Sum MT-equivalent qty from one or more SI draft forms or saved breakdown arrays.
 * MT rows add directly; KL rows add qty × commodity.klToMtFactor when configured.
 * @param {Array<{ breakdown?: Array }>|Array} formsOrBreakdowns
 * @param {{ metrics?: Array, commodities?: Array }|null} lookups
 */
export function sumBreakdownMtTotal(formsOrBreakdowns, lookups) {
  let total = 0
  for (const item of formsOrBreakdowns || []) {
    const rows = Array.isArray(item?.breakdown) ? item.breakdown : Array.isArray(item) ? item : []
    for (const row of rows) {
      const qty = Number(row.qty)
      if (!Number.isFinite(qty) || qty <= 0) continue
      const code = metricCodeForRow(row, lookups)
      if (code === 'MT') {
        total += qty
      } else if (code === 'KL') {
        const factor = getKlToMtFactorForRow(row, lookups)
        if (factor != null) total += qty * factor
      }
    }
  }
  return total
}

/** True when any KL row has qty > 0 but its commodity has no klToMtFactor configured. */
export function breakdownHasUnconvertedKl(formsOrBreakdowns, lookups) {
  for (const item of formsOrBreakdowns || []) {
    const rows = Array.isArray(item?.breakdown) ? item.breakdown : Array.isArray(item) ? item : []
    for (const row of rows) {
      const code = metricCodeForRow(row, lookups)
      const qty = Number(row.qty)
      if (code !== 'KL' || !Number.isFinite(qty) || qty <= 0) continue
      if (getKlToMtFactorForRow(row, lookups) == null) return true
    }
  }
  return false
}
