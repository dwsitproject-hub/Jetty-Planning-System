/** Live Ops — "Arriving next …" window (ETA-first, optional period in days). */

export const ARRIVALS_WINDOW_OPTIONS = [3, 7, 14]
export const ARRIVALS_WINDOW_DEFAULT_DAYS = 3

const MS_PER_DAY = 24 * 3600000

/**
 * @param {3 | 7 | 14} windowDays
 * @param {(key: string, opts?: object) => string} t
 */
export function getArrivalsSectionTitle(windowDays, t) {
  if (windowDays === 7) return t('v2ArrivalsTitle7d')
  if (windowDays === 14) return t('v2ArrivalsTitle14d')
  return t('v2ArrivalsTitle72h')
}

/**
 * Arrived at port (TA) and not yet alongside (no TB / not sailed).
 * @param {object} plan
 * @param {(iso: string|null|undefined) => Date|null} parseIso
 */
export function isWaitingToBerth(plan, parseIso) {
  if (!parseIso(plan?.ta)) return false
  if (parseIso(plan?.tb) || parseIso(plan?.sailedAt)) return false
  return true
}

/**
 * Unique commodity short names from SI breakdown (falls back to full name).
 * @param {object} plan
 */
export function planCommodityShortLabels(plan) {
  const names = new Set()
  for (const si of plan?.shippingInstructions || []) {
    for (const line of si.breakdown || []) {
      const label = String(line?.commodityShortName || line?.commodityName || '').trim()
      if (label) names.add(label)
    }
  }
  return [...names].join(' · ') || '—'
}

/**
 * @param {object} plan
 * @param {number} nowMs
 * @param {3 | 7 | 14} windowDays
 * @param {(iso: string|null|undefined) => Date|null} parseIso
 * @returns {{ include: boolean, whenIso: string|null, whenKind: 'ETA'|'ETB', inHours: number, overdue: boolean }|null}
 */
export function evaluateArrivalPlan(plan, nowMs, windowDays, parseIso) {
  if (parseIso(plan?.ta)) return null
  const eta = parseIso(plan?.eta)
  const etb = parseIso(plan?.etb)
  const windowMs = windowDays * MS_PER_DAY

  if (eta) {
    const etaMs = eta.getTime()
    const include = etaMs < nowMs || etaMs <= nowMs + windowMs
    if (!include) return null
    return {
      include: true,
      whenIso: plan.eta,
      whenKind: 'ETA',
      inHours: (etaMs - nowMs) / 3600000,
      overdue: etaMs < nowMs,
    }
  }

  if (etb) {
    const etbMs = etb.getTime()
    if (etbMs >= nowMs && etbMs <= nowMs + windowMs) {
      return {
        include: true,
        whenIso: plan.etb,
        whenKind: 'ETB',
        inHours: (etbMs - nowMs) / 3600000,
        overdue: false,
      }
    }
  }

  return null
}
