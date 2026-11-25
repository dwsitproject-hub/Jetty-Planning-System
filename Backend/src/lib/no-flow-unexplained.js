/**
 * Stops that still need a reason ("No reason yet"), for many voyages in one batch.
 * Same detection as the voyage No-flow log (no-flow-detect.js): gaps between cargo entries and
 * runs of flat ATG hours, minus anything already covered by a recorded stop, at least the port
 * minimum long. Used by the stops report, the stops card and the Gantt.
 */
import { detectUnexplainedStops } from './no-flow-detect.js';

const toIso = (v) => (v ? new Date(v).toISOString() : null);
const push = (map, key, value) => {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
};

/**
 * @returns {Promise<Map<number, Array<{ startedAt: string, endedAt: string, minutes: number, source: 'gap'|'atg_flat' }>>>}
 */
export async function loadUnexplainedStopsByOperation(db, operationIds) {
  const ids = [...new Set((operationIds || []).map(Number).filter((n) => Number.isFinite(n) && n > 0))];
  const out = new Map();
  if (!ids.length) return out;

  const [linesR, hoursR, eventsR, minR] = await Promise.all([
    db.query(
      `SELECT oa.operation_id, l.started_at, l.ended_at
       FROM operation_cargo_load_lines l
       JOIN operation_operational_activities oa ON oa.id = l.operational_activity_id AND oa.deleted_at IS NULL
       WHERE oa.operation_id = ANY($1::bigint[]) AND oa.milestone_key = 'cargo_operations'`,
      [ids]
    ),
    db.query(
      `SELECT operation_id, hour_start, hour_end, movement_status
       FROM operation_hourly_cargo_progress WHERE operation_id = ANY($1::bigint[])`,
      [ids]
    ),
    db.query(
      `SELECT operation_id, started_at, ended_at
       FROM operation_no_flow_events WHERE operation_id = ANY($1::bigint[]) AND deleted_at IS NULL`,
      [ids]
    ),
    db.query(
      `SELECT o.id, p.no_flow_min_minutes
       FROM operations o
       LEFT JOIN jetties j ON j.id = o.jetty_id
       LEFT JOIN ports p ON p.id = COALESCE(o.port_id, j.port_id)
       WHERE o.id = ANY($1::bigint[])`,
      [ids]
    ),
  ]);

  const lines = new Map();
  const hours = new Map();
  const events = new Map();
  for (const r of linesR.rows) push(lines, Number(r.operation_id), { startedAt: toIso(r.started_at), endedAt: toIso(r.ended_at) });
  for (const r of hoursR.rows) {
    push(hours, Number(r.operation_id), { hourStart: toIso(r.hour_start), hourEnd: toIso(r.hour_end), status: r.movement_status });
  }
  for (const r of eventsR.rows) push(events, Number(r.operation_id), { startedAt: toIso(r.started_at), endedAt: toIso(r.ended_at) });
  const minMinutes = new Map(minR.rows.map((r) => [Number(r.id), Number(r.no_flow_min_minutes) || 60]));

  for (const id of ids) {
    if (!lines.has(id)) continue;
    const found = detectUnexplainedStops({
      lines: lines.get(id),
      hours: hours.get(id) || [],
      events: events.get(id) || [],
      minMinutes: minMinutes.get(id) ?? 60,
    });
    if (found.length) out.set(id, found);
  }
  return out;
}
