/**
 * "Where the berth hours go": average sailed voyage split into phases.
 * Default view is unchanged. With `split` (net-rate feature) the recorded stop hours are taken
 * out of the phase they fall in and shown as their own "Stopped" segment, and "Cargo operations"
 * becomes "Pumping" (cargo window minus stops during cargo).
 */
import { cargoDoneToSailDisplayHours, idleHoursAtBerth } from './managementDashboardCargoDone.js'

const clamp = (v, max) => Math.min(Math.max(Number(v) || 0, 0), Math.max(Number(max) || 0, 0))

/** Recorded stop hours of a row, each limited to the phase it sits in so the bar still adds up. */
export function rowStopParts(r) {
  return {
    before: clamp(r.stopHoursBefore, r.pre),
    during: clamp(r.stopHoursDuring, r.opsH),
    after: clamp(r.stopHoursAfter, cargoDoneToSailDisplayHours(r)),
  }
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
        { n: 'Pumping', cls: opsCls, getVal: (r) => num(r.opsH) == null ? null : r.opsH - rowStopParts(r).during },
        {
          n: 'Stopped (recorded)',
          cls: 'wf-stop',
          getVal: (r) => {
            const p = rowStopParts(r)
            return p.before + p.during + p.after
          },
        },
        { ...idle, n: 'Idle, no stop recorded', cls: 'wf-idle wf-idle--soft' },
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

  const withValues = segs.map((s) => ({ ...s, v: avg(s.getVal) }));
  const waitAvg = avg((r) => r.wait);
  const berthAvg = avg((r) => r.berth);
  const opsAvg = avg((r) => r.opsH);
  return {
    segs: withValues,
    total: withValues.reduce((s, x) => s + x.v, 0),
    n: rows.length,
    opsShare: berthAvg ? (opsAvg / (waitAvg + berthAvg)) * 100 : null,
    dd: rows,
  };
}
