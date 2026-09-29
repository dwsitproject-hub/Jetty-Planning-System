/** Default +3 calendar days when ETC missing (display / conservative overlap probe). */
export const DEFAULT_BERTH_TAIL_MS = 3 * 24 * 60 * 60 * 1000

function parseTs(value) {
  if (value == null || value === '') return null
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) ? ms : null
}

/**
 * Berthing-plan occupancy start: TB → ETB (never ETA/TA).
 * @param {object | null | undefined} row
 * @returns {number | null}
 */
export function getBerthPlanStartMs(row) {
  return (
    parseTs(row?.tbDateTime) ??
    parseTs(row?.tbAt) ??
    parseTs(row?.dockingStartTime) ??
    parseTs(row?.tb) ??
    parseTs(row?.etbDateTime) ??
    parseTs(row?.etb) ??
    parseTs(row?.plannedEtbDateTime) ??
    null
  )
}

/**
 * Real completion end (no display fallback).
 * @param {object | null | undefined} row
 * @returns {number | null}
 */
export function getBerthPlanRealEndMs(row) {
  return (
    parseTs(row?.actualCompletionDateTime) ??
    parseTs(row?.actualCompletionTime) ??
    parseTs(row?.castOffDateTime) ??
    parseTs(row?.castOffAt) ??
    parseTs(row?.estimatedCompletionDateTime) ??
    parseTs(row?.estimatedCompletionTime) ??
    parseTs(row?.estimationOfCompletion) ??
    null
  )
}

/**
 * @param {object | null | undefined} row
 * @returns {boolean}
 */
export function isBerthPlanSailed(row) {
  const st = String(row?.status || '').trim().toUpperCase()
  if (st === 'SAILED') return true
  return parseTs(row?.sailedAt) != null
}

/**
 * Vessel is on the berthing plan (ETB/TB set) but has no ETC/TC/completion yet.
 * @param {object | null | undefined} row
 * @returns {boolean}
 */
export function isBerthPlanMissingEtc(row) {
  if (isBerthPlanSailed(row)) return false
  if (getBerthPlanStartMs(row) == null) return false
  return getBerthPlanRealEndMs(row) == null
}

/**
 * @param {object | null | undefined} row
 * @param {{ mode?: 'real' | 'display' }} [opts]
 * @returns {number | null}
 */
export function getBerthPlanEndMs(row, { mode = 'real' } = {}) {
  const real = getBerthPlanRealEndMs(row)
  if (real != null) return real
  if (mode !== 'display') return null
  const start = getBerthPlanStartMs(row)
  return start != null ? start + DEFAULT_BERTH_TAIL_MS : null
}

/**
 * Conflict validation end — null when incumbent has berth start but no completion.
 * @param {object | null | undefined} row
 * @returns {number | null}
 */
export function getBerthPlanConflictEndMs(row) {
  if (getBerthPlanStartMs(row) == null) return null
  return getBerthPlanRealEndMs(row)
}

/**
 * Overlap probe end: real ETC/TC or ETB/TB + 3 days when completion is missing.
 * @param {object | null | undefined} row
 * @returns {number | null}
 */
export function getBerthPlanProbeEndMs(row) {
  const real = getBerthPlanRealEndMs(row)
  if (real != null) return real
  const start = getBerthPlanStartMs(row)
  return start != null ? start + DEFAULT_BERTH_TAIL_MS : null
}

/**
 * @param {number} a0
 * @param {number} a1
 * @param {number} b0
 * @param {number} b1
 * @returns {boolean}
 */
export function intervalsOverlap(a0, a1, b0, b1) {
  return a0 < b1 && b0 < a1
}

/**
 * @param {object | null | undefined} row
 * @returns {string | null}
 */
export function getTargetJettyShortIdFromRow(row) {
  const raw = String(row?.jetty || row?.jettyName || '').trim()
  if (!raw) return null
  const short = raw.replace(/^Jetty\s+/i, '').trim()
  return short.split('/')[0].trim() || null
}

function isSamePlanRow(candidate, other) {
  if (
    candidate?.vesselId != null &&
    other?.vesselId != null &&
    String(candidate.vesselId) === String(other.vesselId)
  ) {
    return true
  }
  if (
    candidate?.shipmentPlanId != null &&
    other?.shipmentPlanId != null &&
    Number(candidate.shipmentPlanId) === Number(other.shipmentPlanId)
  ) {
    const cOp = candidate?.operationId ?? candidate?.id
    const oOp = other?.operationId ?? other?.id
    if (cOp != null && oOp != null && String(cOp) === String(oOp)) return true
    if (cOp == null && oOp == null) return true
  }
  return false
}

