/**
 * Time-series buckets for By product modal charts (cast-off date).
 */
import { mean } from './managementDashboardFlow.js'
import { expandVoyageToProductSlices, productKeyFromCommodity } from './managementDashboardProduct.js'
import { formatDateDisplay } from './formatDateTimeDisplay.js'

const MS_DAY = 86400000
const NINETY_DAYS_MS = 90 * MS_DAY

export function granularityForWindow(startMs, endMs) {
  if (startMs == null || endMs == null || !Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return 'month'
  }
  const span = Math.max(endMs - startMs, 0)
  return span <= NINETY_DAYS_MS ? 'week' : 'month'
}

function startOfWeekMonday(ms) {
  const d = new Date(ms)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function startOfMonth(ms) {
  const d = new Date(ms)
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Week of calendar month (1–5): days 1–7 → W1, 8–14 → W2, … (Monday week start label uses that Monday’s date). */
export function weekOfMonthLocal(weekStartMs) {
  const day = new Date(weekStartMs).getDate()
  return Math.ceil(day / 7)
}

/** Chart X-axis: `W2 Jul 26` (week of month + month + 2-digit year). */
export function formatWeekBucketAxisLabel(weekStartMs) {
  const d = new Date(weekStartMs)
  const week = weekOfMonthLocal(weekStartMs)
  const yy = String(d.getFullYear()).slice(-2)
  return `W${week} ${MONTH_SHORT[d.getMonth()]} ${yy}`
}

/** Chart X-axis for monthly buckets: `Jul 26`. */
export function formatMonthBucketAxisLabel(monthStartMs) {
  const d = new Date(monthStartMs)
  return `${MONTH_SHORT[d.getMonth()]} ${String(d.getFullYear()).slice(-2)}`
}

function ymdFromLocalMs(ms) {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Tooltip title: `DD/MMM/YYYY - DD/MMM/YYYY` (cast-off bucket range). */
export function formatBucketTooltipTitle(bucket) {
  const start = formatDateDisplay(ymdFromLocalMs(bucket.startMs))
  const endMs = Math.max(bucket.startMs, bucket.endMs - MS_DAY)
  const end = formatDateDisplay(ymdFromLocalMs(endMs))
  return start === end ? start : `${start} - ${end}`
}

/**
 * @returns {{ key: string, startMs: number, endMs: number, label: string, shortLabel: string }}
 */
export function bucketMetaForCastOff(castOffMs, granularity) {
  if (granularity === 'week') {
    const startMs = startOfWeekMonday(castOffMs)
    const endMs = startMs + 7 * MS_DAY
    const d = new Date(startMs)
    const label = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const shortLabel = formatWeekBucketAxisLabel(startMs)
    return { key: `w:${label}`, startMs, endMs, label, shortLabel }
  }
  const startMs = startOfMonth(castOffMs)
  const d = new Date(startMs)
  const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  return {
    key: `m:${ym}`,
    startMs,
    endMs: startOfMonth(startMs + 32 * MS_DAY),
    label: ym,
    shortLabel: formatMonthBucketAxisLabel(startMs),
  }
}

/**
 * Ordered empty buckets covering [start, end).
 * @param {number} startMs
 * @param {number} endMs
 * @param {'week'|'month'} granularity
 */
export function enumerateBuckets(startMs, endMs, granularity) {
  if (startMs == null || endMs == null || endMs <= startMs) return []
  const out = []
  const seen = new Set()
  let cursor =
    granularity === 'week' ? startOfWeekMonday(startMs) : startOfMonth(startMs)
  while (cursor < endMs) {
    const meta = bucketMetaForCastOff(cursor, granularity)
    if (!seen.has(meta.key)) {
      seen.add(meta.key)
      out.push({
        key: meta.key,
        label: meta.label,
        shortLabel: meta.shortLabel,
        startMs: meta.startMs,
        endMs: meta.endMs,
        voyageCount: 0,
        avgWait: null,
        avgPre: null,
        avgRate: null,
        avgCargoDoneToSail: null,
      })
    }
    cursor = granularity === 'week' ? cursor + 7 * MS_DAY : startOfMonth(startMsOfNextMonth(cursor))
  }
  return out
}

function startMsOfNextMonth(ms) {
  const d = new Date(ms)
  d.setMonth(d.getMonth() + 1)
  d.setDate(1)
  return d.getTime()
}

function sliceRateForProduct(voyage, productKey) {
  const pk = productKeyFromCommodity(productKey)
  const slice = expandVoyageToProductSlices(voyage).find((s) => s.productKey === pk)
  if (!slice?.opsH || !(Number(slice.opsH) > 0)) return null
  const qty = Number(slice.qty) || 0
  return qty > 0 ? qty / slice.opsH : null
}

function meanPick(rows, pick) {
  const vals = rows.map(pick).filter((x) => x != null && Number.isFinite(x))
  return vals.length ? mean(vals) : null
}

/**
 * @param {Array<object>} voyages normalized rows (already product-filtered)
 * @param {string} productKey
 * @param {{ start: number, end: number, granularity?: 'week'|'month' }} opts
 */
/**
 * Voyages whose cast-off falls in the same bucket as chart aggregation.
 * @param {Array<object>} voyages
 * @param {{ key?: string }} bucket from buildProductTimeSeries / enumerateBuckets
 * @param {'week'|'month'} granularity
 */
export function voyagesInCastOffBucket(voyages, bucket, granularity) {
  const bucketKey = bucket?.key
  if (!bucketKey) return []
  const g = granularity === 'week' ? 'week' : 'month'
  return (Array.isArray(voyages) ? voyages : []).filter((v) => {
    const co = v.castOff ? new Date(v.castOff).getTime() : NaN
    if (!Number.isFinite(co)) return false
    return bucketMetaForCastOff(co, g).key === bucketKey
  })
}

export function buildProductTimeSeries(voyages, productKey, opts) {
  const start = opts.start
  const end = opts.end
  const granularity = opts.granularity ?? granularityForWindow(start, end)
  const buckets = enumerateBuckets(start, end, granularity)
  const byKey = new Map(buckets.map((b) => [b.key, { ...b, _voyages: [] }]))

  for (const v of voyages || []) {
    const co = v.castOff ? new Date(v.castOff).getTime() : NaN
    if (!Number.isFinite(co) || co < start || co >= end) continue
    const meta = bucketMetaForCastOff(co, granularity)
    const slot = byKey.get(meta.key)
    if (slot) slot._voyages.push(v)
  }

  return [...byKey.values()].map(({ _voyages, ...b }) => {
    const voyageCount = _voyages.length
    return {
      ...b,
      voyageCount,
      avgWait: meanPick(_voyages, (r) => r.wait),
      avgPre: meanPick(_voyages, (r) => r.pre),
      avgRate: meanPick(_voyages, (r) => sliceRateForProduct(r, productKey)),
      avgCargoDoneToSail: meanPick(_voyages, (r) => r.cargoDoneToSailH),
    }
  })
}

export function granularityLabel(granularity) {
  return granularity === 'week' ? 'By week · cast-off' : 'By month · cast-off'
}
