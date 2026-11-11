/**
 * Shared pieces for the field-menu queues (QC Sampling, Custom Clearance): the vessel header
 * every queue row carries, and one batched read of a sub-process across many operations.
 */
import { pool } from '../db.js';

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
    status: row.status,
  };
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
