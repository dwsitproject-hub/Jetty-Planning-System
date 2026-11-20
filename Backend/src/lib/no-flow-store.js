/**
 * DB side of the no-flow log: recorded stops of a voyage plus the detected stops that
 * still need a reason (see no-flow-detect.js).
 */
import { detectUnexplainedStops, flowWindow } from './no-flow-detect.js';

const toIso = (v) => (v ? new Date(v).toISOString() : null);

/** An open stop (no end yet) runs until now. */
export function mapNoFlowEvent(row, nowMs = Date.now()) {
  const startedAt = toIso(row.started_at);
  const endedAt = toIso(row.ended_at);
  const endMs = endedAt ? new Date(endedAt).getTime() : nowMs;
  return {
    id: String(row.id),
    startedAt,
    endedAt,
    isOpen: !endedAt,
    closeSource: row.close_source ?? null,
    minutes: Math.max(0, Math.round((endMs - new Date(startedAt).getTime()) / 60000)),
    reasonId: String(row.reason_id),
    reasonCode: row.reason_code,
    reasonNameEn: row.reason_name_en,
    reasonNameId: row.reason_name_id,
    category: row.reason_category,
    note: row.note ?? null,
    source: row.source,
    updatedAt: toIso(row.updated_at),
    updatedByName: row.updated_by_name ?? null,
  };
}

export const NO_FLOW_EVENT_SELECT = `
  SELECT e.id, e.started_at, e.ended_at, e.reason_id, e.note, e.source, e.close_source, e.updated_at,
         r.code AS reason_code, r.name_en AS reason_name_en, r.name_id AS reason_name_id,
         r.category AS reason_category,
         NULLIF(TRIM(COALESCE(u.display_name, u.username, '')), '') AS updated_by_name
  FROM operation_no_flow_events e
  JOIN master_no_flow_reasons r ON r.id = e.reason_id
  LEFT JOIN users u ON u.id = COALESCE(e.updated_by, e.created_by)`;

export async function loadPortNoFlowMinMinutes(db, operationId) {
  const r = await db.query(
    `SELECT p.no_flow_min_minutes
     FROM operations o
     LEFT JOIN jetties j ON j.id = o.jetty_id
     JOIN ports p ON p.id = COALESCE(o.port_id, j.port_id)
     WHERE o.id = $1`,
    [operationId]
  );
  return Number(r.rows[0]?.no_flow_min_minutes ?? 60);
}

/** Recorded + unexplained stops for one voyage, with totals for the flow strip. */
export async function loadNoFlowSummary(db, operationId) {
  const [linesR, hoursR, eventsR, minMinutes] = await Promise.all([
    db.query(
      `SELECT l.started_at, l.ended_at
       FROM operation_cargo_load_lines l
       JOIN operation_operational_activities oa ON oa.id = l.operational_activity_id AND oa.deleted_at IS NULL
       WHERE oa.operation_id = $1 AND oa.milestone_key = 'cargo_operations'`,
      [operationId]
    ),
    db.query(
      `SELECT hour_start, hour_end, movement_status FROM operation_hourly_cargo_progress WHERE operation_id = $1`,
      [operationId]
    ),
    db.query(`${NO_FLOW_EVENT_SELECT} WHERE e.operation_id = $1 AND e.deleted_at IS NULL ORDER BY e.started_at`, [
      operationId,
    ]),
    loadPortNoFlowMinMinutes(db, operationId),
  ]);
  const lines = linesR.rows.map((l) => ({ startedAt: toIso(l.started_at), endedAt: toIso(l.ended_at) }));
  const events = eventsR.rows.map((row) => mapNoFlowEvent(row));
  const unexplained = detectUnexplainedStops({
    lines,
    hours: hoursR.rows.map((h) => ({
      hourStart: toIso(h.hour_start),
      hourEnd: toIso(h.hour_end),
      status: h.movement_status,
    })),
    events,
    minMinutes,
  });
  const sum = (list) => list.reduce((n, x) => n + x.minutes, 0);
  const openStop = events.find((e) => e.isOpen) || null;
  const window = flowWindow(lines);
  if (window && openStop && !window.isOpen) {
    window.endedAt = new Date().toISOString();
    window.isOpen = true;
  }
  return {
    minMinutes,
    window,
    events,
    openStop,
    unexplained,
    totals: {
      explainedMinutes: sum(events),
      unexplainedMinutes: sum(unexplained),
      unexplainedCount: unexplained.length,
    },
  };
}

/**
 * Close the open stop of a voyage once a cargo entry starts after it (operator stopped
 * cargo with a reason, then started cargo again).
 */
export async function closeOpenStopOnCargoStart(db, operationId) {
  await db.query(
    `UPDATE operation_no_flow_events e
     SET ended_at = nx.started_at, close_source = 'cargo_start', updated_at = NOW()
     FROM (
       SELECT MIN(l.started_at) AS started_at
       FROM operation_cargo_load_lines l
       JOIN operation_operational_activities oa ON oa.id = l.operational_activity_id AND oa.deleted_at IS NULL
       JOIN operation_no_flow_events o ON o.operation_id = oa.operation_id
        AND o.ended_at IS NULL AND o.deleted_at IS NULL
       WHERE oa.operation_id = $1 AND oa.milestone_key = 'cargo_operations' AND l.started_at > o.started_at
     ) nx
     WHERE e.operation_id = $1 AND e.ended_at IS NULL AND e.deleted_at IS NULL AND nx.started_at IS NOT NULL`,
    [operationId]
  );
}
