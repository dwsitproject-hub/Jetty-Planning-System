/**
 * Red stop marks on an actual Gantt bar: where each recorded stop sits inside the bar, and the
 * hover text. A stop without an end runs until now. Stops outside the bar are left out.
 */

const ms = (v) => (v == null ? NaN : new Date(v).getTime())

/**
 * @param {Array<{ id: string, startedAt: string, endedAt: string|null }>} stops
 * @returns {Array<{ key: string, leftPct: number, widthPct: number, stop: object, hours: number }>}
 */
export function buildStopMarks(stops, barStartMs, barEndMs, nowMs = Date.now()) {
  const span = barEndMs - barStartMs
  if (!Array.isArray(stops) || !(span > 0)) return []
  const marks = []
  for (const stop of stops) {
    const s = ms(stop.startedAt)
    const e = stop.endedAt ? ms(stop.endedAt) : nowMs
    if (!Number.isFinite(s) || !Number.isFinite(e)) continue
    const from = Math.max(s, barStartMs)
    const to = Math.min(e, barEndMs)
    if (to <= from) continue
    marks.push({
      key: stop.id,
      leftPct: ((from - barStartMs) / span) * 100,
      widthPct: ((to - from) / span) * 100,
      stop,
      hours: (e - s) / 3600000,
    })
  }
  return marks
}

const CATEGORY_EN = { terminal: 'Terminal', vessel: 'Vessel', kuras_crew: 'Kuras crew', external: 'External', other: 'Other', unexplained: 'No reason yet' }
const CATEGORY_ID = { terminal: 'Terminal', vessel: 'Kapal', kuras_crew: 'Tim kuras', external: 'Eksternal', other: 'Lainnya', unexplained: 'Belum ada alasan' }

/** Hover text: reason, who caused it, length, times and note. */
export function stopMarkTitle(mark, language, formatAt) {
  const id = String(language || '').startsWith('id')
  const { stop } = mark
  const name = (id ? stop.reasonNameId : stop.reasonNameEn) || stop.reasonNameEn || stop.reasonNameId || stop.reasonCode
  const category = (id ? CATEGORY_ID : CATEGORY_EN)[stop.category] || stop.category
  const end = stop.endedAt ? formatAt(stop.endedAt) : id ? 'berlangsung' : 'in progress'
  const head = stop.needsReason ? name : `${name} · ${category}`
  const lines = [head, `${formatAt(stop.startedAt)} – ${end} · ${mark.hours.toFixed(1)} h`]
  if (stop.note) lines.push(stop.note)
  return lines.join('\n')
}
