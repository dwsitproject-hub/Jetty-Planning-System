/**
 * Global datetime display helpers (no " LT" suffix).
 *
 * Use everywhere you show user-facing date/times:
 *   import { formatDateTimeDisplay, stripLegacyDatetimeLt } from '../utils/formatDateTimeDisplay'
 *
 * - formatDateTimeDisplay: ISO / timestamps → `dd/mm HH:mm` (browser local). Unparseable strings
 *   are returned with a trailing ` LT` removed (legacy API/cache).
 * - stripLegacyDatetimeLt: only removes a trailing ` LT` / ` lt` from a string.
 */

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
    const day = String(d.getDate()).padStart(2, '0')
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const hours = String(d.getHours()).padStart(2, '0')
    const mins = String(d.getMinutes()).padStart(2, '0')
    return `${day}/${month} ${hours}:${mins}`
  }

  const stripped = stripLegacyDatetimeLt(raw)
  return stripped || '—'
}
