import { DateTime } from 'luxon'
import {
  computeCargoRatePerHour,
  formatQtyNumber,
  formatRateNumber,
  parseQtyDisplay,
} from './cargoQtyDisplay.js'

const DEFAULT_TIMEZONE = 'Asia/Jakarta'

/**
 * @param {string | null | undefined} iso
 * @param {string} timezone
 * @returns {string | null} YYYY-MM-DD in port local time
 */
export function localDateKeyFromIso(iso, timezone = DEFAULT_TIMEZONE) {
  if (!iso) return null
  const dt = DateTime.fromISO(String(iso), { setZone: true }).setZone(timezone || DEFAULT_TIMEZONE)
  if (!dt.isValid) return null
  return dt.toFormat('yyyy-MM-dd')
}

/**
 * @param {string} dateKey YYYY-MM-DD
 * @returns {string} e.g. "23 Jul"
 */
export function formatDailyRateDateLabel(dateKey) {
  if (!dateKey) return '—'
  const dt = DateTime.fromFormat(dateKey, 'yyyy-MM-dd')
  if (!dt.isValid) return dateKey
  return dt.toFormat('d LLL')
}

/**
 * @param {Array<{ qty?: number, startedAt?: string | null, endedAt?: string | null }>} lines
 * @param {string} timezone
 * @returns {Array<{ date: string, qtyMoved: number }>}
 */
export function buildDailyBarsFromLoadLines(lines, timezone = DEFAULT_TIMEZONE) {
  if (!Array.isArray(lines) || lines.length === 0) return []
  const byDate = new Map()
  for (const line of lines) {
    const qty = Number(line?.qty) || 0
    if (qty <= 0) continue
    const key = localDateKeyFromIso(line?.startedAt, timezone)
    if (!key) continue
    byDate.set(key, (byDate.get(key) || 0) + qty)
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, qtyMoved]) => ({ date, qtyMoved }))
}

/**
 * @param {Array<{ date: string, qtyMoved: number }>} buckets
 * @param {number} [nowMs]
 * @param {string} timezone
 * @returns {{ date: string, qtyMoved: number } | null}
 */
export function pickDisplayDailyRate(buckets, nowMs = Date.now(), timezone = DEFAULT_TIMEZONE) {
  if (!Array.isArray(buckets) || buckets.length === 0) return null
  const todayKey = DateTime.fromMillis(nowMs, { zone: timezone || DEFAULT_TIMEZONE }).toFormat('yyyy-MM-dd')
  const today = buckets.find((b) => b.date === todayKey)
  if (today) return today
  return buckets[buckets.length - 1]
}

/**
 * @param {number} qty
 * @param {string} unit
 * @param {string} dateKey
 * @returns {string}
 */
export function formatDailyRateLine(qty, unit, dateKey) {
  const v = Number(qty) || 0
  const u = unit || 'MT'
  return `${formatRateNumber(v)} ${u} / Day (${formatDailyRateDateLabel(dateKey)})`
}

/**
 * @param {unknown[]} events activity timeline events
 * @returns {Array<{ qty: number, startedAt: string, endedAt: string | null }>}
 */
export function extractCargoLoadLinesFromTimeline(events) {
  const out = []
  if (!Array.isArray(events)) return out
  for (const ev of events) {
    if (ev?.milestoneKey !== 'cargo_operations') continue
    const loadLines = Array.isArray(ev.cargoLoadLines) ? ev.cargoLoadLines : []
    for (const l of loadLines) {
      const qty = Number(l?.qty) || 0
      const startedAt = l?.startedAt ?? null
      if (qty <= 0 || !startedAt) continue
      out.push({
        qty,
        startedAt: String(startedAt),
        endedAt: l?.endedAt != null ? String(l.endedAt) : null,
      })
    }
  }
  return out
}

/**
 * @param {Array<{ qty: number, startedAt: string, endedAt: string | null }>} lines
 * @returns {{ totalQty: number, firstLoggedAt: string | null, lastLoggedAt: string | null }}
 */
export function cargoWindowFromLoadLines(lines) {
  let totalQty = 0
  let firstLoggedAt = null
  let lastLoggedAt = null
  for (const l of lines || []) {
    totalQty += Number(l.qty) || 0
    if (l.startedAt && (!firstLoggedAt || l.startedAt < firstLoggedAt)) firstLoggedAt = l.startedAt
    const end = l.endedAt || l.startedAt
    if (end && (!lastLoggedAt || end > lastLoggedAt)) lastLoggedAt = end
  }
  return { totalQty, firstLoggedAt, lastLoggedAt }
}

/**
 * Cumulative discharge points at each load-line end (or start when no end).
 * @param {Array<{ qty: number, startedAt: string, endedAt: string | null }>} lines
 * @returns {Array<{ t: number, cumulativeQty: number, dateKey: string | null }>}
 */
export function buildCumulativeSeriesFromLoadLines(lines, timezone = DEFAULT_TIMEZONE) {
  if (!Array.isArray(lines) || lines.length === 0) return []
  const sorted = [...lines].sort((a, b) => {
    const ta = new Date(a.endedAt || a.startedAt).getTime()
    const tb = new Date(b.endedAt || b.startedAt).getTime()
    return ta - tb
  })
  let cumulative = 0
  const points = []
  for (const l of sorted) {
    cumulative += Number(l.qty) || 0
    const at = l.endedAt || l.startedAt
    const t = new Date(at).getTime()
    if (!Number.isFinite(t)) continue
    points.push({
      t,
      cumulativeQty: cumulative,
      dateKey: localDateKeyFromIso(at, timezone),
    })
  }
  return points
}

/**
 * Build rate summary for the operational progress section.
 * @param {object} opts
 * @returns {{ movedLine: string | null, balanceLine: string | null, hourlyLine: string | null, dailyLine: string | null, unit: string }}
 */
export function buildOperationalRateSummary({
  totalQtyDisplay,
  loadLines,
  dailyBars,
  nowMs,
  timezone,
}) {
  const parsed = parseQtyDisplay(totalQtyDisplay)
  if (!parsed) {
    return { movedLine: null, balanceLine: null, hourlyLine: null, dailyLine: null, unit: 'MT' }
  }
  const { totalQty, firstLoggedAt, lastLoggedAt } = cargoWindowFromLoadLines(loadLines)
  const done = Math.max(0, Math.min(parsed.total, totalQty))
  const ratePerHour = computeCargoRatePerHour(totalQty, firstLoggedAt, lastLoggedAt)
  const dailyPick = pickDisplayDailyRate(dailyBars, nowMs, timezone)

  return {
    unit: parsed.unit,
    movedLine: `${formatQtyNumber(done)} ${parsed.unit} / ${formatQtyNumber(parsed.total)} ${parsed.unit}`,
    balanceLine: `Balance ${formatQtyNumber(parsed.total - done)} ${parsed.unit}`,
    hourlyLine: `Rate ${formatRateNumber(ratePerHour)} ${parsed.unit} / Hour`,
    dailyLine: dailyPick ? formatDailyRateLine(dailyPick.qtyMoved, parsed.unit, dailyPick.date) : null,
  }
}
