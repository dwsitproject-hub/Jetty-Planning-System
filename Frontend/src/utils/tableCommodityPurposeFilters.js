import { resolvePurposeLabel } from './resolvePurposeLabel.js'

const COMMODITY_SHORT_SPLIT = /\s*[·,;/|]\s*/

function addCommodityShortName(set, raw) {
  const text = String(raw || '').trim()
  if (!text || text === '—') return
  for (const part of text.split(COMMODITY_SHORT_SPLIT)) {
    const name = part.trim()
    if (name) set.add(name)
  }
}

function addCommodityShortsFromQtyDisplay(set, qty) {
  const text = String(qty || '')
  for (const line of text.split(/\n/)) {
    const match = line.trim().match(/^([A-Za-z][A-Za-z0-9._/-]*)\s+[\d]/)
    if (match) set.add(match[1])
  }
}

function collectFromCargoSource(names, source) {
  if (!source) return
  addCommodityShortName(names, source.commodityShortDisplay)
  addCommodityShortsFromQtyDisplay(
    names,
    source.totalQtyDisplay || source.totalQty || source.commodityQty || source.commodityQtyDisplay
  )
  const breakdown = source.cargoBreakdownSummary || source.breakdown
  if (Array.isArray(breakdown)) {
    for (const line of breakdown) {
      addCommodityShortName(
        names,
        line?.commodityShortName || line?.commodity_short_name || line?.commodityShortDisplay
      )
    }
  }
}

export const PURPOSE_FILTER_OPTIONS = ['Loading', 'Unloading']
/** @deprecated Use PURPOSE_FILTER_OPTIONS */
export const CLEARANCE_PURPOSE_OPTIONS = PURPOSE_FILTER_OPTIONS

/**
 * Distinct commodity short names on a queue/plan row (CPO, FAME, …).
 * Also walks nested shippingInstructions and planQueueSiEntries.
 * @param {object} row
 * @returns {string[]}
 */
export function commodityShortNamesFromRow(row) {
  const names = new Set()
  collectFromCargoSource(names, row)
  const nested = [...(row?.shippingInstructions || []), ...(row?.planQueueSiEntries || [])]
  for (const si of nested) collectFromCargoSource(names, si)
  return [...names]
}

/**
 * @param {object[]} rows
 * @returns {string[]}
 */
export function uniqueCommodityShortOptions(rows) {
  const names = new Set()
  for (const row of rows || []) {
    for (const name of commodityShortNamesFromRow(row)) names.add(name)
  }
  return [...names].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
}

/**
 * @param {object} row
 * @param {string|null|undefined} selected
 * @returns {boolean}
 */
export function rowMatchesCommodityShort(row, selected) {
  const want = String(selected || '').trim().toLowerCase()
  if (!want) return true
  return commodityShortNamesFromRow(row).some((name) => name.toLowerCase() === want)
}

/**
 * Keep a grouped plan when any child SI matches the selected short name.
 * @param {object[]} children
 * @param {string|null|undefined} selected
 * @returns {boolean}
 */
export function groupMatchesCommodityShort(children, selected) {
  if (!String(selected || '').trim()) return true
  return (children || []).some((row) => rowMatchesCommodityShort(row, selected))
}

/**
 * @param {object} row
 * @param {string|null|undefined} selected
 * @returns {boolean}
 */
export function rowMatchesPurpose(row, selected) {
  const want = String(selected || '').trim()
  if (!want) return true
  const label = resolvePurposeLabel(row?.purpose ?? row?.purposeCode, row?.loadDischarge)
  return label.toLowerCase() === want.toLowerCase()
}

/**
 * Mixed-purpose groups only match when Purpose is All.
 * @param {object[]} children
 * @param {string|null|undefined} selected
 * @returns {boolean}
 */
export function groupMatchesPurpose(children, selected) {
  const want = String(selected || '').trim()
  if (!want) return true
  const labels = [
    ...new Set(
      (children || [])
        .map((c) => resolvePurposeLabel(c?.purpose ?? c?.purposeCode, c?.loadDischarge))
        .filter(Boolean)
    ),
  ]
  if (labels.length !== 1) return false
  return labels[0].toLowerCase() === want.toLowerCase()
}

/**
 * Mixed-label groups only match when the dropdown is All.
 * @param {object[]} children
 * @param {string|null|undefined} selected
 * @param {(row: object) => unknown} pick
 * @returns {boolean}
 */
export function groupMatchesExactLabel(children, selected, pick) {
  const want = String(selected || '').trim()
  if (!want) return true
  const labels = [
    ...new Set(
      (children || [])
        .map((c) => {
          const v = pick(c)
          return v == null ? '' : String(v).trim()
        })
        .filter(Boolean)
    ),
  ]
  if (labels.length !== 1) return false
  return labels[0] === want
}
