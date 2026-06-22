/** @see Frontend/src/pages/Allocation.jsx UNIFIED_PHASES */

function parseMs(val) {
  if (val == null || val === '') return null
  const t = new Date(val).getTime()
  return Number.isNaN(t) ? null : t
}

export function isVesselSailed(vessel) {
  return String(vessel?.status || '').toUpperCase() === 'SAILED'
}

export function isVesselReadyToSail(vessel) {
  const opStatus = String(vessel?.status || '').toUpperCase()
  return ['SIGNOFF_REQUESTED', 'SIGNOFF_APPROVED'].includes(opStatus)
}

/**
 * Phase index for UNIFIED_PHASES (length 4). Index 4 = all steps complete (SAILED).
 */
export function deriveCurrentPhaseIndex(vessel) {
  if (isVesselSailed(vessel)) return 4

  const siDone = Boolean(vessel?.shippingInstructionId)
  const plannedBerthingDone = Boolean((vessel?.jetty || '').trim())
  const atBerthDone = Boolean(vessel?.tbDateTime)
  const readyToSail = isVesselReadyToSail(vessel)

  if (!siDone) return 0
  if (!plannedBerthingDone) return 1
  if (!atBerthDone) return 2
  if (!readyToSail) return 2
  return 3
}

export function currentPhaseLabelForVessel(vessel, phases) {
  if (isVesselSailed(vessel)) return 'Sailed'
  const list = Array.isArray(phases) ? phases : []
  const idx = deriveCurrentPhaseIndex(vessel)
  return list[Math.min(Math.max(idx, 0), Math.max(0, list.length - 1))] || '—'
}

/** End of alongside interval for duration / remaining labels. */
export function getVesselAlongsideEndMs(vessel, nowMs = Date.now()) {
  const castOff = parseMs(vessel?.castOffDateTime)
  const actComp = parseMs(vessel?.actualCompletionDateTime)
  const opsComp = parseMs(vessel?.operationsCompletedDateTime)
  if (isVesselSailed(vessel)) {
    return castOff ?? actComp ?? nowMs
  }
  return actComp ?? opsComp ?? nowMs
}

export function getPlanAlongsideEndMs(planDetail, vessel, nowMs = Date.now()) {
  const sailed = isVesselSailed(vessel) || Boolean(planDetail?.sailedAt)
  const castOff = parseMs(planDetail?.castOffAt) ?? parseMs(vessel?.castOffDateTime)
  const actComp = parseMs(planDetail?.actualCompletionTime) ?? parseMs(vessel?.actualCompletionDateTime)
  const opsComp = parseMs(planDetail?.operationsCompletedAt) ?? parseMs(vessel?.operationsCompletedDateTime)
  if (sailed) {
    return castOff ?? actComp ?? nowMs
  }
  return actComp ?? opsComp ?? nowMs
}

export function isPlanOrVesselSailed(planDetail, vessel) {
  return isVesselSailed(vessel) || Boolean(planDetail?.sailedAt)
}
