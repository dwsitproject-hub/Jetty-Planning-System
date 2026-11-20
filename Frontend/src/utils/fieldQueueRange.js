/**
 * Cast-off date range for the field menus' "Sailed" filter (QC Sampling, Custom Clearance).
 * The user picks calendar days in local time; the API receives the half-open instant range
 * [start of `from`, start of the day after `to`).
 */
export const SAILED_DEFAULT_DAYS = 30
export const SAILED_MAX_DAYS = 366

const DAY_MS = 24 * 60 * 60 * 1000

function ymd(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function localMidnight(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''))
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(d.getTime()) ? null : d
}

/** Today and the 30 days before it, as `YYYY-MM-DD` values for date inputs. */
export function defaultSailedRange(now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const from = new Date(today)
  from.setDate(from.getDate() - SAILED_DEFAULT_DAYS)
  return { from: ymd(from), to: ymd(today) }
}

/** `null` when usable, else an error code: 'required' | 'order' | 'tooLong'. */
export function sailedRangeError(range) {
  const from = localMidnight(range?.from)
  const to = localMidnight(range?.to)
  if (!from || !to) return 'required'
  if (from.getTime() > to.getTime()) return 'order'
  if (to.getTime() - from.getTime() >= SAILED_MAX_DAYS * DAY_MS) return 'tooLong'
  return null
}

/** API params for a valid range: whole local days, `to` inclusive. */
export function sailedRangeParams(range) {
  const from = localMidnight(range.from)
  const end = localMidnight(range.to)
  end.setDate(end.getDate() + 1)
  return { scope: 'sailed', from: from.toISOString(), to: end.toISOString() }
}

/** Query string for a queue request ('' for the berthed queue). */
export function fieldQueueQuery(params) {
  if (!params?.scope) return ''
  const q = new URLSearchParams()
  for (const key of ['scope', 'from', 'to']) {
    if (params[key]) q.set(key, params[key])
  }
  return `?${q.toString()}`
}
