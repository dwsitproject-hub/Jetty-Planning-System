import { parseMs, resolveActualAlongsideEnd } from './jettyScheduleOccupancy.js'

const MIN_PHASE_PX = 4

function after(prev, next) {
  if (next == null) return null
  if (prev == null) return next
  return next > prev ? next : prev + 60_000
}

/** @param {number} ms */
export function formatPhaseDuration(ms) {
  if (ms == null || ms <= 0) return '0m'
  const totalMin = Math.round(ms / 60_000)
  if (totalMin < 60) return `${totalMin}m`
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h < 48) return m > 0 ? `${h}h ${m}m` : `${h}h`
  const d = Math.floor(h / 24)
  const rh = h % 24
  if (rh === 0) return `${d}d`
  return `${d}d ${rh}h`
}

function fmtShort(ms) {
  if (ms == null) return '—'
  const d = new Date(ms)
  const day = d.getDate()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${day} ${hh}:${mm}`
}

/**
 * Build tri-color actual bar phases from schedule row milestones.
 * Returns null when TB or operational start is missing (single-bar fallback).
 *
 * @param {object} row
 * @param {number} [nowMs]
 */
export function buildActualPhases(row, nowMs = Date.now()) {
  const tb = parseMs(row?.tbDateTime)
  const opsStart = parseMs(row?.operationalStartDateTime)
  if (tb == null || opsStart == null || opsStart <= tb) return null

  const opsEnd = parseMs(row?.operationsCompletedDateTime)
  const castOff = parseMs(row?.castOffDateTime)
  const actComp = parseMs(row?.actualCompletionDateTime)
  const estComp = parseMs(row?.estimatedCompletionDateTime)
  const clearance = castOff ?? actComp ?? null

  const sourceStatus = String(row?.status || '').trim().toUpperCase()
  const isSailed = sourceStatus === 'SAILED'

  const { endMs: barEnd, gradient: openEnd } = resolveActualAlongsideEnd({
    tb,
    estComp,
    isSailed,
    actComp,
    castOff,
    nowMs,
  })

  const m1 = tb
  const m2 = opsStart
  const m3 = opsEnd != null && opsEnd > m2 ? opsEnd : null
  const m4 =
    clearance != null && clearance > (m3 ?? m2)
      ? clearance
      : Math.max(barEnd, m3 ?? m2, m1)

  if (m4 <= m1) return null

  const phases = []
  phases.push({
    key: 'berthing',
    kind: 'berthing',
    label: 'Berthing',
    startMs: m1,
    endMs: m2,
    openEnd: false,
  })

  const opsPhaseEnd = m3 ?? m4
  phases.push({
    key: 'atBerthOps',
    kind: 'atBerthOps',
    label: 'At Berth Ops',
    startMs: m2,
    endMs: opsPhaseEnd,
    openEnd: m3 == null && openEnd,
  })

  if (m3 != null && m4 > m3) {
    phases.push({
      key: 'clearance',
      kind: 'clearance',
      label: 'Clearance',
      startMs: m3,
      endMs: m4,
      openEnd: clearance == null && openEnd,
    })
  }

  const milestones = {
    tb: m1,
    startLoad: m2,
    opsEnd: m3,
    clearance: clearance != null && clearance > (m3 ?? m2) ? clearance : m4,
  }

  const markers = [m1, m2]
  if (m3 != null) markers.push(m3)
  if (m4 > (m3 ?? m2)) markers.push(m4)

  const isBreached = !isSailed && estComp != null && nowMs > estComp
  let etcOverduePhase = null
  if (isBreached) {
    if (m3 == null || estComp <= m3) etcOverduePhase = 'atBerthOps'
    else etcOverduePhase = 'clearance'
  }

  return {
    barStartMs: m1,
    barEndMs: m4,
    openEnd,
    isSailed,
    milestones,
    phases,
    markers,
    estCompMs: estComp,
    etcOverdue: isBreached,
    etcOverduePhase,
    overMs: isBreached ? nowMs - estComp : null,
    tooltipPhases: phases.map((p) => ({
      kind: p.kind,
      label: p.label,
      fromLabel:
        p.kind === 'berthing'
          ? 'TB'
          : p.kind === 'atBerthOps'
            ? 'Start Load'
            : 'Ops End',
      toLabel:
        p.kind === 'berthing'
          ? 'Start Load'
          : p.kind === 'atBerthOps'
            ? m3 != null
              ? 'Ops End'
              : 'Clearance'
            : 'Clearance',
      fromMs: p.startMs,
      toMs: p.endMs,
      duration: formatPhaseDuration(p.endMs - p.startMs),
      fromShort: fmtShort(p.startMs),
      toShort: fmtShort(p.endMs),
    })),
  }
}

/**
 * @param {Array<{ startMs: number, endMs: number }>} phases
 * @param {number} barStartMs
 * @param {number} barEndMs
 * @param {number} [minPx]
 */
export function phaseLayout(phases, barStartMs, barEndMs, minPx = MIN_PHASE_PX) {
  const total = barEndMs - barStartMs
  if (total <= 0) return []
  const out = []
  for (const p of phases) {
    const startMs = Math.max(p.startMs, barStartMs)
    const endMs = Math.min(p.endMs, barEndMs)
    if (endMs <= startMs) continue
    const pct = ((endMs - startMs) / total) * 100
    out.push({
      ...p,
      leftPct: ((startMs - barStartMs) / total) * 100,
      widthPct: Math.max(pct, 0),
      minWidthPx: minPx,
    })
  }
  return out
}

/** Returns phase model + layout when tri-color segmented bar can render; else null. */
export function canRenderSegmentedActualBar(row, nowMs = Date.now()) {
  const phaseModel = buildActualPhases(row, nowMs)
  if (!phaseModel) return null
  const layout = phaseLayout(phaseModel.phases, phaseModel.barStartMs, phaseModel.barEndMs)
  if (!layout.length) return null
  return { phaseModel, layout }
}
