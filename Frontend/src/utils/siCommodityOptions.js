/**
 * Normalize siCommodityOptions from GET /operations/:id for cargo entry UI.
 */

export function normalizeSiCommodityOptions(raw) {
  if (!Array.isArray(raw)) return []
  return raw
    .map((o) => {
      const commodityId = o.commodityId ?? o.commodity_id
      const id = commodityId != null ? String(commodityId) : ''
      if (!id) return null
      return {
        commodityId: id,
        name: o.name ?? o.commodityName ?? '',
        shortName: o.shortName ?? o.short_name ?? o.commodityShortName ?? o.name ?? id,
        plannedQty: o.plannedQty != null ? Number(o.plannedQty) : null,
        metricCode: o.metricCode ?? o.metric_code ?? 'MT',
        metricMixed: Boolean(o.metricMixed ?? o.metric_mixed),
      }
    })
    .filter(Boolean)
}

export function requiresCommodityPicker(options) {
  return Array.isArray(options) && options.length > 1
}

/**
 * Hydrate cargo line draft product fields from persisted API line (no default for null).
 * @param {object} line
 * @returns {{ commodityId: string, persistedCommodityId: string | null }}
 */
export function commodityDraftFromPersistedLoadLine(line) {
  const raw = line?.commodityId ?? line?.commodity_id
  if (raw == null || String(raw).trim() === '') {
    return { commodityId: '', persistedCommodityId: null }
  }
  const id = String(raw).trim()
  return { commodityId: id, persistedCommodityId: id }
}

export function defaultCommodityIdForNewLine(options, previousLineCommodityId) {
  const list = normalizeSiCommodityOptions(options)
  if (list.length === 0) return null
  if (list.length === 1) return list[0].commodityId
  const prev = previousLineCommodityId != null ? String(previousLineCommodityId) : ''
  if (prev && list.some((o) => o.commodityId === prev)) return prev
  return list[0].commodityId
}

export function formatSiCommodityPlanHint(option) {
  if (!option || option.plannedQty == null || !Number.isFinite(Number(option.plannedQty))) {
    return null
  }
  const qty = Number(option.plannedQty).toLocaleString(undefined, { maximumFractionDigits: 3 })
  const unit = option.metricCode || 'MT'
  return `${qty} ${unit}`
}

export function findSiCommodityOption(options, commodityId) {
  const id = commodityId != null ? String(commodityId) : ''
  if (!id) return null
  return normalizeSiCommodityOptions(options).find((o) => o.commodityId === id) ?? null
}

export function singleCommodityBannerText(options) {
  const list = normalizeSiCommodityOptions(options)
  if (list.length !== 1) return null
  const o = list[0]
  const hint = formatSiCommodityPlanHint(o)
  return hint ? `${o.shortName} · Plan ${hint}` : o.shortName
}

/** One SI breakdown line: short name + planned qty (e.g. "RG 3,000 MT"). */
export function formatSiCommodityPlanSegment(option) {
  const o = normalizeSiCommodityOptions([option])[0]
  if (!o) return null
  const hint = formatSiCommodityPlanHint(o)
  return hint ? `${o.shortName} ${hint}` : o.shortName
}

/**
 * Multi-product SI plan summary for cargo modal header (not operation-level commodity + total).
 * @returns {string|null}
 */
export function multiCommodityPlanSummaryText(options) {
  const list = normalizeSiCommodityOptions(options)
  if (list.length <= 1) return null
  const parts = list.map((o) => formatSiCommodityPlanSegment(o)).filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}
