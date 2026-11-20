/**
 * Shared pieces for the field-menu queues (QC Sampling, Custom Clearance): which operations a
 * queue lists, the vessel header every row carries, one batched read of a sub-process across
 * many operations, and the view-only lock on sailed vessels.
 */
import { pool } from '../db.js';
import { isBerthedQueueRow } from './berthed-queue.js';
import {
  SAILED_READ_ONLY_MESSAGE,
  isSailedStatus,
  parseSailedRange,
  queueScopeOf,
  sortByCastOffDesc,
} from './field-queue-scope.js';

/** Vessel / SI header fields shared by every field-menu queue row. */
export function queueHeader(row) {
  return {
    operationId: row.operationId,
    shipmentPlanId: row.shipmentPlanId,
    vesselName: row.vesselName,
    jetty: row.jetty,
    purpose: row.purpose,
    loadDischarge: row.loadDischarge ?? null,
    shippingInstruction: row.shippingInstruction,
    jettyOperationCode: row.jettyOperationCode ?? null,
    commodity: row.commodity,
    commodityDisplay: row.commodityDisplay,
    commodityShortDisplay: row.commodityShortDisplay,
    tbDateTime: row.tbDateTime,
    castOffDateTime: row.castOffDateTime ?? null,
    status: row.status,
    readOnly: isSailedStatus(row.status),
  };
}

/**
 * Overview rows for one queue request: berthed vessels, or (`?scope=sailed`) vessels cast off
 * inside `?from=&to=` (default last 30 days), newest first.
 * @param {{ loadOverview: (portId: number) => Promise<{ queue: object[] }>, loadSailed: Function }} deps
 */
export async function loadFieldQueueRows(selectedPortId, query, { loadOverview, loadSailed }) {
  if (queueScopeOf(query) === 'sailed') {
    return sortByCastOffDesc(await loadSailed(selectedPortId, parseSailedRange(query)));
  }
  const overview = await loadOverview(selectedPortId);
  return (Array.isArray(overview?.queue) ? overview.queue : []).filter(isBerthedQueueRow);
}

/** Cast-off of a sailed operation (null when it has not sailed or does not exist). */
async function loadSailedCastOff(operationId) {
  const r = await pool.query(
    `SELECT COALESCE(sp.cast_off_at, o.cast_off_at) AS cast_off_at
     FROM operations o
     JOIN shipping_instructions si ON si.id = o.shipping_instruction_id AND si.deleted_at IS NULL
     LEFT JOIN shipment_plans sp ON sp.id = si.shipment_plan_id AND sp.deleted_at IS NULL
     WHERE o.id = $1 AND o.deleted_at IS NULL AND o.status = 'SAILED'`,
    [operationId]
  );
  return r.rows[0]?.cast_off_at ?? null;
}

/**
 * Overview row of one operation for an entry screen: berthed, or sailed (view-only).
 * @returns {Promise<object|null>}
 */
export async function loadFieldQueueRow(selectedPortId, operationId, { loadOverview, loadSailed }) {
  const overview = await loadOverview(selectedPortId);
  const active = (overview?.queue || []).filter(isBerthedQueueRow).find((r) => r.operationId === operationId);
  if (active) return active;
  const castOff = await loadSailedCastOff(operationId);
  if (!castOff) return null;
  const at = new Date(castOff).getTime();
  const rows = await loadSailed(selectedPortId, { from: new Date(at), to: new Date(at + 1) });
  return rows.find((r) => r.operationId === operationId) ?? null;
}

/** `source` values the field menus send on shared sub-process writes. */
const FIELD_MENU_SOURCES = new Set(['qc', 'custom-clearance']);

/** Shared sub-process writes: lock only those sent by a field menu (body or query `source`). */
export async function assertFieldMenuSourceEditable(operationId, req) {
  const source = String(req.body?.source ?? req.query?.source ?? '').trim();
  if (FIELD_MENU_SOURCES.has(source)) await assertFieldMenuEditable(operationId);
}

/** Refuse writes from a field menu once the vessel has sailed (the Loading hub stays editable). */
export async function assertFieldMenuEditable(operationId) {
  const r = await pool.query(`SELECT status FROM operations WHERE id = $1 AND deleted_at IS NULL`, [operationId]);
  if (isSailedStatus(r.rows[0]?.status)) {
    throw Object.assign(new Error(SAILED_READ_ONLY_MESSAGE), { statusCode: 403 });
  }
}

/**
 * The live row of one sub-process for each operation, with its document count and the
 * name of the last editor. One query for the whole queue (no N+1).
 * @returns {Promise<Map<number, object>>} keyed by operation id
 */
export async function loadSubProcessRows(operationIds, { phase, key }) {
  if (operationIds.length === 0) return new Map();
  const r = await pool.query(
    `SELECT sp.operation_id, sp.status, sp.payload_json, sp.ffa_average, sp.moisture_average,
            sp.start_at, sp.end_at, sp.remark, sp.updated_at,
            NULLIF(TRIM(COALESCE(u.display_name, u.username, '')), '') AS updated_by_name,
            (SELECT COUNT(*)::int FROM operation_sub_process_documents d
              WHERE d.sub_process_id = sp.id AND d.deleted_at IS NULL) AS document_count
     FROM operation_sub_processes sp
     LEFT JOIN users u ON u.id = sp.updated_by AND u.deleted_at IS NULL
     WHERE sp.operation_id = ANY($1::bigint[])
       AND sp.phase = $2
       AND sp.sub_process_key = $3
       AND sp.deleted_at IS NULL`,
    [operationIds, phase, key]
  );
  return new Map(r.rows.map((row) => [Number(row.operation_id), row]));
}
