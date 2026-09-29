/**
 * Weekly flow-rate chart: rank commodities, default top-7+Others, optional user subset.
 */

export function rankFlowCommodities(weeks) {
  const byId = new Map()
  for (const w of weeks || []) {
    for (const row of w.flowRateByCommodity || []) {
      const id = Number(row.commodityId)
      if (!Number.isFinite(id)) continue
      const cur = byId.get(id) || { commodityId: id, code: row.code || '—', qtyMt: 0 }
      cur.qtyMt += Number(row.qtyMt) || 0
      if (row.code) cur.code = row.code
      byId.set(id, cur)
    }
  }
  return [...byId.values()].sort((a, b) => b.qtyMt - a.qtyMt || String(a.code).localeCompare(String(b.code)))
}

export function flowSeriesEntries(ranked, othersLabel) {
  if (ranked.length <= 8) return ranked.map((c) => ({ ...c, others: false, restIds: [] }))
  const top = ranked.slice(0, 7)
  const rest = ranked.slice(7)
  return [
    ...top.map((c) => ({ ...c, others: false, restIds: [] })),
    { commodityId: -1, code: othersLabel, others: true, restIds: rest.map((r) => r.commodityId) },
  ]
}

/**
 * @param {Array<object>} weeks
 * @param {{ selectedCommodityIds?: string[], othersLabel: string }} opts
 */
export function buildFlowChartEntries(weeks, { selectedCommodityIds = [], othersLabel }) {
  const ranked = rankFlowCommodities(weeks)
  const selected = (selectedCommodityIds || []).map(String).filter(Boolean)
  if (!selected.length) {
    return flowSeriesEntries(ranked, othersLabel)
  }
  const selectedSet = new Set(selected)
  return ranked
    .filter((c) => selectedSet.has(String(c.commodityId)))
    .map((c) => ({ ...c, others: false, restIds: [] }))
}

export function pruneFlowCommoditySelection(selectedIds, ranked) {
  const avail = new Set((ranked || []).map((c) => String(c.commodityId)))
  return (selectedIds || []).filter((id) => avail.has(String(id)))
}

/** Stable palette index from full ranked list (Others uses last visible index in entries). */
export function flowColorIndexForEntry(ranked, entry) {
  if (entry?.others) return 7
  const idx = (ranked || []).findIndex((c) => Number(c.commodityId) === Number(entry.commodityId))
  return idx >= 0 ? idx : 0
}

export function flowRateForEntry(week, entry) {
  const rows = week?.flowRateByCommodity || []
  if (entry.others) {
    const vals = entry.restIds
      .map((id) => rows.find((r) => Number(r.commodityId) === id)?.mtPerHourMa)
      .filter((v) => v != null && Number.isFinite(Number(v)))
      .map(Number)
    if (!vals.length) return null
    return vals.reduce((s, n) => s + n, 0) / vals.length
  }
  const hit = rows.find((r) => Number(r.commodityId) === entry.commodityId)
  return hit != null && Number.isFinite(Number(hit.mtPerHourMa)) ? Number(hit.mtPerHourMa) : null
}
