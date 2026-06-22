/** @see Backend/src/lib/validate-cast-off.js */

export const CAST_OFF_FUTURE_TOLERANCE_MS = 15 * 60 * 1000

function parseMs(val) {
  if (val == null || val === '') return null
  const t = new Date(val).getTime()
  return Number.isNaN(t) ? null : t
}

/**
 * @param {Date | null} castOff
 * @param {{ tbAt?: string | Date | null, latestExecutionAt?: string | Date | null, nowMs?: number }} opts
 * @returns {string | null} Error message, or null if valid.
 */
export function validateCastOffDepart(castOff, opts = {}) {
  if (!castOff || Number.isNaN(castOff.getTime())) {
    return 'CAST Off time is required and must be valid.'
  }
  const nowMs = opts.nowMs ?? Date.now()
  if (castOff.getTime() > nowMs + CAST_OFF_FUTURE_TOLERANCE_MS) {
    return 'CAST Off cannot be in the future.'
  }
  const tbMs = parseMs(opts.tbAt)
  if (tbMs != null && castOff.getTime() < tbMs) {
    return 'CAST Off must be on or after actual time of berthing (TB).'
  }
  const latestMs = parseMs(opts.latestExecutionAt)
  if (latestMs != null && castOff.getTime() < latestMs) {
    return `CAST Off must be on or after the latest execution log time.`
  }
  return null
}
