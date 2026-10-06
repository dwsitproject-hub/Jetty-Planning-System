/**
 * Product (commodity) aggregates for the Management Dashboard.
 * Input rows are deduped sailed voyages in the selected cast-off window.
 * Multi-commodity voyages (e.g. "CPO · CPKO") are split into one slice per product.
 */
import { mean } from './managementDashboardFlow.js'
import { parseQtyDisplay } from './cargoQtyDisplay.js'
import { commodityShortNamesFromRow } from './tableCommodityPurposeFilters.js'

const COMMODITY_SHORT_SPLIT = /\s*[·,;/|]\s*/

/** @param {string | null | undefined} commodity */
export function productKeyFromCommodity(commodity) {
  const s = String(commodity ?? '').trim()
  if (!s) return 'Unknown'
  return s.toUpperCase()
}

/**
 * @param {string} totalQtyDisplay
 * @returns {Map<string, number>}
 */
export function parseProductQtyMap(totalQtyDisplay) {
  const map = new Map()
  const text = String(totalQtyDisplay ?? '')
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    const m = trimmed.match(/^([A-Za-z][A-Za-z0-9._/-]*)\s+(.+)$/)
    if (!m) continue
    const label = m[1].trim()
    const parsed = parseQtyDisplay(m[2].trim())
    if (!label || !parsed?.total) continue
    map.set(label, (map.get(label) || 0) + parsed.total)
  }
  return map
}

/**
 * Distinct product short names on a normalized management dashboard row.
 * @param {object} row
 * @returns {string[]}
 */
export function productShortNamesFromVoyageRow(row) {
  const names = commodityShortNamesFromRow({
    commodityShortDisplay: row.commodity,
    totalQtyDisplay: row.totalQtyDisplay,
    cargoBreakdownSummary: row.cargoBreakdownSummary,
  })
  if (names.length) return names
  const raw = String(row.commodity ?? '').trim()
  if (!raw || raw === '—') return ['Unknown']
  if (COMMODITY_SHORT_SPLIT.test(raw)) {
    return raw
      .split(COMMODITY_SHORT_SPLIT)
      .map((p) => p.trim())
      .filter(Boolean)
  }
  return [raw]
}

function sliceFlowRate(slice) {
  const canonical = slice?.productRateMtH
  if (canonical != null && Number.isFinite(canonical) && canonical > 0) return canonical
  return null
}

/**
 * One voyage → one or more product slices (shared voyage times, per-product qty).
 * @param {object} row normalized dashboard row
 * @returns {object[]}
 */
export function expandVoyageToProductSlices(row) {
  const names = productShortNamesFromVoyageRow(row)
  const qtyMap = parseProductQtyMap(row.totalQtyDisplay)
  const voyageQty = Number(row.qty) || 0

  if (names.length === 1) {
    const label = names[0]
    const key = productKeyFromCommodity(label)
    const qty = qtyMap.get(label) ?? (qtyMap.size === 0 ? voyageQty : qtyMap.get(label) ?? 0)
    const rateEntry = row.productRatesByKey?.[key]
    const slice = {
      ...row,
      productLabel: label,
      productKey: key,
      qty: qty || voyageQty,
      productRateMtH: rateEntry?.rateMtH ?? null,
      productMovedQty: rateEntry?.movedQty ?? null,
      productLoggedHours: rateEntry?.loggedHours ?? null,
      productRateSource: rateEntry?.source ?? null,
    }
    return [slice]
  }

  const qtyFromLines = names.reduce((s, n) => s + (qtyMap.get(n) || 0), 0)
  const equalFallback = voyageQty > 0 && qtyFromLines <= 0 ? voyageQty / names.length : null

  return names.map((label) => {
    const key = productKeyFromCommodity(label)
    let qty = qtyMap.get(label)
    if (qty == null || qty <= 0) {
      qty = equalFallback != null ? equalFallback : 0
    }
    const rateEntry = row.productRatesByKey?.[key]
    return {
      ...row,
      productLabel: label,
      productKey: key,
      qty,
      productRateMtH: rateEntry?.rateMtH ?? null,
      productMovedQty: rateEntry?.movedQty ?? null,
      productLoggedHours: rateEntry?.loggedHours ?? null,
      productRateSource: rateEntry?.source ?? null,
    }
  })
}

