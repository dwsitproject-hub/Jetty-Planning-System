/**
 * Finds no-flow periods of a voyage that still need a reason:
 *  - gaps between cargo entries (one entry ends, the next starts later)
 *  - runs of clock hours where every ATG row is flat_movement
 * Periods already covered by a recorded stop are cut out; what is left must last at
 * least the port minimum to be flagged.
 */

const ms = (v) => (v == null ? NaN : new Date(v).getTime());
const iso = (n) => new Date(n).toISOString();

function gapPeriods(lines) {
  const sorted = lines
    .map((l) => ({ start: ms(l.startedAt), end: l.endedAt ? ms(l.endedAt) : Infinity }))
    .filter((l) => Number.isFinite(l.start))
    .sort((a, b) => a.start - b.start);
  const out = [];
  let reach = -Infinity;
  for (const l of sorted) {
    if (Number.isFinite(reach) && l.start > reach) out.push({ start: reach, end: l.start, source: 'gap' });
    reach = Math.max(reach, l.end);
  }
  return out;
}

function flatPeriods(hours) {
  const byHour = new Map();
  for (const h of hours) {
    const start = ms(h.hourStart);
    const end = ms(h.hourEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const cur = byHour.get(start) || { start, end, flat: true };
    cur.end = Math.max(cur.end, end);
    if (h.status !== 'flat_movement') cur.flat = false;
    byHour.set(start, cur);
  }
  const out = [];
  for (const h of [...byHour.values()].filter((x) => x.flat).sort((a, b) => a.start - b.start)) {
    const last = out[out.length - 1];
    if (last && h.start <= last.end) last.end = Math.max(last.end, h.end);
    else out.push({ start: h.start, end: h.end, source: 'atg_flat' });
  }
  return out;
}

function union(periods) {
  const out = [];
  for (const p of [...periods].sort((a, b) => a.start - b.start)) {
    const last = out[out.length - 1];
    if (last && p.start <= last.end) {
      last.end = Math.max(last.end, p.end);
      if (p.source === 'gap') last.source = 'gap';
    } else {
      out.push({ ...p });
    }
  }
  return out;
}

function subtract(period, covers) {
  let pieces = [period];
  for (const c of covers) {
    pieces = pieces.flatMap((p) => {
      if (c.end <= p.start || c.start >= p.end) return [p];
      const left = c.start > p.start ? [{ ...p, end: c.start }] : [];
      const right = c.end < p.end ? [{ ...p, start: c.end }] : [];
      return [...left, ...right];
    });
  }
  return pieces;
}

/**
 * @param {{
 *   lines: Array<{ startedAt: string, endedAt: string|null }>,
 *   hours: Array<{ hourStart: string, hourEnd: string, status: string }>,
 *   events: Array<{ startedAt: string, endedAt: string|null }>,
 *   minMinutes: number,
 * }} input  An event without endedAt is an open stop and covers everything after its start.
 * @returns {Array<{ startedAt: string, endedAt: string, minutes: number, source: 'gap'|'atg_flat' }>}
 */
export function detectUnexplainedStops({ lines = [], hours = [], events = [], minMinutes = 60 }) {
  const covers = events
    .map((e) => ({ start: ms(e.startedAt), end: e.endedAt ? ms(e.endedAt) : Infinity }))
    .filter((c) => Number.isFinite(c.start) && !Number.isNaN(c.end));
  const minMs = Math.max(1, Number(minMinutes) || 60) * 60000;
  return union([...gapPeriods(lines), ...flatPeriods(hours)])
    .flatMap((p) => subtract(p, covers))
    .filter((p) => p.end - p.start >= minMs)
    .map((p) => ({
      startedAt: iso(p.start),
      endedAt: iso(p.end),
      minutes: Math.round((p.end - p.start) / 60000),
      source: p.source,
    }));
}

/** First entry start → last entry end (now while an entry is open), for the flow strip. */
export function flowWindow(lines, nowMs = Date.now()) {
  const starts = lines.map((l) => ms(l.startedAt)).filter(Number.isFinite);
  if (!starts.length) return null;
  const open = lines.some((l) => !l.endedAt);
  const ends = lines.map((l) => ms(l.endedAt)).filter(Number.isFinite);
  const end = open ? nowMs : Math.max(...ends);
  return { startedAt: iso(Math.min(...starts)), endedAt: iso(Math.max(end, Math.min(...starts))), isOpen: open };
}

/**
 * @param {Array<{ startMs: number, endMs: number, qty: number|null }>} windows newest first
 * @param {number} flatRatePerHour below this a window counts as no flow
 * @returns {{ known: boolean, flowingNow: boolean, flatSinceMs: number|null }}
 */
export function classifyFlatRun(windows, flatRatePerHour) {
  const rate = (w) => (w.qty == null ? null : Math.abs(w.qty) / ((w.endMs - w.startMs) / 3600000));
  const newest = windows[0];
  if (!newest || rate(newest) == null) return { known: false, flowingNow: false, flatSinceMs: null };
  if (rate(newest) >= flatRatePerHour) return { known: true, flowingNow: true, flatSinceMs: null };
  let flatSinceMs = newest.startMs;
  for (const w of windows.slice(1)) {
    const r = rate(w);
    if (r == null || r >= flatRatePerHour) break;
    flatSinceMs = w.startMs;
  }
  return { known: true, flowingNow: false, flatSinceMs };
}
