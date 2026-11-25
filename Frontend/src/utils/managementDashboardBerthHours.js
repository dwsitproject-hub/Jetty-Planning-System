/**
 * "Where the berth hours go": average sailed voyage split into phases.
 * Default view is unchanged. With `split` (net-rate feature) the recorded stop hours are taken
 * out of the phase they fall in and shown as their own "Stopped" segment (stops still without a
 * reason get a "No reason yet" segment taken from the pumping window), and "Cargo operations"
 * becomes "Pumping" (cargo window minus stops during cargo).
 */
import { cargoDoneToSailDisplayHours, idleHoursAtBerth } from './managementDashboardCargoDone.js'

const clamp = (v, max) => Math.min(Math.max(Number(v) || 0, 0), Math.max(Number(max) || 0, 0))

/**
 * Cargo hours of a voyage. With the rate breakdown (net-rate feature) this is the cargo window of the
 * entries (first start → last end, as in the By Voyage table); the cargo-operations activity record is
 * often a short marker and would leave most of the stay looking idle.
 */
export function rowOpsHours(r) {
  const logged = Number(r?.voyageLoggedHours)
  if (r?.rateBreakdown && Number.isFinite(logged) && logged >= 0) {
    return Number.isFinite(Number(r.berth)) ? Math.min(logged, Number(r.berth)) : logged
  }
  return r?.opsH
}

/** Recorded stop hours of a row, each limited to the phase it sits in so the bar still adds up. */
export function rowStopParts(r) {
  return {
    before: clamp(r.stopHoursBefore, r.pre),
    during: clamp(r.stopHoursDuring, rowOpsHours(r)),
    after: clamp(r.stopHoursAfter, cargoDoneToSailDisplayHours(r)),
  }
}

/** Detected stops without a reason: taken from the pumping window, next to the recorded ones. */
export function rowUnexplainedHours(r) {
  return clamp(r.unexplainedHours, (Number(rowOpsHours(r)) || 0) - rowStopParts(r).during)
}

const num = (v) => (v == null ? null : Number(v))

/**
 * @param {Array<object>} rows sailed voyages with berth time
 * @param {{ purpose?: string, split?: boolean }} opts
 */
export function buildBerthHourSegments(rows, { purpose = 'all', split = false } = {}) {
  const avg = (f) => {
    const a = rows.map(f).filter((x) => x != null)
    return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0
  }
  const opsCls = purpose === 'Loading' ? 'wf-load' : purpose === 'Unloading' ? 'wf-disch' : 'wf-ops'
  const wait = { n: 'Anchorage wait (TA→TB)', cls: 'wf-wait', getVal: (r) => r.wait }
  const idle = { n: 'Idle / delays at berth', cls: 'wf-idle', getVal: idleHoursAtBerth }

  const segs = split
    ? [
        wait,
        { n: 'Berth → start cargo', cls: 'wf-pre', getVal: (r) => num(r.pre) == null ? null : r.pre - rowStopParts(r).before },
        { n: 'Pumping', cls: opsCls, getVal: (r) => num(rowOpsHours(r)) == null ? null : rowOpsHours(r) - rowStopParts(r).during - rowUnexplainedHours(r) },
        {
          n: 'Stopped (recorded)',
          cls: 'wf-stop',
          getVal: (r) => {
            const p = rowStopParts(r)
            return p.before + p.during + p.after
          },
        },
        { n: 'No reason yet', cls: 'wf-noreason', getVal: rowUnexplainedHours },
        {
          n: 'Idle, no stop recorded',
          cls: 'wf-idle wf-idle--soft',
          getVal: (r) => {
            if (r?.berth == null || !Number.isFinite(r.berth)) return null
            return Math.max(r.berth - (r.pre || 0) - (rowOpsHours(r) || 0) - (cargoDoneToSailDisplayHours(r) || 0), 0)
          },
        },
        {
          n: 'Cargo done → sailed off',
          cls: 'wf-post',
          getVal: (r) => {
            const h = cargoDoneToSailDisplayHours(r)
            return h == null ? null : h - rowStopParts(r).after
          },
        },
      ]
    : [
        wait,
        { n: 'Berth → start cargo', cls: 'wf-pre', getVal: (r) => r.pre },
        { n: 'Cargo operations', cls: opsCls, getVal: (r) => r.opsH },
        idle,
        { n: 'Cargo done → sailed off', cls: 'wf-post', getVal: cargoDoneToSailDisplayHours },
      ];

  const median = (f) => {
    const a = rows.map(f).filter((x) => x != null).sort((x, y) => x - y)
    if (!a.length) return null
    const m = Math.floor(a.length / 2)
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2
  }
  const withValues = segs.map((s) => ({ ...s, v: avg(s.getVal), med: s === wait ? median(s.getVal) : null }));
  const waitAvg = avg((r) => r.wait);
  const berthAvg = avg((r) => r.berth);
  const opsAvg = avg(split ? rowOpsHours : (r) => r.opsH);
  return {
    segs: withValues,
    total: withValues.reduce((s, x) => s + x.v, 0),
    n: rows.length,
    opsShare: berthAvg ? (opsAvg / (waitAvg + berthAvg)) * 100 : null,
    dd: rows,
  };
}