function meanField(rows, pick) {
  const vals = rows.map(pick).filter((x) => x != null && Number.isFinite(x))
  return vals.length ? mean(vals) : null
}

function countLogged(rows, pick) {
  return rows.filter((r) => {
    const v = pick(r)
    return v != null && Number.isFinite(v)
  }).length
}

/**
 * @param {Array<object>} rows deduped sailed rows in period
 * @param {{ purposeFilter?: 'All' | 'Loading' | 'Unloading' }} opts
 */
export function aggregateByProduct(rows, opts = {}) {
  const purposeFilter = opts.purposeFilter ?? 'All'
  const list = Array.isArray(rows) ? rows : []

  /** @type {Map<string, { key: string, label: string, purpose: string, voyages: object[] }>} */
  const groups = new Map()

  for (const r of list) {
    if (r.purpose !== 'Loading' && r.purpose !== 'Unloading') continue
    if (purposeFilter !== 'All' && r.purpose !== purposeFilter) continue
    for (const slice of expandVoyageToProductSlices(r)) {
      const gk = `${r.purpose}|${slice.productKey}`
      let g = groups.get(gk)
      if (!g) {
        g = { key: slice.productKey, label: slice.productLabel, purpose: r.purpose, voyages: [] }
        groups.set(gk, g)
      }
      g.voyages.push(slice)
    }
  }

  /** @param {object} g */
  function toProductRow(g) {
    const { voyages } = g
    const n = voyages.length
    return {
      key: g.key,
      label: g.label,
      purpose: g.purpose,
      shipments: n,
      throughputMt: voyages.reduce((s, r) => s + (Number(r.qty) || 0), 0),
      avgWait: meanField(voyages, (r) => r.wait),
      avgPre: meanField(voyages, (r) => r.pre),
      avgRate: meanField(voyages, (r) => sliceFlowRate(r)),
      avgCargoDoneToSail: meanField(voyages, (r) => r.cargoDoneToSailH),
      coverage: {
        total: n,
        waitLogged: countLogged(voyages, (r) => r.wait),
        preLogged: countLogged(voyages, (r) => r.pre),
        rateLogged: countLogged(voyages, (r) => sliceFlowRate(r)),
        cargoDoneToSailLogged: countLogged(voyages, (r) => r.cargoDoneToSailH),
      },
      voyages,
    }
  }

  const sortRows = (a, b) => {
    if (b.shipments !== a.shipments) return b.shipments - a.shipments
    return b.throughputMt - a.throughputMt
  }

  const incoming = [...groups.values()]
    .filter((g) => g.purpose === 'Unloading')
    .map(toProductRow)
    .sort(sortRows)

  const outgoing = [...groups.values()]
    .filter((g) => g.purpose === 'Loading')
    .map(toProductRow)
    .sort(sortRows)

  return { incoming, outgoing }
}

/**
 * Voyages that carried a product (includes multi-commodity calls).
 * @param {Array<object>} rows
 * @param {string} productKey
 * @param {'Loading' | 'Unloading'} purpose
 */
export function voyagesForProduct(rows, productKey, purpose) {
  const pk = String(productKey || '').toUpperCase()
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    if (r.purpose !== purpose) return false
    return expandVoyageToProductSlices(r).some((s) => s.productKey === pk)
  })
}

/**
 * Qty (MT) for one product on a voyage row (for drill-down).
 * @param {object} row
 * @param {string} productKey
 */
export function productQtyOnVoyage(row, productKey) {
  const pk = String(productKey || '').toUpperCase()
  const slice = expandVoyageToProductSlices(row).find((s) => s.productKey === pk)
  return slice?.qty ?? null
}
