/** Clearance Sailed-tab lookback windows (calendar days). */
export const SAILED_LOOKBACK_DAY_OPTIONS = [3, 7, 14]

/**
 * @param {string|null|undefined} iso
 * @returns {Date|null}
 */
export function parseClearanceInstant(iso) {
  if (iso == null || iso === '') return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Prefer Sailed At, then CAST Off.
 * @param {{ sailedAt?: string|null, castOffAt?: string|null }} row
 * @returns {Date|null}
 */
export function sailedLookbackTime(row) {
  return parseClearanceInstant(row?.sailedAt) || parseClearanceInstant(row?.castOffAt)
}

/**
 * @param {{ sailedAt?: string|null, castOffAt?: string|null }} row
 * @param {number|null|undefined} days
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isWithinSailedLookback(row, days, now = new Date()) {
  if (days == null) return true
  const t = sailedLookbackTime(row)
  if (!t) return false
  const sinceMs = now.getTime() - Number(days) * 24 * 60 * 60 * 1000
  return t.getTime() >= sinceMs
}

/**
 * @param {Array<{ apiStatus?: string, sailedAt?: string|null, castOffAt?: string|null }>} rows
 * @param {number|null|undefined} days
 * @param {Date} [now]
 * @returns {number}
 */
export function countSailedWithinDays(rows, days, now = new Date()) {
  const sailed = (rows || []).filter((r) => r.apiStatus === 'SAILED')
  if (days == null) return sailed.length
  return sailed.filter((r) => isWithinSailedLookback(r, days, now)).length
}

/**
 * Local calendar YYYY-MM-DD for an instant (matches on-screen CAST Off / Sailed At dates).
 * @param {Date} d
 * @returns {string}
 */
export function localYmd(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Inclusive from/to filter on local calendar dates. Empty bounds are ignored.
 * Rows with no timestamp are excluded when a bound is set.
 * @param {string|null|undefined} iso
 * @param {string|null|undefined} fromYmd
 * @param {string|null|undefined} toYmd
 * @returns {boolean}
 */
export function isIsoInLocalDateRange(iso, fromYmd, toYmd) {
  const from = typeof fromYmd === 'string' ? fromYmd.trim() : ''
  const to = typeof toYmd === 'string' ? toYmd.trim() : ''
  if (!from && !to) return true
  const d = parseClearanceInstant(iso)
  if (!d) return false
  const ymd = localYmd(d)
  if (from && ymd < from) return false
  if (to && ymd > to) return false
  return true
}

export {
  CLEARANCE_PURPOSE_OPTIONS,
  PURPOSE_FILTER_OPTIONS,
  commodityShortNamesFromRow,
  uniqueCommodityShortOptions,
  rowMatchesCommodityShort,
} from './tableCommodityPurposeFilters.js'
