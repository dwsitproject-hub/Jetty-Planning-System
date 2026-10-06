/**
 * Per-voyage metric evidence for Management Dashboard product modal (QA / validation).
 */
import { localDateKeyFromIso } from './cargoDailyRates.js'
import {
  cargoDoneAtFromTimeline,
  cargoDoneToSailHours,
  CARGO_DONE_TEMPLATE_IDS,
} from './managementDashboardCargoDone.js'
import { mapEventToTemplateId } from '../data/dailyActivitiesReportFromApi.js'
import { productQtyOnVoyage } from './managementDashboardProduct.js'

const H = 3600000
const WAIT_CAP_H = 8760

function ms(v) {
  if (!v) return null
  const t = new Date(v).getTime()
  return Number.isNaN(t) ? null : t
}

function hrs(a, b) {
  const x = ms(a)
  const y = ms(b)
  return x != null && y != null && y >= x ? +(((y - x) / H).toFixed(1)) : null
}

/** @typedef {'missing_ta'|'missing_tb'|'tb_before_ta'|'wait_exceeds_berth'|'wait_exceeds_cap'|null} WaitExcludeReason */

/**
 * @param {object} row normalized voyage row from ManagementDashboard toRow
 * @param {{ etb?: string | null }} [opts]
 */
export function waitEvidence(row, opts = {}) {
  const ta = row?.ta ?? null
  const tb = row?.tb ?? null
  const etb = opts.etb ?? row?.etb ?? null
  const berth = row?.berth ?? null
  const displayedWait = row?.wait ?? null

  let rawWait = hrs(ta, tb)
  /** @type {WaitExcludeReason} */
  let excludeReason = null

  if (!ta) excludeReason = 'missing_ta'
  else if (!tb) excludeReason = 'missing_tb'
  else if (rawWait == null) excludeReason = 'tb_before_ta'
  else if (berth != null && rawWait > berth) excludeReason = 'wait_exceeds_berth'
  else if (rawWait > WAIT_CAP_H) excludeReason = 'wait_exceeds_cap'

  return {
    ta,
    tb,
    etb,
    rawWaitHours: excludeReason && excludeReason !== 'wait_exceeds_berth' && excludeReason !== 'wait_exceeds_cap'
      ? null
      : rawWait,
    displayedWaitHours: displayedWait,
    excludeReason: displayedWait == null ? excludeReason : null,
    berthHours: berth,
  }
}

export const WAIT_EXCLUDE_LABELS = {
  missing_ta: 'TA (time of arrival) is not recorded on this operation.',
  missing_tb: 'TB (time berthed / alongside) is not recorded.',
  tb_before_ta: 'TB is before TA — interval invalid.',
  wait_exceeds_berth: 'TA→TB exceeds TB→cast-off (berth) — treated as outlier and hidden.',
  wait_exceeds_cap: 'TA→TB exceeds 1 year — treated as corrupt and hidden.',
}

/**
 * Earliest Cargo Operations activity start (= Operation window start in the milestone UI).
 * @param {{ acts?: Array<object> } | null | undefined} detail
 */
export function cargoOperationWindowStartAt(detail) {
  const acts = detail?.acts || []
  const ops = acts.filter((a) => a.milestoneKey === 'cargo_operations' && a.startAt)
  if (!ops.length) return null
  const starts = ops.map((a) => ms(a.startAt)).filter(Number.isFinite)
  if (!starts.length) return null
  return new Date(Math.min(...starts)).toISOString()
}

/**
 * TB → cargo operation window start (Berth → start cargo column).
 * @param {string | null | undefined} tb
 * @param {string | null | undefined} cargoOpsStartAt
 * @param {number | null | undefined} berthHours guard: hide when interval exceeds port stay
 */
export function computeBerthToStartCargoHours(tb, cargoOpsStartAt, berthHours = null) {
  const pre = hrs(tb, cargoOpsStartAt)
  if (pre == null) return null
  if (berthHours != null && pre > berthHours) return null
  return pre
}

/**
 * @param {object} row
 * @param {{ acts?: Array<object> } | null | undefined} detail
 */
export function berthToStartEvidence(row, detail) {
  const tb = row?.tb ?? null
  const cargoOpsStartAt = cargoOperationWindowStartAt(detail)

  return {
    tb,
    cargoOpsStartAt,
    displayedHours: row?.pre ?? null,
    computedHours: computeBerthToStartCargoHours(tb, cargoOpsStartAt, row?.berth ?? null),
  }
}

/**
 * @param {object} row
 * @param {Array<object> | null | undefined} timelineEvents
 */
