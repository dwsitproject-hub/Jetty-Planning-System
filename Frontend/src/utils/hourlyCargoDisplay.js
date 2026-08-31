/**
 * Hourly cargo table display helpers: per-tank row expansion and signed moved qty.
 */

/** @param {unknown} tankDetail */
export function normalizeTankDetail(tankDetail) {
  if (Array.isArray(tankDetail)) return tankDetail
  if (tankDetail && typeof tankDetail === 'object' && Array.isArray(tankDetail.tanks)) {
    return tankDetail.tanks
  }
  return []
}

function tankQtyFromDetail(tank) {
  if (tank?.qtyMoved != null && Number.isFinite(Number(tank.qtyMoved))) {
    return Number(tank.qtyMoved)
  }
  if (tank?.deltaMass != null && Number.isFinite(Number(tank.deltaMass))) {
    return Math.abs(Number(tank.deltaMass))
  }
  return null
}

function effectiveHoursForBucket(bucket) {
  if (bucket?.effectiveHours != null && Number.isFinite(Number(bucket.effectiveHours))) {
    return Number(bucket.effectiveHours)
  }
  const startMs = bucket?.hourStart ? new Date(bucket.hourStart).getTime() : NaN
  const endMs = bucket?.hourEnd ? new Date(bucket.hourEnd).getTime() : NaN
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return 0
  return (endMs - startMs) / 3600000
}

/**
 * Apply display sign: Unloading +, Loading − (magnitude always positive input).
 * @param {number|null|undefined} qty
 * @param {'Loading'|'Unloading'|string|null|undefined} purpose
 * @returns {number|null}
 */
export function applyCargoMovementSign(qty, purpose) {
  const n = Number(qty)
  if (!Number.isFinite(n)) return null
  const magnitude = Math.abs(n)
  if (String(purpose) === 'Unloading') return magnitude
  return -magnitude
}

/**
 * @param {number|null|undefined} qty unsigned magnitude
 * @param {'Loading'|'Unloading'|string|null|undefined} purpose
 * @param {string} [unit]
 */
export function formatSignedCargoQty(qty, purpose, unit = 'MT') {
  const signed = applyCargoMovementSign(qty, purpose)
  if (signed == null) return '—'
  const prefix = signed >= 0 ? '+' : ''
  return `${prefix}${signed.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${unit}`
}

/**
 * Expand hourly buckets into table rows (one row per tank when tankDetail present).
 * @param {Array<object>} hourlyBuckets
 * @returns {Array<object>}
 */
export function expandHourlyBucketsForDisplay(hourlyBuckets) {
  const rows = []
  for (const bucket of hourlyBuckets || []) {
    const tanks = normalizeTankDetail(bucket.tankDetail).filter(
      (t) => tankQtyFromDetail(t) != null && tankQtyFromDetail(t) > 0
    )
    const effectiveHours = effectiveHoursForBucket(bucket)

    if (tanks.length > 0) {
      for (const tk of tanks) {
        const tankQtyMoved = tankQtyFromDetail(tk)
        const tankCode = tk.code || tk.tankId || '—'
        const rateTph =
          effectiveHours > 0 ? tankQtyMoved / effectiveHours : tankQtyMoved > 0 ? tankQtyMoved : 0
        rows.push({
          ...bucket,
          rowKey: `${bucket.hourStart}-${tankCode}`,
          tankCode,
          tankQtyMoved,
          rateTph,
        })
      }
      continue
    }

    rows.push({
      ...bucket,
      rowKey: String(bucket.hourStart),
      tankCode: '—',
      tankQtyMoved: Number(bucket.qtyMoved) || 0,
      rateTph: Number(bucket.rateTph) || 0,
    })
  }
  return rows
}
