import { resolvePurposeLabel } from './resolvePurposeLabel.js'
import {
  parseMs,
  resolveActualAlongsideEnd,
  buildActiveLaneMap,
  bankLaneKeyFromRow,
  jettyIdFromScheduleRow,
} from './jettyScheduleOccupancy.js'

/** Default +3 calendar days from planned/actual start when completions unknown (display only) */
export const DEFAULT_TAIL_MS = 3 * 24 * 60 * 60 * 1000

function clipToWindow(startMs, endMs, wStart, wEnd) {
  if (endMs <= wStart || startMs >= wEnd) return null
  return {
    startMs: Math.max(startMs, wStart),
    endMs: Math.min(endMs, wEnd),
  }
}

function pushSegment(out, base, wStart, wEnd) {
  const c = clipToWindow(base.startMs, base.endMs, wStart, wEnd)
  if (!c || c.endMs <= c.startMs) return
  out.push({ ...base, startMs: c.startMs, endMs: c.endMs })
}

export function buildScheduleSegments(plan, windowStartMs, windowEndMs, nowMs) {
  const sorted = [...plan].sort((a, b) => {
    const seqA = a.sequence ?? 99
    const seqB = b.sequence ?? 99
    if (seqA !== seqB) return seqA - seqB
    const startA =
      parseMs(a.plannedEtbDateTime) ?? parseMs(a.etbDateTime) ?? parseMs(a.etaDateTime) ?? Infinity
    const startB =
      parseMs(b.plannedEtbDateTime) ?? parseMs(b.etbDateTime) ?? parseMs(b.etaDateTime) ?? Infinity
    return startA - startB
  })
  const out = []
  const plannedEmitted = new Set()

  // Pre-compute the best actual-ops row per jettyId+bankLaneKey.
  // "Best" = non-sailed over sailed; among same sailed status, latest TB wins.
  // This prevents old/SAILED docking rows from overwriting the current berth bar.
  const bestActualOpsRow = new Map()
  for (const r of sorted) {
    const jettyId = jettyIdFromScheduleRow(r)
    if (!jettyId) continue
    const tbMs = parseMs(r.tbDateTime)
    if (tbMs == null) continue
    const bk = bankLaneKeyFromRow(r)
    const fullKey = `${jettyId}\0${bk}`
    const cur = bestActualOpsRow.get(fullKey)
    const rSailed = String(r.status || '').trim().toUpperCase() === 'SAILED'
    if (!cur) {
      bestActualOpsRow.set(fullKey, r)
      continue
    }
    const curSailed = String(cur.status || '').trim().toUpperCase() === 'SAILED'
    // Non-sailed always beats sailed
    if (curSailed && !rSailed) { bestActualOpsRow.set(fullKey, r); continue }
    if (!curSailed && rSailed) continue
    // Same sailed status — keep latest TB
    if (tbMs > parseMs(cur.tbDateTime)) bestActualOpsRow.set(fullKey, r)
  }

  sorted.forEach((r) => {
    const jettyId = jettyIdFromScheduleRow(r)
    if (!jettyId) return

    const vesselId = r.vesselId
    const bankLaneKey = bankLaneKeyFromRow(r)
    const vesselName = r.vesselName || r.vesselId || '—'
    const purposeLabel = resolvePurposeLabel(r.planPurposeLabel || r.purpose, r.loadDischarge)
    const loadDischarge = r.loadDischarge ?? null
    const cargoDisplay = r.totalQtyDisplay || null
    const rowMeta = { purposeLabel, loadDischarge, cargoDisplay }
    const plannedEtb = parseMs(r.plannedEtbDateTime) ?? parseMs(r.etbDateTime)
    const eta = parseMs(r.etaDateTime)
    const ta = parseMs(r.taDateTime)
    const tb = parseMs(r.tbDateTime)
    const estComp = parseMs(r.estimatedCompletionDateTime)
    const actComp = parseMs(r.actualCompletionDateTime)
    const castOff = parseMs(r.castOffDateTime)
    const sourceStatus = String(r.status || '').trim().toUpperCase()
    const isSailed = sourceStatus === 'SAILED'
    const status = isSailed ? 'Sailed off' : tb != null ? 'Berthing' : 'Arriving'

    const plannedStart = plannedEtb ?? eta
    const plannedDedupKey = `${jettyId}\0${bankLaneKey}`
    if (plannedStart != null && !plannedEmitted.has(plannedDedupKey)) {
      plannedEmitted.add(plannedDedupKey)
      let opsEnd
      let gradient
      let label
      if (estComp != null && estComp > plannedStart) {
        opsEnd = estComp
        gradient = false
        label = 'Planned · alongside → est. completion'
      } else {
        opsEnd = plannedStart + DEFAULT_TAIL_MS
        gradient = true
        label =
          estComp == null
            ? 'Planned · alongside (+3 days — est. completion not set)'
            : 'Planned · alongside (+3 days — est. completion not after start)'
      }
      pushSegment(
        out,
        {
          layer: 'planned',
          phase: 'ops',
          jettyId,
          bankLaneKey,
          vesselId,
          vesselName,
          ...rowMeta,
          gradient,
          status,
          label,
          startMs: plannedStart,
          endMs: opsEnd,
          plannedEtbMs: plannedEtb,
          etaMs: eta,
          tbMs: tb,
          taMs: ta,
          startSource: plannedEtb != null ? 'ETB' : 'ETA',
        },
        windowStartMs,
        windowEndMs
      )
    }

    if (ta != null && tb == null) {
      let transitEnd
      let transitGradient = true
      let transitLabel
      const hasEst = estComp != null
      const hasAct = actComp != null

      if (hasEst && hasAct) {
        if (actComp > ta) {
          transitEnd = actComp
          transitGradient = false
          transitLabel = 'Actual · TA → actual completion (berth time TBD)'
        } else {
          transitEnd = ta + DEFAULT_TAIL_MS
          transitLabel = 'Actual · TA recorded (berth time TBD — tail is indicative)'
        }
      } else if (hasEst && !hasAct) {
        if (estComp > ta) {
          transitEnd = estComp
          transitGradient = true
          transitLabel =
            'Actual · TA → est. completion (berth TBD — open end; actual completion not recorded)'
        } else {
          transitEnd = ta + DEFAULT_TAIL_MS
          transitLabel = 'Actual · TA recorded (berth time TBD — tail is indicative)'
        }
      } else if (!hasEst && hasAct) {
        if (actComp > ta) {
          transitEnd = actComp
          transitGradient = false
          transitLabel = 'Actual · TA → actual completion (berth time TBD)'
        } else {
          transitEnd = ta + DEFAULT_TAIL_MS
          transitLabel = 'Actual · TA recorded (berth time TBD — tail is indicative)'
        }
      } else {
        transitEnd = ta + DEFAULT_TAIL_MS
        transitLabel = 'Actual · TA recorded (berth time TBD — tail is indicative)'
      }

      pushSegment(
        out,
        {
          layer: 'actual',
          phase: 'transit',
          jettyId,
          bankLaneKey,
          vesselId,
          vesselName,
          ...rowMeta,
          gradient: transitGradient,
          status,
          label: transitLabel,
          startMs: ta,
          endMs: transitEnd,
          plannedEtbMs: plannedEtb,
          etaMs: eta,
          tbMs: tb,
          taMs: ta,
          startSource: 'TA',
        },
        windowStartMs,
        windowEndMs
      )
    }

    if (tb != null) {
      // Only emit the "best" actual ops segment per jetty+bankLaneKey (dedup)
      const actualDedupKey = `${jettyId}\0${bankLaneKey}`
      if (bestActualOpsRow.get(actualDedupKey) !== r) return

      const { endMs: opsEnd, gradient, label } = resolveActualAlongsideEnd({
        tb,
        estComp,
        isSailed,
        actComp,
        castOff,
        nowMs,
      })

      const isBreached = !isSailed && estComp != null && nowMs > estComp
      const spanMs = opsEnd - tb
      const etcOverduePct =
        isBreached && spanMs > 0 ? Math.min(100, Math.max(0, ((estComp - tb) / spanMs) * 100)) : null

      pushSegment(
        out,
        {
          layer: 'actual',
          phase: 'ops',
          jettyId,
          bankLaneKey,
          vesselId,
          vesselName,
          ...rowMeta,
          gradient,
          status,
          label: isBreached ? 'Actual · alongside (past est. completion)' : label,
          startMs: tb,
          endMs: opsEnd,
          plannedEtbMs: plannedEtb,
          etaMs: eta,
          tbMs: tb,
          taMs: ta,
          estCompMs: estComp,
          etcOverdue: isBreached,
          etcOverduePct,
          overMs: isBreached ? nowMs - estComp : null,
          startSource: 'TB',
        },
        windowStartMs,
        windowEndMs
      )
    }
  })

  return out
}

