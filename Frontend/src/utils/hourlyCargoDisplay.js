/**
 * Hourly cargo table display helpers: per-tank row expansion and signed moved qty.
 */

import { DateTime } from 'luxon'
import { getAppLocaleTag } from './formatDateTimeDisplay.js'
import { getClientIanaTimeZone } from './scheduleDateTime.js'

/**
 * Format an hourly bucket time range in browser/user timezone: `dd MMM HH:mm - HH:mm`.
 * @param {unknown} hourStart UTC ISO instant
 * @param {unknown} hourEnd UTC ISO instant
 * @param {{ timeZone?: string, locale?: string }} [opts]
 * @returns {string}
 */
export function formatHourlyRangeDisplay(hourStart, hourEnd, opts = {}) {
  if (hourStart == null || hourEnd == null) return '—'

  const timeZone = opts.timeZone || getClientIanaTimeZone()
  const locale = opts.locale || getAppLocaleTag()

  const start = DateTime.fromISO(String(hourStart), { zone: 'utc' }).setZone(timeZone).setLocale(locale)
  const end = DateTime.fromISO(String(hourEnd), { zone: 'utc' }).setZone(timeZone).setLocale(locale)

  if (!start.isValid || !end.isValid) return '—'

  return `${start.toFormat('dd MMM HH:mm')} - ${end.toFormat('HH:mm')}`
}

/**
 * Build current/last-active summary lines from hourly buckets (browser timezone).
 * @param {Array<object>} hourlyBuckets
 * @param {string} [unit]
 * @param {{ timeZone?: string, locale?: string }} [opts]
 * @returns {{ currentHourLine: string|null, lastActiveHourLine: string|null }}
 */
export function buildClientHourlyRateSummary(hourlyBuckets, unit = 'MT', opts = {}) {
  if (!Array.isArray(hourlyBuckets) || hourlyBuckets.length === 0) {
    return { currentHourLine: null, lastActiveHourLine: null }
  }

  const rangeOpts =
    opts.timeZone || opts.locale ? { timeZone: opts.timeZone, locale: opts.locale } : undefined

  const current = hourlyBuckets[hourlyBuckets.length - 1]
  const currentRange = formatHourlyRangeDisplay(current.hourStart, current.hourEnd, rangeOpts)
  const currentRate = Number(current.rateTph) || 0
  const currentHourLine =
    currentRange !== '—'
      ? `Current hour (${currentRange}): ${currentRate.toLocaleString('en-US', { maximumFractionDigits: 1 })} ${unit}/h`
      : null

  let lastActive = null
  for (let i = hourlyBuckets.length - 1; i >= 0; i -= 1) {
    if (hourlyBuckets[i].movementStatus === 'active') {
      lastActive = hourlyBuckets[i]
      break
    }
  }

  const lastActiveRange = lastActive
    ? formatHourlyRangeDisplay(lastActive.hourStart, lastActive.hourEnd, rangeOpts)
    : '—'
  const lastActiveLine =
    lastActive && lastActiveRange !== '—'
      ? `Last active: ${lastActiveRange} · ${(Number(lastActive.rateTph) || 0).toLocaleString('en-US', { maximumFractionDigits: 1 })} ${unit}/h`
      : null

  return { currentHourLine, lastActiveHourLine: lastActiveLine }
}

/** @param {unknown} tankDetail */
export function normalizeTankDetail(tankDetail) {
  if (Array.isArray(tankDetail)) return tankDetail
  if (tankDetail && typeof tankDetail === 'object' && Array.isArray(tankDetail.tanks)) {
    return tankDetail.tanks
  }
  return []
}

/**
 * Apply display sign for progress magnitude: Unloading +, Loading −.
 * @param {number|null|undefined} qty unsigned progress magnitude
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
 * Format a signed display delta (ATG raw delta or already-signed qty).
 * @param {number|null|undefined} signedQty
 * @param {string} [unit]
 */
export function formatDisplayCargoQty(signedQty, unit = 'MT') {
  const n = Number(signedQty)
  if (!Number.isFinite(n)) return '—'
  const prefix = n >= 0 ? '+' : ''
  return `${prefix}${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${unit}`
}

/**
 * Format unsigned progress magnitude with purpose sign (manual checkpoints).
 * @param {number|null|undefined} qty
 * @param {'Loading'|'Unloading'|string|null|undefined} purpose
 * @param {string} [unit]
 */
export function formatSignedCargoQty(qty, purpose, unit = 'MT') {
  return formatDisplayCargoQty(applyCargoMovementSign(qty, purpose), unit)
}

/**
 * Signed display qty for a tank row (prefers ATG raw delta over progress qtyMoved).
 * @param {object|null|undefined} tank
 * @param {'Loading'|'Unloading'|string|null|undefined} purpose
 * @returns {number|null}
 */
