/** Display helpers for ATG cargo gaps on System Health. */

export function formatGapDuration(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0))
  const h = Math.floor(total / 60)
  const m = total % 60
  if (!h) return `${m} min`
  return m ? `${h} h ${m} min` : `${h} h`
}

/** @returns {'success'|'warning'|'error'|'neutral'} */
export function resyncOutcomeVariant(outcome) {
  switch (outcome) {
    case 'success':
      return 'success'
    case 'partial':
    case 'no_samples':
      return 'warning'
    case 'failed':
      return 'error'
    default:
      return 'neutral'
  }
}

/**
 * Roll the per-tank dry-run preview up to one row per gap.
 * @param {Array<{ gapKey: string, tankCode: string, archivePoints: number, newPoints: number, error: string|null }>} preview
 */
export function summarizePreviewByGap(preview) {
  const byGap = new Map()
  for (const p of preview ?? []) {
    let row = byGap.get(p.gapKey)
    if (!row) {
      row = { gapKey: p.gapKey, archivePoints: 0, newPoints: 0, tanks: [], errors: [] }
      byGap.set(p.gapKey, row)
    }
    row.archivePoints += Number(p.archivePoints) || 0
    row.newPoints += Number(p.newPoints) || 0
    row.tanks.push(p.tankCode)
    if (p.error) row.errors.push(`${p.tankCode}: ${p.error}`)
  }
  return byGap
}

/** Gap keys still present after a resync, among the ones that were targeted. */
export function remainingTargetGapKeys(result) {
  const after = new Set((result?.gapsAfter ?? []).map((g) => g.gapKey))
  return (result?.targetGapKeys ?? []).filter((k) => after.has(k))
}

export function isGapOpen(gap) {
  return !gap?.acknowledgement
}

/** Quantity with one decimal, e.g. 1,234.5 */
export function formatQty(value) {
  const n = Number(value) || 0
  return n.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

/** Signed quantity change, e.g. +157.5 / −12.0 / 0.0 */
export function formatQtyDelta(value) {
  const n = Number(value) || 0
  if (Math.abs(n) < 0.05) return formatQty(0)
  return `${n > 0 ? '+' : '−'}${formatQty(Math.abs(n))}`
}

/** "Nov 5, 03:00 – 04:00" in the viewer's local time. */
export function formatHourRange(startIso, endIso) {
  const day = { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
  const time = { hour: '2-digit', minute: '2-digit' }
  return `${new Date(startIso).toLocaleString([], day)} – ${new Date(endIso).toLocaleTimeString([], time)}`
}

/** Hours of a commodity, changed ones first; unchanged hours only when asked for. */
export function visibleHourlyRows(hourly, commodity, showUnchanged) {
  return (hourly ?? []).filter((h) => h.commodity === commodity && (showUnchanged || h.changed))
}

const SIMULATION_STALE_MS = 10 * 60 * 1000

export function simulationAgeMinutes(simulatedAt, nowMs = Date.now()) {
  const t = new Date(simulatedAt).getTime()
  return Number.isFinite(t) ? Math.max(0, Math.floor((nowMs - t) / 60000)) : 0
}

export function isSimulationStale(simulatedAt, nowMs = Date.now()) {
  const t = new Date(simulatedAt).getTime()
  return Number.isFinite(t) && nowMs - t > SIMULATION_STALE_MS
}
