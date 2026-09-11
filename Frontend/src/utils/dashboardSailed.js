/** Live Ops — sailed-voyage lookback (cast-off clock). */

export const SAILED_LOOKBACK_HOURS = 72
export const SAILED_LOOKBACK_MS = SAILED_LOOKBACK_HOURS * 3600000

/**
 * @param {object} op
 * @param {(iso: string|null|undefined) => Date|null} parseIso
 */
export function sailedOffTime(op, parseIso) {
  return parseIso(op?.castOffAt) || parseIso(op?.actualCompletionTime) || parseIso(op?.sailedAt)
}

/**
 * Unique sailed voyages whose cast-off (or fallback) is at/after sinceMs.
 * Dedupes multi-SI ops by shipmentPlanId.
 *
 * @param {object[]} ops
 * @param {number} sinceMs
 * @param {(iso: string|null|undefined) => Date|null} parseIso
 * @param {Set<number>} [rejectedPlanIds]
 * @returns {{ count: number, vessels: Array<{ id: number, operationCode: string|null, vesselName: string, jettyName: string, offMs: number }> }}
 */
export function summarizeSailedSince(ops, sinceMs, parseIso, rejectedPlanIds = new Set()) {
  const seen = new Set()
  const vessels = []
  for (const o of ops || []) {
    if (o.status !== 'SAILED') continue
    if (o.shipmentPlanId != null && rejectedPlanIds.has(o.shipmentPlanId)) continue
    const off = sailedOffTime(o, parseIso)
    if (!off) continue
    const tMs = off.getTime()
    if (tMs < sinceMs) continue
    const key = o.shipmentPlanId != null ? `p${o.shipmentPlanId}` : `o${o.id}`
    if (seen.has(key)) continue
    seen.add(key)
    const operationCode = String(o.jettyOperationCode || o.referenceNumber || '').trim() || null
    vessels.push({
      id: o.id,
      operationCode,
      vesselName: o.vesselName || `Op #${o.id}`,
      jettyName: o.jettyName || '—',
      offMs: tMs,
    })
  }
  vessels.sort((a, b) => b.offMs - a.offMs)
  return { count: vessels.length, vessels }
}
