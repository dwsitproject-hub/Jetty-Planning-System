import { resolvePurposeLabel } from './resolvePurposeLabel.js'
import { materialDisplayFromRow } from './ganttBarDisplay.js'
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
  // jetty+bankLaneKey groups that have any actual milestone (TA or TB): these render
  // only their actual bar — the estimate (planned) bar is suppressed for them.
  const hasActualByKey = new Set()
  for (const r of sorted) {
    const jettyId = jettyIdFromScheduleRow(r)
    if (!jettyId) continue
    if (parseMs(r.taDateTime) != null || parseMs(r.tbDateTime) != null) {
      hasActualByKey.add(`${jettyId}\0${bankLaneKeyFromRow(r)}`)
    }
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
    const materialDisplay = materialDisplayFromRow(r)
    const rowMeta = { purposeLabel, loadDischarge, cargoDisplay, materialDisplay }
    const additionalJetties = Array.isArray(r.additionalJetties)
      ? r.additionalJetties.filter(Boolean)
      : []
    const plannedEtb = parseMs(r.plannedEtbDateTime) ?? parseMs(r.etbDateTime)
    const eta = parseMs(r.etaDateTime)
    const ta = parseMs(r.taDateTime)
    const tb = parseMs(r.tbDateTime)
    const estComp = parseMs(r.estimatedCompletionDateTime)
    const actComp = parseMs(r.actualCompletionDateTime)
    const castOff = parseMs(r.castOffDateTime)
    const actualCompMs = actComp ?? castOff ?? null
    const sourceStatus = String(r.status || '').trim().toUpperCase()
    const isSailed = sourceStatus === 'SAILED'
    const status = isSailed ? 'Sailed off' : tb != null ? 'Berthing' : 'Arriving'

    // Estimate bar: only for vessels with no actual milestones yet. Once TA/TB is
    // recorded the single actual bar (which also shows ETA/ETB) represents the vessel.
    const plannedStart = plannedEtb ?? eta
    const plannedDedupKey = `${jettyId}\0${bankLaneKey}`
    if (
      plannedStart != null &&
      !plannedEmitted.has(plannedDedupKey) &&
      !hasActualByKey.has(plannedDedupKey)
    ) {
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
          estimateOnly: true,
          jettyId,
          bankLaneKey,
          vesselId,
          vesselName,
          additionalJetties,
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
          estCompMs: estComp,
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
          additionalJetties,
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
          actualCompMs,
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
          additionalJetties,
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
          actualCompMs,
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
 * Active alongside vessels use schematic lane order. Everything else is packed by
 * TIME: a vessel goes to a lane whose bars don't overlap it, preferring the lane
 * whose previous bar ends closest before it starts — so a vessel scheduled after
 * another renders on the same lane row, right behind it. Sailed/historical bars
 * break ties toward the high lanes so they avoid the active 01 row.
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

  // One lane per jetty+bankLaneKey; aggregate each key's full [start, end] window.
  const keyInfo = new Map()
  for (const s of baseSegments) {
    const bk = s.bankLaneKey ?? s.vesselId
    const key = `${s.jettyId}\0${bk}`
    const info =
      keyInfo.get(key) ||
      { key, jettyId: s.jettyId, startMs: s.startMs, endMs: s.endMs, isSailed: false }
    info.startMs = Math.min(info.startMs, s.startMs)
    info.endMs = Math.max(info.endMs, s.endMs)
    info.isSailed = info.isSailed || s.status === 'Sailed off'
    keyInfo.set(key, info)
  }

  const lanesByJetty = new Map() // jettyId -> per-lane occupied intervals
  const lanesOf = (jettyId) => {
    let lanes = lanesByJetty.get(jettyId)
    if (!lanes) {
      const cap = Math.max(1, Number(caps.get(jettyId)) || 1)
      lanes = Array.from({ length: cap }, () => [])
      lanesByJetty.set(jettyId, lanes)
    }
    return lanes
  }

  const laneForKey = new Map()
  const claimLane = (info, lane) => {
    const lanes = lanesOf(info.jettyId)
    const li = Math.max(0, Math.min(lane, lanes.length - 1))
    laneForKey.set(info.key, li)
    lanes[li].push({ startMs: info.startMs, endMs: info.endMs })
  }

  // Currently alongside vessels keep their schematic lanes.
  for (const info of keyInfo.values()) {
    if (activeLaneMap.has(info.key)) claimLane(info, activeLaneMap.get(info.key))
  }

  // Pack the rest in start order.
  const pending = [...keyInfo.values()]
    .filter((info) => !activeLaneMap.has(info.key))
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)
  for (const info of pending) {
    const lanes = lanesOf(info.jettyId)
    let best = -1
    let bestPrevEnd = null
    for (let li = 0; li < lanes.length; li += 1) {
      const intervals = lanes[li]
      const overlaps = intervals.some(
        (iv) => iv.startMs < info.endMs && info.startMs < iv.endMs
      )
      if (overlaps) continue
      let prevEnd = -Infinity
      for (const iv of intervals) {
        if (iv.endMs <= info.startMs && iv.endMs > prevEnd) prevEnd = iv.endMs
      }
      const better =
        best === -1 || prevEnd > bestPrevEnd || (prevEnd === bestPrevEnd && info.isSailed)
      if (better) {
        best = li
        bestPrevEnd = prevEnd
      }
    }
    claimLane(
      info,
      best !== -1 ? best : pickInactiveLane(info.jettyId, caps, activeLanesByJetty, info.isSailed)
    )
  }

  return baseSegments.map((s) => {
    const bk = s.bankLaneKey ?? s.vesselId
    const lane = laneForKey.get(`${s.jettyId}\0${bk}`) ?? 0
    return { ...s, laneIndex: lane, rowKey: `${s.jettyId}__${lane}` }
  })
}

export { jettyIdFromScheduleRow as jettyIdFromListRow }
