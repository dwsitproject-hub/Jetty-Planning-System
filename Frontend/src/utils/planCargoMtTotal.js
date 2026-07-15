/** Resolve metric code (MT/KL) from a breakdown row. */
function metricCodeForRow(row, lookups) {
  if (row?.metricCode) return String(row.metricCode).toUpperCase()
  const mid = row?.metricId
  if (mid == null || mid === '') return null
  const m = lookups?.metrics?.find((x) => String(x.id) === String(mid))
  return m?.code ? String(m.code).toUpperCase() : null
}

/**
 * Sum MT qty from one or more SI draft forms or saved breakdown arrays.
 * @param {Array<{ breakdown?: Array }>|Array} formsOrBreakdowns
 * @param {{ metrics?: Array<{ id, code }> }|null} lookups
 */
export function sumBreakdownMtTotal(formsOrBreakdowns, lookups) {
  let total = 0
  for (const item of formsOrBreakdowns || []) {
    const rows = Array.isArray(item?.breakdown) ? item.breakdown : Array.isArray(item) ? item : []
    for (const row of rows) {
      if (metricCodeForRow(row, lookups) !== 'MT') continue
      const qty = Number(row.qty)
      if (Number.isFinite(qty) && qty > 0) total += qty
    }
  }
  return total
}

/** True when breakdown has KL qty > 0 but no MT qty (DWT cannot be computed from cargo). */
export function breakdownHasKlQtyOnly(formsOrBreakdowns, lookups) {
  let mtQty = 0
  let klQty = 0
  for (const item of formsOrBreakdowns || []) {
    const rows = Array.isArray(item?.breakdown) ? item.breakdown : Array.isArray(item) ? item : []
    for (const row of rows) {
      const code = metricCodeForRow(row, lookups)
      const qty = Number(row.qty)
      if (!Number.isFinite(qty) || qty <= 0) continue
      if (code === 'MT') mtQty += qty
      else if (code === 'KL') klQty += qty
    }
  }
  return klQty > 0 && mtQty <= 0
}
