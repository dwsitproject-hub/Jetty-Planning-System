/** Pure cargo progress qty helpers (no API imports — safe for node:test). */

import { readAtgQtyFromRef } from './atgQty.js'

function parsePositiveQtyValue(s) {
  if (s == null || String(s).trim() === '') return NaN
  const n = Number(String(s).trim().replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? n : NaN
}

/** Partition selected tanks using master-tank hasAtg flags. */
export function partitionDraftTanks(tankIds, tankMetaById) {
  const atgTankIds = []
  const manualTankIds = []
  for (const id of tankIds || []) {
    const meta = tankMetaById?.get(String(id))
    if (meta?.hasAtg) atgTankIds.push(String(id))
    else manualTankIds.push(String(id))
  }
  return { atgTankIds, manualTankIds }
}

/** Sum positive qty on all draft load lines. */
export function sumDraftLineQty(lines) {
  return (lines || []).reduce((acc, d) => {
    const q = parsePositiveQtyValue(d.qty)
    return acc + (Number.isFinite(q) ? q : 0)
  }, 0)
}

/** Sum positive qty on closed draft load lines only. */
export function sumClosedDraftLineQty(lines) {
  return (lines || [])
    .filter((l) => l.start && l.end)
    .reduce((acc, d) => {
      const q = parsePositiveQtyValue(d.qty)
      return acc + (Number.isFinite(q) ? q : 0)
    }, 0)
}

function lineStartAt(line) {
  return line?.startAt ?? line?.startedAt ?? line?.start_at ?? null
}

function lineEndAt(line) {
  return line?.endAt ?? line?.endedAt ?? line?.end_at ?? null
}

/** First open cargo load line (supports activity-timeline and operational-activities shapes). */
export function findOpenCargoLoadLine(lines) {
  if (!Array.isArray(lines)) return null
  return (
    lines.find((l) => lineStartAt(l) && !lineEndAt(l) && l.id != null) ??
    lines.find((l) => lineStartAt(l) && !lineEndAt(l)) ??
    null
  )
}

/** Sum saved qty on all closed cargo load lines from activity rows. */
export function sumClosedPersistedLineQty(activityRows) {
  let total = 0
  for (const act of activityRows || []) {
    for (const line of act.cargoLoadLines || []) {
      if (!lineEndAt(line)) continue
      const q = Number(line.qty)
      if (Number.isFinite(q) && q > 0) total += q
    }
  }
  return total
}

/**
 * Default operation window for first Cargo Operations entry: TB → prior milestone starts → now.
 */
export function resolveDefaultCargoOperationWindowStart({
  tbIso,
  priorMilestoneStarts,
  getNowLocal,
  toLocal,
}) {
  if (tbIso && toLocal) {
    const local = toLocal(tbIso)
    if (local) return local
  }
  const starts = (priorMilestoneStarts || []).filter(Boolean)
  if (starts.length) {
    let earliest = starts[0]
    let earliestMs = new Date(earliest).getTime()
    for (const s of starts.slice(1)) {
      const ms = new Date(s).getTime()
      if (Number.isFinite(ms) && (!Number.isFinite(earliestMs) || ms < earliestMs)) {
        earliest = s
        earliestMs = ms
      }
    }
    if (Number.isFinite(earliestMs)) return earliest
  }
  return getNowLocal()
}

/** Live moved qty on the open segment from ATG ref, API, or manual draft fields. */
export function resolveOpenLineLiveQty({
  openLineDraft,
  atgRef,
  sessionOperationalProgress,
  tankMetaById,
  closedPersistedSum,
}) {
  const closedSum =
    closedPersistedSum != null && Number.isFinite(Number(closedPersistedSum))
      ? Number(closedPersistedSum)
      : 0

  const apiMoved = sessionOperationalProgress?.movedQty
  if (apiMoved != null && Number.isFinite(Number(apiMoved))) {
    const openFromApi = Math.max(0, Number(apiMoved) - closedSum)
    if (openFromApi > 0) return openFromApi
  }

  if (!openLineDraft) return null

  const { atgTankIds, manualTankIds } = partitionDraftTanks(openLineDraft.tankIds, tankMetaById)
  const atgQtyMode = openLineDraft.atgQtyMode === 'manual' ? 'manual' : 'auto'

  const atgQty = readAtgQtyFromRef(atgRef)
  const atgOk =
    atgRef?.status === 'ok' && !atgRef.incomplete && atgQty != null && atgQty > 0

  let openPart = 0
  if (atgTankIds.length > 0 && atgQtyMode === 'auto' && atgOk) {
    openPart += atgQty
  }

  const manualMq = parsePositiveQtyValue(openLineDraft.manualQty)
  if (Number.isFinite(manualMq)) {
    openPart += manualMq
  } else if (manualTankIds.length > 0 && atgTankIds.length === 0) {
    const draftQty = parsePositiveQtyValue(openLineDraft.qty)
    if (Number.isFinite(draftQty)) openPart += draftQty
  }

  return openPart > 0 ? openPart : null
}

/**
 * Total cargo moved for progress bar (operation-wide when API live, else draft sums).
 */
export function resolveCargoProgressTotalLoaded({
  loadedOther,
  cargoLoadLinesDraft,
  sessionOperationalProgress,
  openLineDraft,
  atgRef,
  tankMetaById,
  useCargoSessionMode,
  commodityType,
  closedPersistedSum,
}) {
  const other = Number.isFinite(Number(loadedOther)) ? Number(loadedOther) : 0
  const draftSum = sumDraftLineQty(cargoLoadLinesDraft)

  if (commodityType === 'Solid' || !useCargoSessionMode) {
    return other + draftSum
  }

  if (openLineDraft) {
    const apiMoved = sessionOperationalProgress?.movedQty
    if (apiMoved != null && Number.isFinite(Number(apiMoved))) {
      return Number(apiMoved)
    }
    const closedSum = sumClosedDraftLineQty(cargoLoadLinesDraft)
    const openLive =
      resolveOpenLineLiveQty({
        openLineDraft,
        atgRef,
        sessionOperationalProgress,
        tankMetaById,
        closedPersistedSum,
      }) ?? 0
    return other + closedSum + openLive
  }

  return other + draftSum
}

/** Snapshot for timeline open-row live qty display. */
export function buildLiveCargoProgressSnapshot({
  openLoadLineId,
  openLineDraft,
  atgRef,
  sessionOperationalProgress,
  tankMetaById,
  activityRows,
}) {
  if (!openLoadLineId) return null
  const closedPersistedSum = sumClosedPersistedLineQty(activityRows)
  const movedQty = resolveOpenLineLiveQty({
    openLineDraft,
    atgRef,
    sessionOperationalProgress,
    tankMetaById,
    closedPersistedSum,
  })
  if (movedQty == null || !Number.isFinite(movedQty) || movedQty <= 0) return null
  return {
    openLoadLineId: String(openLoadLineId),
    movedQty,
    manualQty: openLineDraft?.manualQty ?? null,
  }
}
