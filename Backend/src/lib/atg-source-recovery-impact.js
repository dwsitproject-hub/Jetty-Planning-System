/**
 * Which cargo entries read ATG samples from the tanks and window of a source recovery,
 * so the dialog can show what a recovery touches and which Manual entries can use ATG again.
 */

const ENTRIES_USING_WINDOW_SQL = `
  WITH numbered AS (
    SELECT l.id, l.operational_activity_id, l.started_at, l.ended_at, l.atg_qty_mode,
           ROW_NUMBER() OVER (
             PARTITION BY l.operational_activity_id ORDER BY l.started_at NULLS LAST, l.id
           ) AS entry_no
    FROM operation_cargo_load_lines l
  )
  SELECT n.id AS load_line_id,
         n.entry_no,
         n.atg_qty_mode,
         oa.operation_id,
         sp.vessel_name,
         si.reference_number,
         ARRAY_AGG(DISTINCT t.code ORDER BY t.code) AS tank_codes
  FROM numbered n
  JOIN operation_operational_activities oa ON oa.id = n.operational_activity_id AND oa.deleted_at IS NULL
  JOIN operations o ON o.id = oa.operation_id AND o.deleted_at IS NULL AND o.port_id = $1
  JOIN shipping_instructions si ON si.id = o.shipping_instruction_id AND si.deleted_at IS NULL
  LEFT JOIN shipment_plans sp ON sp.id = si.shipment_plan_id AND sp.deleted_at IS NULL
  JOIN operation_cargo_load_line_tanks clt ON clt.load_line_id = n.id AND clt.tank_id = ANY($2::bigint[])
  JOIN master_tanks t ON t.id = clt.tank_id AND t.deleted_at IS NULL
  WHERE n.started_at IS NOT NULL
    AND n.started_at <= $4::timestamptz
    AND COALESCE(n.ended_at, NOW()) >= $3::timestamptz
  GROUP BY n.id, n.entry_no, n.atg_qty_mode, oa.operation_id, sp.vessel_name, si.reference_number
  ORDER BY oa.operation_id, n.entry_no`;

/** @param {object} row */
export function mapEntryRow(row) {
  const vessel = row.vessel_name || '—';
  return {
    operationId: Number(row.operation_id),
    loadLineId: Number(row.load_line_id),
    operationLabel: row.reference_number ? `${vessel} (${row.reference_number})` : vessel,
    entryNo: Number(row.entry_no),
    entryMode: row.atg_qty_mode === 'manual' ? 'manual' : 'auto',
    tankCodes: row.tank_codes ?? [],
  };
}

/**
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {{ portId: number, tankIds: number[], startAt: string|Date, endAt: string|Date }} opts
 */
export async function findEntriesUsingWindow(db, { portId, tankIds, startAt, endAt }) {
  if (!tankIds?.length) return [];
  const r = await db.query(ENTRIES_USING_WINDOW_SQL, [
    portId,
    tankIds,
    new Date(startAt).toISOString(),
    new Date(endAt).toISOString(),
  ]);
  return r.rows.map(mapEntryRow);
}

/** Manual entries are the ones that can switch back to ATG once the readings exist. */
export function manualEntries(entries) {
  return (entries || []).filter((e) => e.entryMode === 'manual');
}

/** Operations whose hourly/daily progress should be recomputed after a recovery. */
export function distinctOperationIds(entries) {
  return [...new Set((entries || []).map((e) => e.operationId))];
}
