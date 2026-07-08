/**
 * Schedule wall times ↔ API instants (Luxon).
 * Naive `YYYY-MM-DDTHH:mm` from `<input type="datetime-local" />` is interpreted in the
 * IANA zone passed as `scheduleIana` (use `getScheduleEntryTimeZone()` for normal schedule UIs).
 */
import { DateTime } from 'luxon'

export const DEFAULT_SCHEDULE_TIMEZONE = 'Asia/Jakarta'

export function getClientIanaTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_SCHEDULE_TIMEZONE
  } catch {
    return DEFAULT_SCHEDULE_TIMEZONE
  }
}

/** Browser IANA zone used to interpret and emit schedule `datetime-local` values (not port metadata). */
export function getScheduleEntryTimeZone() {
  return getClientIanaTimeZone()
}

/** Current wall clock in the port schedule zone as `YYYY-MM-DDTHH:mm` */
export function nowToNaiveLocalInScheduleZone(scheduleIana) {
  const zone = scheduleIana?.trim() || DEFAULT_SCHEDULE_TIMEZONE
  return DateTime.now().setZone(zone).toFormat("yyyy-MM-dd'T'HH:mm")
}

/** API ISO / timestamptz → `YYYY-MM-DDTHH:mm` in schedule zone for datetime-local */
export function utcIsoToNaiveLocal(iso, scheduleIana) {
  if (!iso) return ''
  const zone = scheduleIana?.trim() || DEFAULT_SCHEDULE_TIMEZONE
  const s = String(iso).trim()
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) return s
  let dt = DateTime.fromISO(s, { setZone: true })
  if (!dt.isValid) {
    const d = new Date(s)
    if (Number.isNaN(d.getTime())) return ''
    dt = DateTime.fromJSDate(d, { zone: 'utc' })
  }
  if (!dt.isValid) return ''
  return dt.setZone(zone).toFormat("yyyy-MM-dd'T'HH:mm")
}

/** Naive datetime-local → ISO UTC string */
export function naiveLocalToUtcIso(naive, scheduleIana) {
  if (!naive || String(naive).trim() === '') return ''
  const zone = scheduleIana?.trim() || DEFAULT_SCHEDULE_TIMEZONE
  const v = String(naive).trim()
  const hasSeconds = /T\d{2}:\d{2}:\d{2}/.test(v)
  const fmt = hasSeconds ? "yyyy-MM-dd'T'HH:mm:ss" : "yyyy-MM-dd'T'HH:mm"
  const base = hasSeconds ? v.slice(0, 19) : v.slice(0, 16)
  const dt = DateTime.fromFormat(base, fmt, { zone })
  if (!dt.isValid) throw new Error('Invalid date or time')
  return dt.toUTC().toISO()
}

/**
 * For API payloads: empty → null; RFC3339 / ISO with zone → UTC ISO; naive → interpreted in schedule zone.
 * @returns {string|null|undefined}
 */
export function normalizeForApi(value, scheduleIana) {
  if (value === undefined) return undefined
  if (value === null || String(value).trim() === '') return null
  const s = String(value).trim()
  const zone = scheduleIana?.trim() || DEFAULT_SCHEDULE_TIMEZONE
  if (/[Zz]$/.test(s) || /[+-]\d{2}:\d{2}$/.test(s) || /[+-]\d{4}$/.test(s)) {
    const d = new Date(s)
    if (Number.isNaN(d.getTime())) throw new Error('Invalid date or time')
    return d.toISOString()
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?$/.test(s)) {
    return naiveLocalToUtcIso(s, zone)
  }
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) throw new Error('Invalid date or time')
  return d.toISOString()
}

/** Same as normalizeForApi but empty → '' for endpoints that expect string fields */
export function normalizeForApiOrEmpty(value, scheduleIana) {
  if (value === undefined) return undefined
  if (value === null || String(value).trim() === '') return ''
  return normalizeForApi(value, scheduleIana)
}
