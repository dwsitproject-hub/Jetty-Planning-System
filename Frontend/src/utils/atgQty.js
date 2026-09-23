/**
 * Read canonical ATG delta qty from API / poll ref (SI unit: MT or KL).
 * @param {{ sumAtgQty?: number|null, sumDeltaMass?: number|null }|null|undefined} atgRef
 * @returns {number|null}
 */
export function readAtgQtyFromRef(atgRef) {
  if (!atgRef) return null
  if (atgRef.sumAtgQty != null && Number.isFinite(Number(atgRef.sumAtgQty))) {
    return Number(atgRef.sumAtgQty)
  }
  if (atgRef.sumDeltaMass != null && Number.isFinite(Number(atgRef.sumDeltaMass))) {
    return Number(atgRef.sumDeltaMass)
  }
  return null
}

/** @param {{ sumAtgQty?: number|null, sumDeltaMass?: number|null, incomplete?: boolean, status?: string }|null|undefined} atgRef */
export function isAtgRefOk(atgRef) {
  if (!atgRef || atgRef.incomplete || atgRef.status === 'error') return false
  const qty = readAtgQtyFromRef(atgRef)
  return qty != null && qty > 0
}
