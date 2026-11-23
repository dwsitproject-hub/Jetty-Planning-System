/**
 * Stops and delays report: recorded no-flow stops of a port in a period, by reason, who caused
 * it, phase of the voyage, jetty and vessel. Stop hours are cut at the period edges; the share of
 * berth time uses the same cut, so a voyage crossing the period edge counts only its part inside.
 */
import { summarizeStops } from './no-flow-metrics.js';

const HOUR_MS = 3600000;
const ms = (v) => (v == null ? NaN : new Date(v).getTime());
const round2 = (n) => (Number.isFinite(n) ? +n.toFixed(2) : 0);

/** Hours of [start, end] inside [fromMs, toMs]. */
function hoursInside(start, end, fromMs, toMs) {
  const s = Math.max(start, fromMs);
  const e = Math.min(end, toMs);
  return e > s ? (e - s) / HOUR_MS : 0;
}

function addTo(map, key, hours, extra) {
  const cur = map.get(key) || { key, hours: 0, count: 0, ...extra };
  cur.hours += hours;
  cur.count += 1;
  map.set(key, cur);
}

/** Single phase name, or 'mixed' when a stop spans more than one phase of the voyage. */
export function stopPhaseLabel(p) {
  const used = ['before', 'during', 'after'].filter((k) => p[k] > 0);
  return used.length === 1 ? used[0] : used.length === 0 ? 'during' : 'mixed';
}

const sortedDesc = (map) => [...map.values()].sort((a, b) => b.hours - a.hours);

/**
 * @param {{
 *   voyages: Array<{ id: number, vessel: string|null, jetty: string|null, purpose: string|null, siRef: string|null,
 *                    tb: string|null, castOff: string|null, cargoStart: string|null, cargoEnd: string|null }>,
 *   events: Array<{ id: number, operationId: number, startedAt: string, endedAt: string|null, reasonCode: string,
 *                   reasonNameEn: string, reasonNameId: string, category: string, note: string|null, source: string }>,
 *   range: { from: string, to: string },
 *   nowMs?: number,
 * }} input
 */
export function buildNoFlowReport({ voyages = [], events = [], range, nowMs = Date.now() }) {
  const fromMs = ms(range.from);
  const toMs = ms(range.to);
  const voyageById = new Map(voyages.map((v) => [v.id, v]));

  let berthHours = 0;
  const berthedIds = new Set();
  for (const v of voyages) {
    const tb = ms(v.tb);
    if (!Number.isFinite(tb)) continue;
    const end = v.castOff ? ms(v.castOff) : nowMs;
    const h = hoursInside(tb, end, fromMs, toMs);
    if (h > 0) {
      berthHours += h;
      berthedIds.add(v.id);
    }
  }

  const eventsByOp = new Map();
  for (const e of events) {
    if (!eventsByOp.has(e.operationId)) eventsByOp.set(e.operationId, []);
    eventsByOp.get(e.operationId).push(e);
  }

  const byReason = new Map();
  const byCategory = new Map();
  const byJetty = new Map();
  const byVoyage = new Map();
  const byPhase = { before: 0, during: 0, after: 0 };
  const stops = [];
  let totalHours = 0;

  for (const [operationId, list] of eventsByOp) {
    const voyage = voyageById.get(operationId) || { id: operationId };
    const cargoWindow = voyage.cargoStart ? { startedAt: voyage.cargoStart, endedAt: voyage.cargoEnd } : null;
    const s = summarizeStops({ events: list, cargoWindow, range, nowMs });
    totalHours += s.totalHours;
    for (const p of Object.keys(byPhase)) byPhase[p] += s.byPhase[p];
    for (const stop of s.stops) {
      addTo(byReason, stop.reasonCode, stop.hours, {
        code: stop.reasonCode, nameEn: stop.reasonNameEn, nameId: stop.reasonNameId, category: stop.category,
      });
      addTo(byCategory, stop.category, stop.hours);
      addTo(byJetty, voyage.jetty || '—', stop.hours);
      const row = byVoyage.get(operationId) || {
        operationId, vessel: voyage.vessel ?? null, jetty: voyage.jetty ?? null, purpose: voyage.purpose ?? null,
        siRef: voyage.siRef ?? null, totalHours: 0, byReason: {},
      };
      row.totalHours += stop.hours;
      row.byReason[stop.reasonCode] = round2((row.byReason[stop.reasonCode] || 0) + stop.hours);
      byVoyage.set(operationId, row);
      stops.push({
        id: stop.id,
        operationId,
        vessel: voyage.vessel ?? null,
        jetty: voyage.jetty ?? null,
        purpose: voyage.purpose ?? null,
        startedAt: stop.startedAt,
        endedAt: stop.endedAt,
        isOpen: !stop.endedAt,
        hours: round2(stop.hours),
        phase: stopPhaseLabel(stop.phaseHours),
        reasonCode: stop.reasonCode,
        reasonNameEn: stop.reasonNameEn,
        reasonNameId: stop.reasonNameId,
        category: stop.category,
        note: stop.note ?? null,
        source: stop.source,
      });
    }
  }

  const reasons = sortedDesc(byReason).map((r) => ({
    code: r.code, nameEn: r.nameEn, nameId: r.nameId, category: r.category,
    hours: round2(r.hours), count: r.count, pct: totalHours > 0 ? round2((r.hours / totalHours) * 100) : 0,
  }));
  const voyageRows = [...byVoyage.values()]
    .map((r) => ({ ...r, totalHours: round2(r.totalHours) }))
    .sort((a, b) => b.totalHours - a.totalHours);

  return {
    range,
    summary: {
      stopHours: round2(totalHours),
      berthHours: round2(berthHours),
      stopPctOfBerth: berthHours > 0 ? round2((totalHours / berthHours) * 100) : null,
      stopCount: stops.length,
      voyagesWithStops: voyageRows.length,
      voyagesBerthed: berthedIds.size,
      biggestReason: reasons[0] ? { code: reasons[0].code, nameEn: reasons[0].nameEn, nameId: reasons[0].nameId, hours: reasons[0].hours, pct: reasons[0].pct } : null,
    },
    byReason: reasons,
    byCategory: sortedDesc(byCategory).map((c) => ({ category: c.key, hours: round2(c.hours), count: c.count })),
    byPhase: { before: round2(byPhase.before), during: round2(byPhase.during), after: round2(byPhase.after) },
    byJetty: sortedDesc(byJetty).map((j) => ({ jetty: j.key, hours: round2(j.hours), count: j.count })),
    byVoyage: voyageRows,
    stops: stops.sort((a, b) => ms(b.startedAt) - ms(a.startedAt)),
  };
}

