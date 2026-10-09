/**
 * Cargo done → sailed off interval for Management Dashboard.
 * Aligns with Daily Activities report cargo + post-check categories.
 */
import { mapEventToTemplateId } from '../data/dailyActivitiesReportFromApi.js'

export const CARGO_DONE_TEMPLATE_IDS = new Set([
  'op_cargo_operations',
  'post_final_inspection',
  'post_final_cargo_checking',
])

const H = 3600000

function ms(v) {
  if (!v) return null
  const t = new Date(v).getTime()
  return Number.isNaN(t) ? null : t
}

/**
 * Latest instant when cargo work is finished (cargo ops + post-checking on executions log).
 * @param {Array<object> | null | undefined} events activity-timeline events
 * @returns {string | null} ISO timestamp
 */
export function cargoDoneAtFromTimeline(events) {
  const arr = Array.isArray(events) ? events : []
  let latest = null
  for (const ev of arr) {
    const tid = mapEventToTemplateId(ev)
    if (!tid || !CARGO_DONE_TEMPLATE_IDS.has(tid)) continue
    const endMs = ms(ev.endAt) ?? ms(ev.startAt)
    if (endMs == null) continue
    if (latest == null || endMs > latest) latest = endMs
  }
  if (latest == null) return null
  return new Date(latest).toISOString()
}

/**
 * Leave clock is Cast Off (`castOff`). Do not use sailedAt (clerk recorded-at).
 * @param {{ cargoDoneAt?: string | null, castOff?: string | null }} opts
 * @returns {number | null} hours
 */
export function cargoDoneToSailHours({ cargoDoneAt, castOff }) {
  const a = ms(cargoDoneAt)
  const b = ms(castOff)
  if (a == null || b == null || b <= a) return null
  return +(((b - a) / H).toFixed(1))
}

/**
 * @param {Array<object> | null | undefined} events
 * @param {string | null | undefined} castOff
 * @returns {number | null}
 */
export function cargoDoneToSailFromTimeline(events, castOff) {
  const cargoDoneAt = cargoDoneAtFromTimeline(events)
  return cargoDoneToSailHours({ cargoDoneAt, castOff })
}

/**
 * Hours shown for Cargo done → sailed off. Null stays out of the mean.
 * Ignores Post-Checking subprocess duration (`post`).
 * @param {object | null | undefined} row
 * @returns {number | null}
 */
export function cargoDoneToSailDisplayHours(row) {
  const h = row?.cargoDoneToSailH
  return h != null && Number.isFinite(h) ? h : null
}

/**
 * Leftover alongside time after berth→start, cargo ops, and cargo-done→sail.
 * Missing phases count as 0 inside the residual only.
 * @param {object | null | undefined} row
 * @returns {number | null}
 */
export function idleHoursAtBerth(row) {
  if (row?.berth == null || !Number.isFinite(row.berth)) return null
  return Math.max(
    row.berth - (row.pre || 0) - (row.opsH || 0) - (cargoDoneToSailDisplayHours(row) || 0),
    0
  )
}
