/**
 * No-flow log display helpers: strip segments over the voyage flow window, durations,
 * reason names per language, and one merged, time-ordered stop list.
 */

const ms = (v) => new Date(v).getTime()

/** "2h 05m" / "45m" */
export function formatStopDuration(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0))
  const h = Math.floor(m / 60)
  const rest = String(m % 60).padStart(2, '0')
  return h > 0 ? `${h}h ${rest}m` : `${m % 60}m`
}

/** Reason label in the app language; accepts a reason option or a recorded stop. */
export function reasonName(reason, language) {
  if (!reason) return ''
  const en = reason.nameEn ?? reason.reasonNameEn ?? ''
  const id = reason.nameId ?? reason.reasonNameId ?? ''
  return String(language || '').startsWith('id') ? id || en : en || id
}

/** Recorded and unexplained stops in time order: { kind: 'event'|'unexplained', ...row }. */
export function mergeStops(summary) {
  const events = (summary?.events || []).map((e) => ({ ...e, kind: 'event', key: `e-${e.id}` }))
  const open = (summary?.unexplained || []).map((u) => ({ ...u, kind: 'unexplained', key: `u-${u.startedAt}` }))
  return [...events, ...open].sort((a, b) => ms(a.startedAt) - ms(b.startedAt))
}

/**
 * Strip segments as % widths across the flow window. Time not covered by a stop is "flow".
 * @returns {Array<{ kind: 'flow'|'event'|'unexplained', leftPct: number, widthPct: number, stop?: object }>}
 */
export function buildStripSegments(summary) {
  const w = summary?.window
  if (!w) return []
  const start = ms(w.startedAt)
  const total = ms(w.endedAt) - start
  if (!(total > 0)) return []
  const pct = (t) => Math.min(100, Math.max(0, ((t - start) / total) * 100))
  const out = []
  let cursor = 0
  for (const stop of mergeStops(summary)) {
    const left = pct(ms(stop.startedAt))
    const right = stop.endedAt ? pct(ms(stop.endedAt)) : 100
    if (right <= left) continue
    if (left > cursor) out.push({ kind: 'flow', leftPct: cursor, widthPct: left - cursor })
    out.push({ kind: stop.kind, leftPct: left, widthPct: right - left, stop })
    cursor = Math.max(cursor, right)
  }
  if (cursor < 100) out.push({ kind: 'flow', leftPct: cursor, widthPct: 100 - cursor })
  return out
}
