/**
 * Pure logic for Jetty Schedule Gantt drag/resize edits.
 *
 * A gesture on a bar produces a "proposal" describing which schedule fields would
 * change. Date gestures are ambiguous by design: the user must choose whether the
 * shift applies to the Estimation milestones (ETA/ETB) or the Actual milestones
 * (TA/TB). Jetty (row) changes are unambiguous.
 */

/** Drag deltas snap to 30 minutes so drops land on clean times. */
export const GANTT_DRAG_SNAP_MS = 30 * 60 * 1000

/** Minimum pointer travel (px) before a press becomes a drag instead of a click. */
export const GANTT_DRAG_THRESHOLD_PX = 5

/** @param {number} deltaMs @param {number} snapMs */
export function snapDeltaMs(deltaMs, snapMs = GANTT_DRAG_SNAP_MS) {
  if (!Number.isFinite(deltaMs)) return 0
  return Math.round(deltaMs / snapMs) * snapMs
}

/** rowKey format is `${jettyId}__${laneIndex}` (see JettyScheduleGantt rowDefs). */
export function jettyIdFromRowKey(rowKey) {
  const s = String(rowKey ?? '')
  const i = s.lastIndexOf('__')
  return i > 0 ? s.slice(0, i) : null
}

/** Row can carry Actual milestones only when an operation/SI exists (not plan-only). */
export function rowSupportsActualDates(row) {
  if (!row) return false
  const hasOp = row.operationId != null && row.operationId !== ''
  const hasSi = row.shippingInstructionId != null && row.shippingInstructionId !== ''
  return hasOp || hasSi
}

function pushShift(list, field, label, fromMs, deltaMs) {
  if (fromMs == null) return
  list.push({ field, label, fromMs, toMs: fromMs + deltaMs })
}

/**
 * Build the change proposal for a finished drag gesture.
 *
 * @param {object} args
 * @param {'move' | 'resize-start' | 'resize-end'} args.kind
 * @param {number} args.deltaMs snapped time delta (0 = no date change)
 * @param {object} args.seg gantt segment (etaMs, plannedEtbMs, taMs, tbMs, estCompMs, endMs, phase, layer, jettyId)
 * @param {object | null} args.row source schedule row (operationId, shippingInstructionId, shipmentPlanId)
 * @param {string | null} args.targetJettyId jetty id of the drop row (move only)
 * @returns {object | null} proposal, or null when the gesture changes nothing
 */
export function buildGanttDragProposal({ kind, deltaMs, seg, row, targetJettyId }) {
  const delta = Number.isFinite(deltaMs) ? deltaMs : 0
  const jettyChange =
    kind === 'move' && targetJettyId && targetJettyId !== seg.jettyId
      ? { from: seg.jettyId, to: targetJettyId }
      : null

  /** @type {Array<{field: string, label: string, fromMs: number, toMs: number}>} */
  const estimation = []
  /** @type {Array<{field: string, label: string, fromMs: number, toMs: number}>} */
  const actual = []
  /** @type {Array<{field: string, label: string, fromMs: number, toMs: number}>} */
  const always = []

  if (delta !== 0) {
    if (kind === 'move') {
      pushShift(estimation, 'etaDateTime', 'ETA', seg.etaMs, delta)
      pushShift(estimation, 'etbDateTime', 'ETB', seg.plannedEtbMs, delta)
      pushShift(actual, 'taDateTime', 'TA', seg.taMs, delta)
      pushShift(actual, 'tbDateTime', 'TB', seg.tbMs, delta)
    } else if (kind === 'resize-start') {
      // The left edge is the bar's start milestone: TB (alongside) or TA (transit)
      // on the actual side, ETB (fallback ETA) on the estimation side.
      if (seg.phase === 'transit') {
        pushShift(estimation, 'etaDateTime', 'ETA', seg.etaMs, delta)
        pushShift(actual, 'taDateTime', 'TA', seg.taMs, delta)
      } else {
        if (seg.plannedEtbMs != null) {
          pushShift(estimation, 'etbDateTime', 'ETB', seg.plannedEtbMs, delta)
        } else {
          pushShift(estimation, 'etaDateTime', 'ETA', seg.etaMs, delta)
        }
        if (seg.tbMs != null) {
          pushShift(actual, 'tbDateTime', 'TB', seg.tbMs, delta)
        } else {
          pushShift(actual, 'taDateTime', 'TA', seg.taMs, delta)
        }
      }
    } else if (kind === 'resize-end') {
      // The right edge is completion. The bar may end on a display-only tail
      // (+3 days) when no ETC is set; the new ETC becomes the dropped edge.
      const endMs = seg.endMs != null ? seg.endMs : seg.estCompMs
      if (endMs != null) {
        always.push({
          field: 'estimatedCompletionDateTime',
          label: 'ETC',
          fromMs: seg.estCompMs ?? null,
          toMs: endMs + delta,
        })
      }
    }
  }

  if (!jettyChange && estimation.length === 0 && actual.length === 0 && always.length === 0) {
    return null
  }

  const canActual = actual.length > 0 && rowSupportsActualDates(row)
  const needsChoice = estimation.length > 0 && canActual

  return {
    kind,
    deltaMs: delta,
    jettyChange,
    estimation,
    actual,
    always,
    canActual,
    canEstimation: estimation.length > 0,
    needsChoice,
  }
}

/**
 * Build the PUT /allocation/arrival payload for a confirmed proposal.
 * Omitted date keys keep their DB values (the endpoint merges partial updates).
 *
 * @param {object} proposal from buildGanttDragProposal
 * @param {'estimation' | 'actual'} choice which milestone family receives the date shift
 * @param {object} row source schedule row
 * @param {string} activityLogPage
 * @returns {object} payload for saveArrivalUpdate
 */
export function buildArrivalPayloadFromProposal(proposal, choice, row, activityLogPage) {
  const hasOp = row?.operationId != null && row.operationId !== ''
  const hasSi = row?.shippingInstructionId != null && row.shippingInstructionId !== ''
  const planOnly = !hasOp && !hasSi

  const payload = { activityLogPage }
  if (hasOp) payload.operationId = row.operationId
  if (hasSi) payload.shippingInstructionId = row.shippingInstructionId
  if (planOnly) payload.shipmentPlanId = row.shipmentPlanId

  if (proposal.jettyChange) payload.jetty = proposal.jettyChange.to

  const chosen =
    choice === 'actual' ? proposal.actual : choice === 'estimation' ? proposal.estimation : []
  for (const c of [...chosen, ...proposal.always]) {
    payload[c.field] = new Date(c.toMs).toISOString()
  }
  return payload
}
