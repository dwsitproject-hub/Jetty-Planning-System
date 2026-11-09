/** Helpers for the per-tank "Manual override" on the Tank Farm page. */

export const EXPIRY_PRESET_DAYS = [1, 3, 7, 14]
export const DEFAULT_EXPIRY_DAYS = 7
export const MIN_REASON_LENGTH = 5
const DAY_MS = 24 * 60 * 60 * 1000

/** @returns {'off'|'on'|'expired'} */
export function overrideState(tank) {
  return tank?.manualOverride?.state ?? 'off'
}

export function isOverrideOn(tank) {
  return overrideState(tank) === 'on'
}

/** Tanks currently in manual override, soonest auto-off first (no expiry last). */
export function activeOverrides(rows) {
  return (rows ?? [])
    .filter(isOverrideOn)
    .sort((a, b) => {
      const ea = a.manualOverride.expiresAt ? new Date(a.manualOverride.expiresAt).getTime() : Infinity
      const eb = b.manualOverride.expiresAt ? new Date(b.manualOverride.expiresAt).getTime() : Infinity
      return ea - eb
    })
}

/** Auto-off time for "N days from now". */
export function expiryFromDays(days, nowMs = Date.now()) {
  return new Date(nowMs + days * DAY_MS).toISOString()
}

/** End of the picked local day (YYYY-MM-DD) as an ISO time, or null when the date is invalid. */
export function expiryFromDate(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''))
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 0, 0)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/**
 * Validate the dialog before saving.
 * @param {{ enabled: boolean, reason: string, expiryChoice: 'none'|'days'|'date', days?: number, date?: string }} form
 * @returns {{ ok: true, body: { enabled: boolean, reason: string, expiresAt: string|null } } | { ok: false, error: 'reason'|'date' }}
 */
export function buildOverrideRequest(form, nowMs = Date.now()) {
  const reason = String(form.reason ?? '').trim()
  if (!form.enabled) return { ok: true, body: { enabled: false, reason, expiresAt: null } }
  if (reason.length < MIN_REASON_LENGTH) return { ok: false, error: 'reason' }

  let expiresAt = null
  if (form.expiryChoice === 'days') expiresAt = expiryFromDays(form.days ?? DEFAULT_EXPIRY_DAYS, nowMs)
  if (form.expiryChoice === 'date') {
    expiresAt = expiryFromDate(form.date)
    if (!expiresAt || new Date(expiresAt).getTime() <= nowMs) return { ok: false, error: 'date' }
  }
  return { ok: true, body: { enabled: true, reason, expiresAt } }
}