export function cargoDoneEvidence(row, timelineEvents) {
  const sailedAt = row?.sailedAt ?? null
  const cargoDoneAt = cargoDoneAtFromTimeline(timelineEvents)
  const hours = cargoDoneToSailHours({ cargoDoneAt, sailedAt })
  const displayed = row?.cargoDoneToSailH ?? null

  /** @type {string | null} */
  let excludeReason = null
  if (row?.status !== 'SAILED') excludeReason = 'not_sailed'
  else if (!cargoDoneAt) excludeReason = 'no_cargo_finished_in_timeline'
  else if (!sailedAt) excludeReason = 'missing_sailed_at'
  else if (hours == null) excludeReason = 'sailed_not_after_cargo_finished'

  const contributing = (Array.isArray(timelineEvents) ? timelineEvents : [])
    .map((ev) => mapEventToTemplateId(ev))
    .filter((tid) => tid && CARGO_DONE_TEMPLATE_IDS.has(tid))

  return {
    cargoDoneAt,
    sailedAt,
    computedHours: hours,
    displayedHours: displayed,
    excludeReason: displayed == null ? excludeReason : null,
    contributingTemplateIds: [...new Set(contributing)],
  }
}

export const CARGO_DONE_EXCLUDE_LABELS = {
  not_sailed: 'Operation status is not SAILED.',
  no_cargo_finished_in_timeline: 'No cargo/post-check end time on activity timeline.',
  missing_sailed_at: 'Clearance Sailed at is missing.',
  sailed_not_after_cargo_finished: 'Sailed at must be after cargo finished.',
}

/**
 * @param {object} row
 * @param {string} productKey
 */
export function flowEvidenceSummary(row, productKey) {
  const qty = Number(productQtyOnVoyage(row, productKey)) || 0
  const opsH = row?.opsH ?? null
  const rate = opsH != null && opsH > 0 && qty > 0 ? +(qty / opsH).toFixed(2) : null
  return { productQtyMt: qty, cargoOpsHours: opsH, voyageRateMtH: rate }
}

function bucketMovedQty(bucket) {
  const tanks = bucket?.tankDetail
  if (Array.isArray(tanks) && tanks.length) {
    return tanks.reduce((s, t) => s + (Number(t.qtyMoved ?? t.displayQtyMoved) || 0), 0)
  }
  const direct = Number(bucket?.movedQty ?? bucket?.moved_qty ?? bucket?.qtyMoved)
  if (Number.isFinite(direct) && direct > 0) return direct
  const rate = Number(bucket?.displayRateTph ?? bucket?.rateTph)
  if (Number.isFinite(rate) && rate > 0) return rate
  return 0
}

/**
 * @param {Array<object>} hourlyBuckets
 * @param {string} [timezone]
 * @returns {Array<{ date: string, qtyMoved: number, hoursActive: number, avgMtH: number | null }>}
 */
export function dailyFlowFromHourlyBuckets(hourlyBuckets, timezone = 'Asia/Jakarta') {
  const byDate = new Map()
  for (const b of hourlyBuckets || []) {
    const start = b.hourStart || b.hour_start
    const key = localDateKeyFromIso(start, timezone)
    if (!key) continue
    const qty = bucketMovedQty(b)
    const rate = Number(b.displayRateTph ?? b.rateTph)
    const slot = byDate.get(key) || { date: key, qtyMoved: 0, hoursActive: 0, rateSum: 0, rateCount: 0 }
    slot.qtyMoved += qty
    if (qty > 0 || (Number.isFinite(rate) && rate > 0)) {
      slot.hoursActive += 1
      if (Number.isFinite(rate) && rate > 0) {
        slot.rateSum += rate
        slot.rateCount += 1
      }
    }
    byDate.set(key, slot)
  }
  return [...byDate.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(({ date, qtyMoved, hoursActive, rateSum, rateCount }) => {
      const avgFromRate = rateCount > 0 ? +(rateSum / rateCount).toFixed(1) : null
      const avgFromQty = hoursActive > 0 && qtyMoved > 0 ? +(qtyMoved / hoursActive).toFixed(1) : null
      return {
        date,
        qtyMoved: +qtyMoved.toFixed(2),
        hoursActive,
        avgMtH: avgFromQty ?? avgFromRate,
      }
    })
}

/** Evidence drill-down: computed interval always shown in hours. */
export function formatEvidenceComputedHours(h) {
  if (h == null || !Number.isFinite(h)) return '—'
  return `${Number(h).toLocaleString('en-US', { maximumFractionDigits: 1 })} h`
}

/** Evidence drill-down: table column duration always shown in days (storage is hours). */
export function formatEvidenceDisplayedDays(h) {
  if (h == null || !Number.isFinite(h)) return '—'
  return `${(h / 24).toLocaleString('en-US', { maximumFractionDigits: 1 })} d`
}

export const EVIDENCE_COMPUTED_LABEL = 'Computed (h)'
export const EVIDENCE_DISPLAYED_DAYS_LABEL = 'Displayed (d)'

/** Voyage table column key → evidence kind */
export const VOYAGE_COLUMN_EVIDENCE = {
  wait: 'wait',
  pre: 'berthToStart',
  flow: 'flow',
  cargoDoneToSail: 'cargoDone',
}