const INACTIVE_LANE_FALLBACK = 0

/** Prefer high-index free lanes so sailed/historical bars avoid the active 01 row when possible. */
function pickInactiveLane(jettyId, caps, activeLanesByJetty, isSailed) {
  const cap = Math.max(1, Number(caps.get(jettyId)) || 1)
  const usedByActive = activeLanesByJetty.get(jettyId) || new Set()
  if (isSailed) {
    for (let i = cap - 1; i >= 0; i -= 1) {
      if (!usedByActive.has(i)) return i
    }
    return cap - 1
  }
  for (let i = 0; i < cap; i += 1) {
    if (!usedByActive.has(i)) return i
  }
  return INACTIVE_LANE_FALLBACK
}

/**
 * Bank lanes (01, 02, …) per vessel on a jetty.
 * Active alongside vessels use schematic lane order; sailed/historical use free lanes (prefer 02+).
 */
export function assignBankLanesByVessel(baseSegments, rowDefs, listRows, nowMs) {
  const caps = new Map()
  for (const r of rowDefs) caps.set(r.jettyId, r.capacity)

  const activeLaneMap = buildActiveLaneMap({
    scheduleRows: listRows,
    berthCapacities: caps,
    asOfMs: nowMs,
  })

  const activeLanesByJetty = new Map()
  for (const [key, lane] of activeLaneMap) {
    const jettyId = key.split('\0')[0]
    const set = activeLanesByJetty.get(jettyId) || new Set()
    set.add(lane)
    activeLanesByJetty.set(jettyId, set)
  }

  const out = []
  for (const s of baseSegments) {
    const bk = s.bankLaneKey ?? s.vesselId
    const mapKey = `${s.jettyId}\0${bk}`
    let lane
    if (activeLaneMap.has(mapKey)) {
      lane = activeLaneMap.get(mapKey)
    } else {
      const isSailed = s.status === 'Sailed off'
      lane = pickInactiveLane(s.jettyId, caps, activeLanesByJetty, isSailed)
    }
    out.push({ ...s, laneIndex: lane, rowKey: `${s.jettyId}__${lane}` })
  }
  return out
}

export { jettyIdFromScheduleRow as jettyIdFromListRow }
