/**
 * Global datetime display helpers (no " LT" suffix).
 *
 * Use everywhere you show user-facing date/times:
 *   import { formatDateTimeDisplay, stripLegacyDatetimeLt } from '../utils/formatDateTimeDisplay'
 *
 * - formatDateTimeDisplay: ISO / timestamps → `dd/mm HH:mm` (locale-aware via `jps_locale`: en → en-GB, id → id-ID).
 *   Unparseable strings are returned with a trailing ` LT` removed (legacy API/cache).
 * - stripLegacyDatetimeLt: only removes a trailing ` LT` / ` lt` from a string.
 */

import { JPS_LOCALE_STORAGE_KEY } from '../i18n/constants.js'

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
 * @param {Date} d
 * @param {'en-GB'|'id-ID'} localeTag
 */
function formatDayMonthHourMinute(d, localeTag) {
  const parts = new Intl.DateTimeFormat(localeTag, {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d)
  const byType = {}
  for (const p of parts) {
    if (p.type !== 'literal') byType[p.type] = p.value
  }
  const day = String(byType.day ?? '').padStart(2, '0')
  const month = String(byType.month ?? '').padStart(2, '0')
  const hour = String(byType.hour ?? '').padStart(2, '0')
  const minute = String(byType.minute ?? '').padStart(2, '0')
  if (!day || !month) {
    return null
  }
  return `${day}/${month} ${hour}:${minute}`
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
 * @param {unknown} value ISO string, timestamp, datetime-local prefix, or preformatted `dd/mm HH:mm` (optional legacy ` LT`)
 * @returns {string}
 */
export function formatDateTimeDisplay(value) {
  if (value == null || value === '') return '—'

  const raw = String(value).trim()
  if (!raw) return '—'

  let d = new Date(raw)
  if (Number.isNaN(d.getTime()) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw)) {
    d = new Date(raw.slice(0, 16))
  }

  if (!Number.isNaN(d.getTime())) {
    const localeTag = getAppLocaleTag()
    const formatted = formatDayMonthHourMinute(d, localeTag)
    if (formatted) return formatted
    const day = String(d.getDate()).padStart(2, '0')
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const hours = String(d.getHours()).padStart(2, '0')
    const mins = String(d.getMinutes()).padStart(2, '0')
    return `${day}/${month} ${hours}:${mins}`
  }

  const stripped = stripLegacyDatetimeLt(raw)
  return stripped || '—'
}