export function tankDisplayQty(tank, purpose) {
  if (tank?.displayQtyMoved != null && Number.isFinite(Number(tank.displayQtyMoved))) {
    return Number(tank.displayQtyMoved)
  }
  if (tank?.rawDeltaLiters != null && Number.isFinite(Number(tank.rawDeltaLiters))) {
    return Number(tank.rawDeltaLiters)
  }
  if (tank?.rawDeltaKl != null && Number.isFinite(Number(tank.rawDeltaKl))) {
    return Number(tank.rawDeltaKl) * 1000
  }
  if (tank?.rawDeltaMass != null && Number.isFinite(Number(tank.rawDeltaMass))) {
    return Number(tank.rawDeltaMass)
  }
  if (tank?.volumeStartKl != null && tank?.volumeEndKl != null) {
    const start = Number(tank.volumeStartKl)
    const end = Number(tank.volumeEndKl)
    if (Number.isFinite(start) && Number.isFinite(end)) return (end - start) * 1000
  }
  if (tank?.massStart != null && tank?.massEnd != null) {
    const start = Number(tank.massStart)
    const end = Number(tank.massEnd)
    if (Number.isFinite(start) && Number.isFinite(end)) return end - start
  }
  if (tank?.qtyMoved != null && Number.isFinite(Number(tank.qtyMoved))) {
    return applyCargoMovementSign(Number(tank.qtyMoved), purpose)
  }
  if (tank?.deltaMass != null && Number.isFinite(Number(tank.deltaMass))) {
    return Number(tank.deltaMass)
  }
  if (tank?.deltaKl != null && Number.isFinite(Number(tank.deltaKl))) {
    return Number(tank.deltaKl) * 1000
  }
  return null
}

/**
 * Signed display qty for a bucket without per-tank split.
 * @param {object} bucket
 * @param {'Loading'|'Unloading'|string|null|undefined} purpose
 * @returns {number|null}
 */
export function bucketDisplayQty(bucket, purpose) {
  if (bucket?.displayQtyMoved != null && Number.isFinite(Number(bucket.displayQtyMoved))) {
    return Number(bucket.displayQtyMoved)
  }
  if (bucket?.qtyMoved != null && Number.isFinite(Number(bucket.qtyMoved))) {
    return applyCargoMovementSign(Number(bucket.qtyMoved), purpose)
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

function tankHasDisplayData(tank, purpose) {
  if (tank?.massStart != null && tank?.massEnd != null) return true
  if (tank?.volumeStartKl != null && tank?.volumeEndKl != null) return true
  return tankDisplayQty(tank, purpose) != null
}

function displayRateForQty(qty, bucket, bucketRate) {
  if (bucketRate != null && Number.isFinite(Number(bucketRate))) {
    return Number(bucketRate)
  }
  const effectiveHours = effectiveHoursForBucket(bucket)
  const absQty = Math.abs(Number(qty) || 0)
  if (effectiveHours > 0) return absQty / effectiveHours
  return absQty > 0 ? absQty : 0
}

/**
 * Expand hourly buckets into table rows (one row per tank when tankDetail present).
 * @param {Array<object>} hourlyBuckets
 * @param {'Loading'|'Unloading'|string|null|undefined} [purpose]
 * @returns {Array<object>}
 */
export function expandHourlyBucketsForDisplay(hourlyBuckets, purpose = null) {
  const rows = []
  for (const bucket of hourlyBuckets || []) {
    const tanks = normalizeTankDetail(bucket.tankDetail).filter((t) =>
      tankHasDisplayData(t, purpose)
    )
    const effectiveHours = effectiveHoursForBucket(bucket)

    if (tanks.length > 0) {
      for (const tk of tanks) {
        const tankDisplayQtyMoved = tankDisplayQty(tk, purpose)
        const tankCode = tk.code || tk.tankId || '—'
        const rateTph =
          tk.displayRateTph != null && Number.isFinite(Number(tk.displayRateTph))
            ? Number(tk.displayRateTph)
            : displayRateForQty(tankDisplayQtyMoved, bucket, bucket.displayRateTph)
        rows.push({
          ...bucket,
          rowKey: `${bucket.hourStart}-${tankCode}`,
          tankCode,
          tankDisplayQtyMoved,
          rateTph,
        })
      }
      continue
    }

    const tankDisplayQtyMoved = bucketDisplayQty(bucket, purpose)
    rows.push({
      ...bucket,
      rowKey: String(bucket.hourStart),
      tankCode: '—',
      tankDisplayQtyMoved,
      rateTph: displayRateForQty(tankDisplayQtyMoved, bucket, bucket.displayRateTph ?? bucket.rateTph),
    })
  }
  return rows
}
