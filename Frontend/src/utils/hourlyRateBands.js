/**
 * Management Dashboard By Voyage — "Hours by rate" bands and commodity filter helpers.
 * Band hours come from GET /operations/management-hourly-rates (see Backend management-hourly-rate-profile.js).
 */
import { voyageMovedQtyLines } from './managementDashboardProduct.js'

export const RATE_BAND_DEFS = [
  { key: 'gt100', name: 'Very fast', range: '>100 MT/h', color: '#0C447C' },
  { key: '75_100', name: 'Fast', range: '75–100 MT/h', color: '#185FA5' },
  { key: '50_75', name: 'Moderate', range: '50–75 MT/h', color: '#378ADD' },
  { key: '25_50', name: 'Slow', range: '25–50 MT/h', color: '#85B7EB' },
  { key: '0_25', name: 'Very slow', range: '0–25 MT/h', color: '#B5D4F4' },
  { key: 'zero', name: 'No flow', range: '0 MT/h', color: '#B4B2A9' },
]

/** Hourly rate (MT/h) at or above this counts as "fast". */
export const FAST_RATE_MTH = 75

export const HOURS_BY_RATE_VIEWS = [
  { key: 'pie', label: 'Pie' },
  { key: 'line', label: 'Line' },
  { key: 'bar', label: 'Bar' },
]

/** @param {{ bands?: Record<string, number> } | null | undefined} profile */
export function profileTotalHours(profile) {
  if (!profile?.bands) return 0
  return RATE_BAND_DEFS.reduce((s, b) => s + (Number(profile.bands[b.key]) || 0), 0)
}

function bandShare(profile, keys) {
  const total = profileTotalHours(profile)
  if (!(total > 0)) return null
  return keys.reduce((s, k) => s + (Number(profile.bands[k]) || 0), 0) / total
}

/** Share (0–1) of operational hours at ≥75 MT/h. Null without hourly data. */
export function fastShare(profile) {
  return bandShare(profile, ['gt100', '75_100'])
}

/** Share (0–1) of operational hours with no cargo flow. Null without hourly data. */
export function noFlowShare(profile) {
  return bandShare(profile, ['zero'])
}

/** CSS conic-gradient for a full pie of the band hours. */
export function bandPieGradient(profile) {
  const total = profileTotalHours(profile)
  if (!(total > 0)) return 'none'
  let acc = 0
  const stops = RATE_BAND_DEFS.map((b) => {
    const start = acc
    acc += ((Number(profile.bands[b.key]) || 0) / total) * 100
    return `${b.color} ${start.toFixed(2)}% ${acc.toFixed(2)}%`
  })
  return `conic-gradient(${stops.join(', ')})`
}

/**
 * Shared y-axis max for line views in one table: p95 of hourly rates rounded up to 50, at least 100.
 * @param {Array<{ hourlyProfile?: { series?: Array<{ r: number | null }> } }>} rows
 */
export function lineScaleMax(rows) {
  const rates = []
  for (const r of rows || []) {
    for (const p of r?.hourlyProfile?.series || []) if (p.r > 0) rates.push(p.r)
  }
  if (!rates.length) return 100
  rates.sort((a, b) => a - b)
  const p95 = rates[Math.min(rates.length - 1, Math.floor(rates.length * 0.95))]
  return Math.max(100, Math.ceil(p95 / 50) * 50)
}

/** Distinct commodity group labels on a voyage row. */
export function voyageCommodityLabels(row) {
  return [...new Set(voyageMovedQtyLines(row).map((l) => l.label).filter(Boolean))]
}

/**
 * Filter chip options, most voyages first.
 * @param {object[]} rows
 * @returns {Array<{ label: string, count: number }>}
 */
export function commodityFilterOptions(rows) {
  const counts = new Map()
  for (const r of rows || []) {
    for (const label of voyageCommodityLabels(r)) counts.set(label, (counts.get(label) || 0) + 1)
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

/**
 * Keep voyages carrying any selected commodity. Empty selection keeps all.
 * @param {object[]} rows
 * @param {Set<string>} selected
 */
export function filterVoyagesByCommodity(rows, selected) {
  const list = Array.isArray(rows) ? rows : []
  if (!selected?.size) return list
  return list.filter((r) => voyageCommodityLabels(r).some((label) => selected.has(label)))
}
