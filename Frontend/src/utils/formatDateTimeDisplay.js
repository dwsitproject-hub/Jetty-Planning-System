/**
 * Global datetime display helpers (no " LT" suffix).
 *
 * Use everywhere you show user-facing date/times:
 *   import { formatDateTimeDisplay, formatDateDisplay, stripLegacyDatetimeLt } from '../utils/formatDateTimeDisplay'
 *
 * - formatDateTimeDisplay: ISO / timestamps → `DD/MMM/YYYY HH:mm` (24h, locale-aware via `jps_locale`: en → en-GB, id → id-ID).
 *   Unparseable strings are returned with a trailing ` LT` removed (legacy API/cache).
 * - formatDateDisplay: date-only values → `DD/MMM/YYYY`.
 * - stripLegacyDatetimeLt: only removes a trailing ` LT` / ` lt` from a string.
 */

import { JPS_LOCALE_STORAGE_KEY } from '../i18n/constants.js'

const YMD = /^\d{4}-\d{2}-\d{2}$/

/** @returns {'en-GB'|'id-ID'} */
export function getAppLocaleTag() {
  try {
    if (localStorage.getItem(JPS_LOCALE_STORAGE_KEY) === 'id') return 'id-ID'
  } catch {
    /* ignore */
  }
  return 'en-GB'
}

/**
 * @param {Intl.DateTimeFormatPart[]} parts
 */
function partsByType(parts) {
  const byType = {}
  for (const p of parts) {
    if (p.type !== 'literal') byType[p.type] = p.value
  }
  return byType
}

/**
 * @param {Date} d
 * @param {'en-GB'|'id-ID'} localeTag
 */
function formatDayMonthYear(d, localeTag) {
  const parts = new Intl.DateTimeFormat(localeTag, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).formatToParts(d)
  const byType = partsByType(parts)
  const day = String(byType.day ?? '').padStart(2, '0')
  const month = byType.month ?? ''
  const year = byType.year ?? ''
  if (!day || !month || !year) {
    return null
  }
  return `${day}/${month}/${year}`
}

/**
 * @param {Date} d
 * @param {'en-GB'|'id-ID'} localeTag
 */
function formatDayMonthYearHourMinute(d, localeTag) {
  const parts = new Intl.DateTimeFormat(localeTag, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d)
  const byType = partsByType(parts)
  const day = String(byType.day ?? '').padStart(2, '0')
  const month = byType.month ?? ''
  const year = byType.year ?? ''
  const hour = String(byType.hour ?? '').padStart(2, '0')
  const minute = String(byType.minute ?? '').padStart(2, '0')
  if (!day || !month || !year) {
    return null
  }
  return `${day}/${month}/${year} ${hour}:${minute}`
}

/**
 * @param {Date} d
 * @param {'en-GB'|'id-ID'} localeTag
 */
function fallbackDayMonthYear(d, localeTag) {
  const day = String(d.getDate()).padStart(2, '0')
  const month = d.toLocaleString(localeTag, { month: 'short' })
  const year = String(d.getFullYear())
  return `${day}/${month}/${year}`
}

/**
 * @param {Date} d
 * @param {'en-GB'|'id-ID'} localeTag
 */
function fallbackDayMonthYearHourMinute(d, localeTag) {
  const datePart = fallbackDayMonthYear(d, localeTag)
  const hours = String(d.getHours()).padStart(2, '0')
  const mins = String(d.getMinutes()).padStart(2, '0')
  return `${datePart} ${hours}:${mins}`
}

/**
 * @param {unknown} value
 * @returns {{ raw: string, d: Date } | null}
 */
function parseDisplayValue(value) {
  if (value == null || value === '') return null

  const raw = String(value).trim()
  if (!raw) return null

  if (YMD.test(raw)) {
    const d = new Date(`${raw}T12:00:00`)
    if (!Number.isNaN(d.getTime())) return { raw, d }
  }

  let d = new Date(raw)
  if (Number.isNaN(d.getTime()) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw)) {
    d = new Date(raw.slice(0, 16))
  }

  if (!Number.isNaN(d.getTime())) return { raw, d }
  return null
}

/** @param {unknown} value */
export function stripLegacyDatetimeLt(value) {
  if (value == null) return ''
  return String(value)
    .trim()
    .replace(/\s+LT\s*$/i, '')
    .trim()
}

/**
 * @param {unknown} value ISO string, timestamp, YYYY-MM-DD, datetime-local prefix, or preformatted display string (optional legacy ` LT`)
 * @returns {string}
 */
export function formatDateDisplay(value) {
  const parsed = parseDisplayValue(value)
  if (!parsed) {
    if (value == null || value === '') return '—'
    const stripped = stripLegacyDatetimeLt(value)
    return stripped || '—'
  }

  const localeTag = getAppLocaleTag()
  const formatted = formatDayMonthYear(parsed.d, localeTag)
  if (formatted) return formatted
  return fallbackDayMonthYear(parsed.d, localeTag)
}

/**
 * @param {unknown} value ISO string, timestamp, datetime-local prefix, or preformatted display string (optional legacy ` LT`)
 * @returns {string}
 */
export function formatDateTimeDisplay(value) {
  const parsed = parseDisplayValue(value)
  if (!parsed) {
    if (value == null || value === '') return '—'
    const stripped = stripLegacyDatetimeLt(value)
    return stripped || '—'
  }

  const localeTag = getAppLocaleTag()
  const formatted = formatDayMonthYearHourMinute(parsed.d, localeTag)
  if (formatted) return formatted
  return fallbackDayMonthYearHourMinute(parsed.d, localeTag)
}