function shouldSkipOther(candidate, other, { excludeVesselId, excludeShipmentPlanId }) {
  if (isSamePlanRow(candidate, other)) return true
  if (excludeVesselId != null && other?.vesselId != null && String(other.vesselId) === String(excludeVesselId)) {
    return true
  }
  if (
    excludeShipmentPlanId != null &&
    other?.shipmentPlanId != null &&
    Number(other.shipmentPlanId) === Number(excludeShipmentPlanId)
  ) {
    return true
  }
  return false
}

/**
 * @param {object} params
 * @param {object} params.candidate
 * @param {object[]} [params.scheduleRows]
 * @param {string | null | undefined} params.jettyShortId
 * @param {number} [params.jettyCapacity]
 * @param {string | null} [params.excludeVesselId]
 * @param {number | string | null} [params.excludeShipmentPlanId]
 * @param {object} [params.messages]
 * @returns {{ ok: true } | { ok: false, reason: string, message: string, blockingVessel?: string }}
 */
export function validateBerthPlanJettyAssignment({
  candidate,
  scheduleRows = [],
  jettyShortId,
  jettyCapacity = 1,
  excludeVesselId = null,
  excludeShipmentPlanId = null,
  messages = {},
}) {
  const jetty = (jettyShortId || getTargetJettyShortIdFromRow(candidate) || '').trim()
  if (!jetty) return { ok: true }

  const cap = Math.max(1, Number(jettyCapacity) || 1)
  const candidateStart = getBerthPlanStartMs(candidate)
  const candidateEnd = getBerthPlanProbeEndMs(candidate)

  const blockMissingEtc =
    messages.blockMissingEtc ??
    'Enter estimated completion (ETC) for {{vessel}} on {{jetty}} before allocating another vessel here.'
  const blockOverlap =
    messages.blockOverlap ??
    '{{jetty}} is occupied by {{vessel}} until {{end}}. Choose a later ETB or another jetty.'

  const othersOnJetty = scheduleRows.filter((other) => {
    if (shouldSkipOther(candidate, other, { excludeVesselId, excludeShipmentPlanId })) return false
    return getTargetJettyShortIdFromRow(other) === jetty
  })

  if (candidateStart == null || candidateEnd == null) return { ok: true }

  /** @type {{ other: object, otherEnd: number }[]} */
  const overlappingOthers = []

  for (const other of othersOnJetty) {
    const otherStart = getBerthPlanStartMs(other)
    const otherEnd = getBerthPlanProbeEndMs(other)
    if (otherStart == null || otherEnd == null) continue
    if (!intervalsOverlap(candidateStart, candidateEnd, otherStart, otherEnd)) continue
    overlappingOthers.push({ other, otherEnd })
  }

  if (overlappingOthers.length >= cap) {
    const missingEtcOverlap = overlappingOthers.find(({ other }) => isBerthPlanMissingEtc(other))
    if (missingEtcOverlap) {
      const { other } = missingEtcOverlap
      const vesselName = other.vesselName || `Plan #${other.shipmentPlanId ?? other.id ?? '?'}`
      return {
        ok: false,
        reason: 'missing_etc',
        message: blockMissingEtc.replace('{{vessel}}', vesselName).replace('{{jetty}}', jetty),
        blockingVessel: vesselName,
      }
    }

    const { other, otherEnd } = overlappingOthers[0]
    const vesselName = other.vesselName || `Plan #${other.shipmentPlanId ?? other.id ?? '?'}`
    const endLabel =
      messages.formatEnd?.(otherEnd) ??
      new Date(otherEnd).toLocaleString('en-GB', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    return {
      ok: false,
      reason: 'overlap',
      message: blockOverlap
        .replace('{{jetty}}', jetty)
        .replace('{{vessel}}', vesselName)
        .replace('{{end}}', endLabel),
      blockingVessel: vesselName,
    }
  }

  return { ok: true }
}

/**
 * ETB/TB reference for berthing validation (no ETA/TA fallback).
 * @param {object | null | undefined} row
 * @returns {number | null}
 */
export function getBerthPlanCandidateStartMs(row) {
  return getBerthPlanStartMs(row)
}
