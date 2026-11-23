/**
 * Recorded stops of many voyages in the compact shape the Jetty Schedule Gantt draws on actual
 * bars (red marks). Sent only while FEATURE_GANTT_STOPS is on.
 */

const toIso = (v) => (v ? new Date(v).toISOString() : null);

/** One stop row → Gantt mark. An open stop (no end) runs until now on the client. */
export function mapGanttStop(row) {
  return {
    id: String(row.id),
    startedAt: toIso(row.started_at),
    endedAt: toIso(row.ended_at),
    isOpen: !row.ended_at,
    reasonCode: row.code,
    reasonNameEn: row.name_en,
    reasonNameId: row.name_id,
    category: row.category,
    note: row.note ?? null,
  };
}

/**
 * @returns {Promise<Map<number, Array<ReturnType<typeof mapGanttStop>>>>} stops per operation, oldest first
 */
export async function loadGanttStopsByOperation(db, operationIds) {
  const ids = [...new Set((operationIds || []).map(Number).filter((n) => Number.isFinite(n) && n > 0))];
  const out = new Map();
  if (!ids.length) return out;
  const r = await db.query(
    `SELECT e.id, e.operation_id, e.started_at, e.ended_at, e.note,
            r.code, r.name_en, r.name_id, r.category
     FROM operation_no_flow_events e
     JOIN master_no_flow_reasons r ON r.id = e.reason_id
     WHERE e.operation_id = ANY($1::bigint[]) AND e.deleted_at IS NULL
     ORDER BY e.started_at ASC, e.id ASC`,
    [ids]
  );
  for (const row of r.rows) {
    const opId = Number(row.operation_id);
    if (!out.has(opId)) out.set(opId, []);
    out.get(opId).push(mapGanttStop(row));
  }
  return out;
}
