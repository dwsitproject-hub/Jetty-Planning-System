/**
 * Time-series buckets for By product modal charts (sailed off / sailedAt date).
 * Bucket membership selects voyages; each metric uses that voyage's full-call values.
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

/** Tooltip title: `DD/MMM/YYYY - DD/MMM/YYYY` (calendar bucket range). */
export function formatBucketTooltipTitle(bucket) {
  const start = formatDateDisplay(ymdFromLocalMs(bucket.startMs))
  const endMs = Math.max(bucket.startMs, bucket.endMs - MS_DAY)
  const end = formatDateDisplay(ymdFromLocalMs(endMs))
  return start === end ? start : `${start} - ${end}`
}

/** Clearance Sailed at on a normalized management-dashboard row. */
export function sailedOffMs(voyage) {
  if (!voyage?.sailedAt) return NaN
  const t = new Date(voyage.sailedAt).getTime()
  return Number.isFinite(t) ? t : NaN
}

/**
 * Calendar week/month bucket for an instant (used for sailed-off bucketing).
 * @returns {{ key: string, startMs: number, endMs: number, label: string, shortLabel: string }}
 */
export function bucketMetaForSailedOff(sailedOffMsValue, granularity) {
  if (granularity === 'week') {
    const startMs = startOfWeekMonday(sailedOffMsValue)
    const endMs = startMs + 7 * MS_DAY
    const d = new Date(startMs)
    const label = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const shortLabel = formatWeekBucketAxisLabel(startMs)
    return { key: `w:${label}`, startMs, endMs, label, shortLabel }
  }
  const startMs = startOfMonth(sailedOffMsValue)
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

/** @deprecated Use bucketMetaForSailedOff — buckets are sailed-off dated. */
export const bucketMetaForCastOff = bucketMetaForSailedOff

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
    const meta = bucketMetaForSailedOff(cursor, granularity)
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
  if (slice?.productRateMtH != null && Number.isFinite(slice.productRateMtH)) return slice.productRateMtH
  const fromApi = voyage.productRatesByKey?.[pk]?.rateMtH
  if (fromApi != null && Number.isFinite(fromApi)) return fromApi
  return null
}

function isLoggedMetric(x) {
  return x != null && Number.isFinite(x)
}

function meanPick(rows, pick) {
  const vals = rows.map(pick).filter(isLoggedMetric)
  return vals.length ? mean(vals) : null
}

function countPick(rows, pick) {
  return rows.filter((r) => isLoggedMetric(pick(r))).length
}

/** Chart metric key → per-voyage value (full call, not clipped to bucket dates). */
export const CHART_METRIC_VOYAGE_PICK = {
  avgWait: (r, _productKey) => r.wait,
  avgPre: (r, _productKey) => r.pre,
  avgRate: (r, productKey) => sliceRateForProduct(r, productKey),
  avgCargoDoneToSail: (r, _productKey) => r.cargoDoneToSailH,
}

export function voyageChartMetricValue(voyage, chartMetricKey, productKey) {
  const pick = CHART_METRIC_VOYAGE_PICK[chartMetricKey]
  return pick ? pick(voyage, productKey) : null
}

export function countVoyagesWithChartMetric(voyages, chartMetricKey, productKey) {
  const pick = CHART_METRIC_VOYAGE_PICK[chartMetricKey]
  if (!pick) return 0
  return countPick(voyages || [], (r) => pick(r, productKey))
}

/**
 * Voyages whose sailed off falls in the same bucket as chart aggregation.
 * @param {Array<object>} voyages
 * @param {{ key?: string }} bucket from buildProductTimeSeries / enumerateBuckets
 * @param {'week'|'month'} granularity
 */
export function voyagesInSailedOffBucket(voyages, bucket, granularity) {
  const bucketKey = bucket?.key
  if (!bucketKey) return []
  const g = granularity === 'week' ? 'week' : 'month'
  return (Array.isArray(voyages) ? voyages : []).filter((v) => {
    const so = sailedOffMs(v)
    if (!Number.isFinite(so)) return false
    return bucketMetaForSailedOff(so, g).key === bucketKey
  })
}

/** @deprecated Use voyagesInSailedOffBucket */
export const voyagesInCastOffBucket = voyagesInSailedOffBucket

export function buildProductTimeSeries(voyages, productKey, opts) {
  const start = opts.start
  const end = opts.end
  const granularity = opts.granularity ?? granularityForWindow(start, end)
  const buckets = enumerateBuckets(start, end, granularity)
  const byKey = new Map(buckets.map((b) => [b.key, { ...b, _voyages: [] }]))

  for (const v of voyages || []) {
    const so = sailedOffMs(v)
    if (!Number.isFinite(so) || so < start || so >= end) continue
    const meta = bucketMetaForSailedOff(so, granularity)
    const slot = byKey.get(meta.key)
    if (slot) slot._voyages.push(v)
  }

  return [...byKey.values()].map(({ _voyages, ...b }) => {
    const voyageCount = _voyages.length
    const pickWait = (r) => r.wait
    const pickPre = (r) => r.pre
    const pickRate = (r) => sliceRateForProduct(r, productKey)
    const pickCargo = (r) => r.cargoDoneToSailH
    return {
      ...b,
      voyageCount,
      avgWait: meanPick(_voyages, pickWait),
      avgPre: meanPick(_voyages, pickPre),
      avgRate: meanPick(_voyages, pickRate),
      avgCargoDoneToSail: meanPick(_voyages, pickCargo),
      waitLoggedCount: countPick(_voyages, pickWait),
      preLoggedCount: countPick(_voyages, pickPre),
      rateLoggedCount: countPick(_voyages, pickRate),
      cargoDoneLoggedCount: countPick(_voyages, pickCargo),
    }
  })
}

const LOGGED_COUNT_BY_METRIC = {
  avgWait: 'waitLoggedCount',
  avgPre: 'preLoggedCount',
  avgRate: 'rateLoggedCount',
  avgCargoDoneToSail: 'cargoDoneLoggedCount',
}

export function bucketMetricLoggedCount(bucket, chartMetricKey) {
  const field = LOGGED_COUNT_BY_METRIC[chartMetricKey]
  if (!field || !bucket) return 0
  return bucket[field] ?? 0
}

export function granularityLabel(granularity) {
  return granularity === 'week' ? 'By week · sailed off' : 'By month · sailed off'
}
