/**
 * Per-voyage figures for the By Vessel drill-down charts.
 * Time stages reuse the "where the berth hours go" card, so names and colours match it.
 */
import { buildBerthHourSegments } from './managementDashboardBerthHours.js'

/**
 * Stages of one voyage, in order, without empty ones.
 * @param {object} row By Voyage row
 * @param {boolean} split net-rate breakdown on (same switch as the port-stay card)
 * @returns {{ segs: Array<{ key: string, n: string, cls: string, v: number }>, total: number }}
 */
export function voyageTimeSegments(row, split) {
  const { segs } = buildBerthHourSegments([row], { purpose: row.purpose, split })
  const shown = segs.filter((s) => s.v > 0).map(({ key, n, cls, v }) => ({ key, n, cls, v }))
  return { segs: shown, total: shown.reduce((s, x) => s + x.v, 0) }
}
