/**
 * Per-voyage breakdown behind the Pumped / Cleaned-Kuras / Total downtime columns (Tj Pura style):
 *  - pumped (normal): moved qty outside kuras, ÷ the hours entries were running outside kuras
 *    = the Active rate
 *  - cleaned (kuras): moved qty split off at the kuras start point (or a whole entry tagged
 *    Kuras), ÷ the hours entries were running in kuras = the Cleaning / Kuras rate
 *  - stop hours before / during / after cargo; "total downtime" is the during-cargo part
 * All figures are MT; the qty split uses line-qty shares so the unit of the SI does not matter.
 */
import { summarizeStops } from './no-flow-metrics.js';

const HOUR_MS = 3600000;
const ms = (v) => (v == null ? NaN : new Date(v).getTime());
const round2 = (n) => (Number.isFinite(n) ? +n.toFixed(2) : null);
const rate = (qty, hours) => (qty > 0 && hours > 0 ? round2(qty / hours) : null);

/** Merge overlapping [start, end] spans. */
function unionSpans(spans) {
  const out = [];
  for (const [s, e] of [...spans].sort((a, b) => a[0] - b[0])) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

const spanHours = (spans) => spans.reduce((t, [s, e]) => t + (e - s), 0) / HOUR_MS;

const lineQty = (l) => Number(l.qty) || Number(l.manualQty) || 0;

/**
 * Normal / kuras spans of one entry. A whole entry tagged Kuras is all kuras; otherwise a kuras
 * start inside the entry splits it; anything else is normal.
 */
function splitLine(line, openEndMs) {
  const s = ms(line.startedAt);
  const e = line.endedAt ? ms(line.endedAt) : openEndMs;
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return null;
  if (line.movementType === 'kuras') return { s, e, k: s };
  const k = ms(line.kurasStartedAt);
  if (Number.isFinite(k) && k > s && k < e) return { s, e, k };
  return { s, e, k: null };
}

/** Qty of an entry from the kuras start onward: hourly buckets when stored, else by time share. */
function kurasQtyOfLine(line, split, hourly) {
  if (split.k === split.s) return lineQty(line);
  const buckets = hourly || [];
  if (buckets.length) {
    let q = 0;
    for (const h of buckets) {
      const hs = ms(h.hourStart);
      const he = ms(h.hourEnd);
      const from = Math.max(hs, split.k);
      if (!(he > from) || !(he > hs)) continue;
      q += (Number(h.qtyMoved) || 0) * ((he - from) / (he - hs));
    }
    return q;
  }
  return lineQty(line) * ((split.e - split.k) / (split.e - split.s));
}

/**
 * @param {{
 *   movedQty: number|null, firstLoggedAt: string|null, lastLoggedAt: string|null,
 *   lines: Array<{ id: number, startedAt: string, endedAt: string|null, qty: number|null, manualQty?: number|null,
 *                  movementType?: string|null, kurasStartedAt?: string|null }>,
 *   hoursByLine?: Map<number, Array<{ hourStart: string, hourEnd: string, qtyMoved: number }>>,
 *   events: Array<{ startedAt: string, endedAt: string|null, reasonCode?: string, category?: string }>,
 *   nowMs?: number,
 * }} input
 */
export function buildRateBreakdown({ movedQty, firstLoggedAt, lastLoggedAt, lines = [], hoursByLine = new Map(), events = [], nowMs = Date.now() }) {
  const moved = Number(movedQty) || 0;
  const endMs = ms(lastLoggedAt);

  const stops = summarizeStops({ events, cargoWindow: firstLoggedAt ? { startedAt: firstLoggedAt, endedAt: lastLoggedAt } : null, nowMs });

  const normalSpans = [];
  const kurasSpans = [];
  let kurasLineQty = 0;
  let totalLineQty = 0;
  let kurasStart = null;
  for (const line of lines) {
    const split = splitLine(line, endMs);
    if (!split) continue;
    totalLineQty += lineQty(line);
    if (split.k == null) {
      normalSpans.push([split.s, split.e]);
      continue;
    }
    if (split.k > split.s) normalSpans.push([split.s, split.k]);
    kurasSpans.push([split.k, split.e]);
    kurasLineQty += kurasQtyOfLine(line, split, hoursByLine.get(line.id));
    kurasStart = kurasStart == null ? split.k : Math.min(kurasStart, split.k);
  }

  const kurasShare = totalLineQty > 0 ? Math.min(1, kurasLineQty / totalLineQty) : 0;
  const kurasQty = moved * kurasShare;
  const normalQty = moved - kurasQty;
  const kurasHours = spanHours(unionSpans(kurasSpans));
  const normalHours = spanHours(unionSpans(normalSpans));

  // Total downtime = every hour between the first cargo start and the last cargo end when no entry
  // was running (gaps), plus recorded stops in that window; overlaps are counted once.
  const allSpans = unionSpans([...normalSpans, ...kurasSpans]);
  let downtimeHours = 0;
  let gapHours = 0;
  let noReasonHours = 0;
  let reasons = [];
  if (allSpans.length) {
    const winStart = allSpans[0][0];
    const winEnd = allSpans[allSpans.length - 1][1];
    const gaps = [];
    for (let i = 1; i < allSpans.length; i++) gaps.push([allSpans[i - 1][1], allSpans[i][0]]);
    const stopSpans = [];
    for (const e of events) {
      const s = Math.max(ms(e.startedAt), winStart);
      const en = Math.min(e.endedAt ? ms(e.endedAt) : nowMs, winEnd);
      if (Number.isFinite(s) && Number.isFinite(en) && en > s) stopSpans.push([s, en]);
    }
    gapHours = spanHours(gaps);
    downtimeHours = spanHours(unionSpans([...gaps, ...stopSpans]));
    noReasonHours = Math.max(0, downtimeHours - spanHours(unionSpans(stopSpans)));
    const byCode = new Map();
    for (const e of events) {
      const s = Math.max(ms(e.startedAt), winStart);
      const en = Math.min(e.endedAt ? ms(e.endedAt) : nowMs, winEnd);
      if (!(en > s)) continue;
      const code = e.reasonCode || 'UNKNOWN';
      if (!byCode.has(code)) byCode.set(code, { code, name: e.reasonNameEn || code, spans: [] });
      byCode.get(code).spans.push([s, en]);
    }
    reasons = [...byCode.values()]
      .map((r) => ({ code: r.code, name: r.name, hours: round2(spanHours(unionSpans(r.spans))) }))
      .sort((a, b) => b.hours - a.hours);
  }

  return {
    downtime: { hours: round2(downtimeHours) ?? 0, gapHours: round2(gapHours) ?? 0, noReasonHours: round2(noReasonHours) ?? 0, reasons },
    stopHours: {
      before: round2(stops.byPhase.before) ?? 0,
      during: round2(stops.byPhase.during) ?? 0,
      after: round2(stops.byPhase.after) ?? 0,
      total: round2(stops.totalHours) ?? 0,
    },
    stopCount: stops.stops.length,
    normal: { qty: round2(normalQty), hours: round2(normalHours), rateMtH: rate(normalQty, normalHours) },
    kuras: {
      qty: round2(kurasQty),
      hours: round2(kurasHours),
      rateMtH: rate(kurasQty, kurasHours),
      startedAt: kurasStart == null ? null : new Date(kurasStart).toISOString(),
    },
  };
}

const toIso = (v) => (v ? new Date(v).toISOString() : null);

/**
 * One batched read for many voyages: cargo entries (with movement and kuras start), hourly
 * buckets of entries split by a kuras start, and recorded stops with their reasons.
 * @returns {{ lines: Map<number, object[]>, hoursByLine: Map<number, object[]>, events: Map<number, object[]> }}
 */
export async function loadRateBreakdownInputs(db, operationIds) {
  const ids = (operationIds || []).map(Number).filter((n) => n > 0);
  const out = { lines: new Map(), hoursByLine: new Map(), events: new Map() };
  if (!ids.length) return out;

  const [linesR, eventsR] = await Promise.all([
    db.query(
      `SELECT oa.operation_id, l.id, l.qty, l.manual_qty, l.started_at, l.ended_at, l.movement_type, l.kuras_started_at
       FROM operation_cargo_load_lines l
       JOIN operation_operational_activities oa ON oa.id = l.operational_activity_id AND oa.deleted_at IS NULL
       WHERE oa.operation_id = ANY($1::bigint[]) AND oa.milestone_key = 'cargo_operations' AND l.started_at IS NOT NULL`,
      [ids]
    ),
    db.query(
      `SELECT e.operation_id, e.started_at, e.ended_at, r.code, r.category, r.name_en
       FROM operation_no_flow_events e
       JOIN master_no_flow_reasons r ON r.id = e.reason_id
       WHERE e.operation_id = ANY($1::bigint[]) AND e.deleted_at IS NULL`,
      [ids]
    ),
  ]);

  const splitLineIds = [];
  for (const row of linesR.rows) {
    const opId = Number(row.operation_id);
    if (!out.lines.has(opId)) out.lines.set(opId, []);
    out.lines.get(opId).push({
      id: Number(row.id),
      qty: row.qty != null ? Number(row.qty) : null,
      manualQty: row.manual_qty != null ? Number(row.manual_qty) : null,
      startedAt: toIso(row.started_at),
      endedAt: toIso(row.ended_at),
      movementType: row.movement_type,
      kurasStartedAt: toIso(row.kuras_started_at),
    });
    if (row.kuras_started_at && row.movement_type !== 'kuras') splitLineIds.push(Number(row.id));
  }
  for (const row of eventsR.rows) {
    const opId = Number(row.operation_id);
    if (!out.events.has(opId)) out.events.set(opId, []);
    out.events.get(opId).push({
      startedAt: toIso(row.started_at),
      endedAt: toIso(row.ended_at),
      reasonCode: row.code,
      category: row.category,
      reasonNameEn: row.name_en,
    });
  }
  if (splitLineIds.length) {
    const hoursR = await db.query(
      `SELECT load_line_id, hour_start, hour_end, qty_moved
       FROM operation_hourly_cargo_progress WHERE load_line_id = ANY($1::bigint[])`,
      [splitLineIds]
    );
    for (const h of hoursR.rows) {
      const id = Number(h.load_line_id);
      if (!out.hoursByLine.has(id)) out.hoursByLine.set(id, []);
      out.hoursByLine.get(id).push({ hourStart: toIso(h.hour_start), hourEnd: toIso(h.hour_end), qtyMoved: Number(h.qty_moved) });
    }
  }
  return out;
}
