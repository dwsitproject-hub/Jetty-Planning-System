/**
 * Waiting-to-berth duration (aligned with Live Ops dashboard rules).
 * @param {{ taMs?: number|null, tbMs?: number|null, etbMs?: number|null, nowMs?: number, mode?: 'berthed'|'waiting' }} params
 * @returns {number|null}
 */
export function computeWaitToBerthMs({ taMs, tbMs, etbMs, nowMs = Date.now(), mode = 'berthed' }) {
  const ta = Number(taMs)
  if (!Number.isFinite(ta)) return null

  if (mode === 'waiting') {
    const now = Number(nowMs)
    if (!Number.isFinite(now) || now < ta) return null
    return now - ta
  }

  const berthMs = tbMs != null && Number.isFinite(Number(tbMs)) ? Number(tbMs) : Number(etbMs)
  if (!Number.isFinite(berthMs)) return null
  if (berthMs < ta) return null
  return berthMs - ta
}

/**
 * @param {{ tbMs?: number|null, etbMs?: number|null, mode?: 'berthed'|'waiting' }} params
 * @returns {'waiting'|'berthed'|'berthedEtbFallback'|null}
 */
export function waitToBerthTooltipMode({ tbMs, etbMs, mode = 'berthed' }) {
  if (mode === 'waiting') return 'waiting'
  if (tbMs != null && Number.isFinite(Number(tbMs))) return 'berthed'
  if (etbMs != null && Number.isFinite(Number(etbMs))) return 'berthedEtbFallback'
  return null
}
