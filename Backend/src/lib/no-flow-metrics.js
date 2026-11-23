/**
 * Stop-hour figures shared by the net rate, the stops report and the Gantt stop marks.
 * Each recorded stop is cut to the requested date range, then split by voyage phase:
 *  - before: ahead of the first cargo start (e.g. waiting HO approval after berthing)
 *  - during: between first cargo start and last cargo end ("Total downtime" in Tj Pura terms)
 *  - after:  past the last cargo end
 * An open stop (no end) runs until now. A voyage without cargo yet counts everything as before.
 */

export const STOP_PHASES = ['before', 'during', 'after'];

const ms = (v) => (v == null ? NaN : new Date(v).getTime());
const hours = (a, b) => Math.max(0, b - a) / 3600000;

function overlap(aStart, aEnd, bStart, bEnd) {
  return hours(Math.max(aStart, bStart), Math.min(aEnd, bEnd));
}

/**
 * Phase hours of one stop window that is already cut to the range.
 * @param {number} start
 * @param {number} end
 * @param {{ startMs: number, endMs: number }|null} cargo
 */
function splitByPhase(start, end, cargo) {
  if (!cargo || !Number.isFinite(cargo.startMs)) return { before: hours(start, end), during: 0, after: 0 };
  const cargoEnd = Number.isFinite(cargo.endMs) ? cargo.endMs : Infinity;
  return {
    before: overlap(start, end, -Infinity, cargo.startMs),
    during: overlap(start, end, cargo.startMs, cargoEnd),
    after: overlap(start, end, cargoEnd, Infinity),
  };
}

/**
 * @param {{
 *   events: Array<{ startedAt: string, endedAt: string|null, reasonCode?: string, category?: string }>,
 *   cargoWindow?: { startedAt: string, endedAt: string|null }|null,
 *   range?: { from?: string|null, to?: string|null },
 *   nowMs?: number,
 * }} input
 * @returns {{
 *   totalHours: number,
 *   byPhase: Record<'before'|'during'|'after', number>,
 *   byReason: Record<string, number>,
 *   byCategory: Record<string, number>,
 *   stops: Array<object>,
 * }}
 */
export function summarizeStops({ events = [], cargoWindow = null, range = {}, nowMs = Date.now() }) {
  const fromMs = Number.isFinite(ms(range.from)) ? ms(range.from) : -Infinity;
  const toMs = Number.isFinite(ms(range.to)) ? ms(range.to) : Infinity;
  const cargo = cargoWindow && Number.isFinite(ms(cargoWindow.startedAt))
    ? { startMs: ms(cargoWindow.startedAt), endMs: cargoWindow.endedAt ? ms(cargoWindow.endedAt) : nowMs }
    : null;

  const out = { totalHours: 0, byPhase: { before: 0, during: 0, after: 0 }, byReason: {}, byCategory: {}, stops: [] };
  for (const e of events) {
    const rawStart = ms(e.startedAt);
    const rawEnd = e.endedAt ? ms(e.endedAt) : nowMs;
    if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) continue;
    const start = Math.max(rawStart, fromMs);
    const end = Math.min(rawEnd, toMs);
    if (end <= start) continue;
    const phase = splitByPhase(start, end, cargo);
    const total = phase.before + phase.during + phase.after;
    out.totalHours += total;
    for (const p of STOP_PHASES) out.byPhase[p] += phase[p];
    const reason = e.reasonCode || 'UNKNOWN';
    const category = e.category || 'other';
    out.byReason[reason] = (out.byReason[reason] || 0) + total;
    out.byCategory[category] = (out.byCategory[category] || 0) + total;
    out.stops.push({ ...e, hours: total, phaseHours: phase });
  }
  return out;
}

/**
 * Hours a voyage was actually pumping: cargo window minus stops during cargo.
 * Never below zero, so overlapping bad data cannot produce a negative divisor.
 */
export function pumpingHours(cargoWindowHours, stopHoursDuring) {
  const w = Number(cargoWindowHours);
  if (!Number.isFinite(w) || w <= 0) return null;
  return Math.max(0, w - (Number(stopHoursDuring) || 0));
}
