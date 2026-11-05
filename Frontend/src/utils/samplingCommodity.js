/** Shared shaping for per-commodity sampling cards. */
import { valueCodesOf } from './qcSpec.js'

function metricsForSave(card) {
  const params = card?.spec?.parameters
  const metrics = card?.metrics && typeof card.metrics === 'object' ? card.metrics : {}
  if (!Array.isArray(params) || params.length === 0) return metrics
  const allowed = new Set(params.flatMap(valueCodesOf))
  const next = {}
  for (const [key, value] of Object.entries(metrics)) {
    if (allowed.has(key)) next[key] = value
  }
  return next
}

/** A blank card for a commodity that has no saved sampling row yet. */
export function emptyCommodityCard(product) {
  const commodityId = Number(product?.commodityId)
  return {
    commodityId,
    shortName: product?.shortName || product?.name || '',
    name: product?.name || product?.shortName || '',
    decision: product?.decision ?? null,
    remark: product?.remark ?? '',
    ffaAverage: product?.ffaAverage ?? '',
    moistureAverage: product?.moistureAverage ?? '',
    dobi: product?.dobi ?? '',
    iodineValue: product?.iodineValue ?? '',
    metrics: product?.metrics && typeof product.metrics === 'object' ? product.metrics : {},
    spec: product?.spec || null,
    records: Array.isArray(product?.records) ? product.records : [],
    documents: Array.isArray(product?.documents) ? product.documents : [],
  }
}

/**
 * Keep saved cards. When none exist yet, one empty card per commodity on the instruction
 * so Approve / Hold / Reject are available before the first sampling save.
 */
export function seedCommodityCards(existing, products) {
  if (Array.isArray(existing) && existing.length > 0) return existing
  return (products || [])
    .filter((product) => Number(product?.commodityId) > 0)
    .map(emptyCommodityCard)
}

function filled(value, fallback) {
  return value != null && String(value).trim() !== '' ? value : fallback || ''
}

/**
 * A single commodity keeps any figure, palka row, or document the visit already saved
 * when that card does not have its own. Several commodities stay as they are.
 */
export function carryVisitOntoSingleCard(cards, visit) {
  if (!Array.isArray(cards) || cards.length !== 1 || !visit) return cards
  const card = cards[0]
  const records = (card.records || []).length ? card.records : Array.isArray(visit.records) ? visit.records : []
  const documents = (card.documents || []).length
    ? card.documents
    : Array.isArray(visit.documents)
      ? visit.documents
      : []
  return [
    {
      ...card,
      ffaAverage: filled(card.ffaAverage, visit.ffaAverage),
      moistureAverage: filled(card.moistureAverage, visit.moistureAverage),
      dobi: filled(card.dobi, visit.dobi),
      iodineValue: filled(card.iodineValue, visit.iodineValue),
      records,
      documents,
    },
  ]
}

export function cardsToSaveBody(commodities) {
  if (!Array.isArray(commodities)) return undefined
  return commodities.map((card) => ({
    commodityId: card.commodityId,
    decision: card.decision || null,
    remark: card.remark || '',
    ffaAverage: card.ffaAverage ?? '',
    moistureAverage: card.moistureAverage ?? '',
    dobi: card.dobi ?? '',
    iodineValue: card.iodineValue ?? '',
    metrics: metricsForSave(card),
    records: card.records || [],
  }))
}

/** Shape one card like the sampling draft the extract merge already understands. */
export function samplingViewFromCard(visit, card) {
  return {
    startTime: visit?.startTime || '',
    endTime: visit?.endTime || '',
    remark: visit?.remark || '',
    ffaAverage: card?.ffaAverage ?? '',
    moistureAverage: card?.moistureAverage ?? '',
    dobi: card?.dobi ?? '',
    iodineValue: card?.iodineValue ?? '',
    records: card?.records || [],
  }
}

export function applyCardExtract(card, nextSampling) {
  return {
    ...card,
    ffaAverage: nextSampling?.ffaAverage ?? card.ffaAverage,
    moistureAverage: nextSampling?.moistureAverage ?? card.moistureAverage,
    dobi: nextSampling?.dobi ?? card.dobi,
    iodineValue: nextSampling?.iodineValue ?? card.iodineValue,
    records: nextSampling?.records || card.records || [],
  }
}

export function decisionTone(code) {
  if (code === 'approve_in') return 'ok'
  if (code === 'approve_out') return 'out'
  if (code === 'hold') return 'hold'
  if (code === 'reject_in' || code === 'reject_out' || code === 'reject') return 'reject'
  if (code === 'out') return 'out'
  return ''
}

/** Short names and decision labels for a checklist tooltip. `labelOf` translates the stored code. */
export function decisionSummaryText(commodities, labelOf) {
  return (commodities || [])
    .filter((card) => card?.decision)
    .map((card) => {
      const name = card.shortName || card.name
      const label = labelOf(card.decision)
      return name ? `${name} ${label}` : label
    })
    .join(', ')
}

/** Collapsed multi-SI vessels only flag Reject, then Out Spec. */
export function collapsedAttention(commodities) {
  const codes = (commodities || []).map((c) => c?.decision).filter(Boolean)
  if (codes.some((c) => c.startsWith('reject'))) return 'reject'
  if (codes.some((c) => c.endsWith('_out'))) return 'out'
  return null
}

export function commodityDecisionsFromRow(row) {
  const products = []
  const seen = new Set()
  for (const summary of row?.cargoBreakdownSummary || []) {
    for (const product of summary.products || []) {
      if (product.commodityId == null || seen.has(product.commodityId)) continue
      seen.add(product.commodityId)
      products.push(product)
    }
  }
  const byId = new Map((row?.qcDecisions || []).map((d) => [Number(d.commodityId), d]))
  return products
    .map((product) => {
      const decision = byId.get(Number(product.commodityId))
      return {
        commodityId: product.commodityId,
        shortName: product.shortName,
        name: product.name,
        decision: decision?.decision ?? null,
        remark: decision?.remark ?? '',
      }
    })
    .filter((card) => card.decision)
}
