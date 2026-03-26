/**
 * Printed SI sign-off date line (no place name): "25 MARCH 2026".
 *
 * Date source:
 * - If `approvedAt` is set (SI approved in JPS), use that — server sets it at sign-off.
 * - Otherwise: **document date** (SI form field), then **createdAt** (receivedAt), then today.
 *
 * documentDate from the API may be "YYYY-MM-DD" or full ISO — never append `T12:00:00` to an
 * already-full ISO string (Invalid Date / NaN in UI).
 */

const YMD = /^\d{4}-\d{2}-\d{2}$/

/**
 * @param {unknown} documentDate
 * @param {unknown} fallbackIso e.g. createdAt
 * @returns {string} ISO-ish string parseable by Date
 */
export function siPlaceLineInstantIso(documentDate, fallbackIso) {
  if (documentDate != null && documentDate !== '') {
    const s = String(documentDate).trim()
    const head = s.length >= 10 ? s.slice(0, 10) : s
    if (YMD.test(head)) {
      return `${head}T12:00:00`
    }
    const d = new Date(s)
    if (!Number.isNaN(d.getTime())) return d.toISOString()
  }
  if (fallbackIso != null && fallbackIso !== '') {
    const d = new Date(fallbackIso)
    if (!Number.isNaN(d.getTime())) return d.toISOString()
  }
  return new Date().toISOString()
}

function formatDayMonthYearUpper(d) {
  const day = d.getDate()
  const month = d.toLocaleString('en-GB', { month: 'long' }).toUpperCase()
  const year = d.getFullYear()
  return `${day} ${month} ${year}`
}

/**
 * Sign-off area: date only. Uses approval timestamp when present.
 * @param {unknown} documentDate SI document date field
 * @param {unknown} receivedAt createdAt
 * @param {unknown} [approvedAt] set by API when status is Approved
 */
export function formatSiSignOffDate(documentDate, receivedAt, approvedAt) {
  let instant
  if (approvedAt != null && approvedAt !== '') {
    const a = new Date(approvedAt)
    if (!Number.isNaN(a.getTime())) {
      instant = a
    }
  }
  if (!instant) {
    const raw = siPlaceLineInstantIso(documentDate, receivedAt)
    instant = new Date(raw)
  }
  if (Number.isNaN(instant.getTime())) return '—'
  return formatDayMonthYearUpper(instant)
}

/** Document date on the SI (calendar day only; safe for YYYY-MM-DD or ISO). */
export function formatSiCalendarDateOnly(value) {
  if (value == null || value === '') return '—'
  const s = String(value).trim()
  const head = s.length >= 10 ? s.slice(0, 10) : s
  if (YMD.test(head)) {
    const d = new Date(`${head}T12:00:00`)
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    }
  }
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** System timestamps (created / updated / approved). */
export function formatSiDateTime(iso) {
  if (iso == null || iso === '') return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
}