const toIso = (v) => (v ? new Date(v).toISOString() : null);

/**
 * Load the voyages and stops of a port for the period.
 * @param {{ portId: number, from: string, to: string, purpose?: string|null, jettyId?: number|null }} params
 */
export async function loadNoFlowReportInputs(db, { portId, from, to, purpose = null, jettyId = null }) {
  const filters = `AND ($4::text IS NULL OR o.purpose = $4) AND ($5::bigint IS NULL OR o.jetty_id = $5)`;
  const common = [portId, from, to, purpose, jettyId];
  const base = `
    FROM operations o
    JOIN shipping_instructions si ON si.id = o.shipping_instruction_id AND si.deleted_at IS NULL
    LEFT JOIN shipment_plans sp ON sp.id = si.shipment_plan_id
    LEFT JOIN jetties j ON j.id = o.jetty_id AND j.deleted_at IS NULL
    WHERE o.deleted_at IS NULL AND COALESCE(o.port_id, j.port_id) = $1 ${filters}`;
  const cols = `o.id, sp.vessel_name, j.name AS jetty_name, o.purpose, si.reference_number, o.tb,
                COALESCE(o.cast_off_at, o.sailed_at) AS cast_off`;

  const [berthedR, eventsR] = await Promise.all([
    db.query(
      `SELECT ${cols} ${base}
         AND o.tb IS NOT NULL AND o.tb < $3::timestamptz
         AND COALESCE(o.cast_off_at, o.sailed_at, NOW()) > $2::timestamptz`,
      common
    ),
    db.query(
      `SELECT e.id, e.operation_id, e.started_at, e.ended_at, e.note, e.source,
              r.code, r.name_en, r.name_id, r.category, ${cols}
         FROM operation_no_flow_events e
         JOIN master_no_flow_reasons r ON r.id = e.reason_id
         JOIN operations o ON o.id = e.operation_id
         JOIN shipping_instructions si ON si.id = o.shipping_instruction_id AND si.deleted_at IS NULL
         LEFT JOIN shipment_plans sp ON sp.id = si.shipment_plan_id
         LEFT JOIN jetties j ON j.id = o.jetty_id AND j.deleted_at IS NULL
        WHERE e.deleted_at IS NULL AND o.deleted_at IS NULL AND COALESCE(o.port_id, j.port_id) = $1 ${filters}
          AND e.started_at < $3::timestamptz AND COALESCE(e.ended_at, NOW()) > $2::timestamptz`,
      common
    ),
  ]);

  const voyageMap = new Map();
  const remember = (row, opId) => {
    if (voyageMap.has(opId)) return;
    voyageMap.set(opId, {
      id: opId, vessel: row.vessel_name ?? null, jetty: row.jetty_name ?? null, purpose: row.purpose ?? null,
      siRef: row.reference_number ?? null, tb: toIso(row.tb), castOff: toIso(row.cast_off), cargoStart: null, cargoEnd: null,
    });
  };
  for (const r of berthedR.rows) remember(r, Number(r.id));
  for (const r of eventsR.rows) remember(r, Number(r.operation_id));

  const ids = [...voyageMap.keys()];
  if (ids.length) {
    const win = await db.query(
      `SELECT oa.operation_id, MIN(l.started_at) AS cargo_start,
              CASE WHEN BOOL_OR(l.ended_at IS NULL) THEN NULL ELSE MAX(l.ended_at) END AS cargo_end
         FROM operation_cargo_load_lines l
         JOIN operation_operational_activities oa ON oa.id = l.operational_activity_id AND oa.deleted_at IS NULL
        WHERE oa.operation_id = ANY($1::bigint[]) AND oa.milestone_key = 'cargo_operations' AND l.started_at IS NOT NULL
        GROUP BY oa.operation_id`,
      [ids]
    );
    for (const w of win.rows) {
      const v = voyageMap.get(Number(w.operation_id));
      if (v) {
        v.cargoStart = toIso(w.cargo_start);
        v.cargoEnd = toIso(w.cargo_end);
      }
    }
  }

  const events = eventsR.rows.map((e) => ({
    id: Number(e.id),
    operationId: Number(e.operation_id),
    startedAt: toIso(e.started_at),
    endedAt: toIso(e.ended_at),
    reasonCode: e.code,
    reasonNameEn: e.name_en,
    reasonNameId: e.name_id,
    category: e.category,
    note: e.note ?? null,
    source: e.source,
  }));
  return { voyages: [...voyageMap.values()], events };
}
