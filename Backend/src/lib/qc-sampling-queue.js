/**
 * Queue for the mobile QC Sampling menu: berthed operations plus the state of their
 * Pre-Checking `sampling` sub-process, loaded with one extra query (no N+1).
 */
import { pool } from '../db.js';
import { isBerthedQueueRow } from './berthed-queue.js';
import { toSamplingSummary } from './sampling-sub-process.js';

async function loadSamplingRows(operationIds) {
  if (operationIds.length === 0) return new Map();
  const r = await pool.query(
    `SELECT sp.operation_id, sp.status, sp.payload_json, sp.ffa_average, sp.moisture_average, sp.updated_at,
            NULLIF(TRIM(COALESCE(u.display_name, u.username, '')), '') AS updated_by_name,
            (SELECT COUNT(*)::int FROM operation_sub_process_documents d
              WHERE d.sub_process_id = sp.id AND d.deleted_at IS NULL) AS document_count
     FROM operation_sub_processes sp
     LEFT JOIN users u ON u.id = sp.updated_by AND u.deleted_at IS NULL
     WHERE sp.operation_id = ANY($1::bigint[])
       AND sp.phase = 'Pre-Checking'
       AND sp.sub_process_key = 'sampling'
       AND sp.deleted_at IS NULL`,
    [operationIds]
  );
  return new Map(r.rows.map((row) => [Number(row.operation_id), row]));
}

function queueCommodities(row) {
  const products = [];
  const seen = new Set();
  for (const summary of row.cargoBreakdownSummary || []) {
    for (const product of summary.products || []) {
      if (product.commodityId == null || seen.has(product.commodityId)) continue;
      seen.add(product.commodityId);
      products.push(product);
    }
  }
  const decisions = new Map((row.qcDecisions || []).map((d) => [d.commodityId, d]));
  return products.map((product) => {
    const decision = decisions.get(product.commodityId);
    return {
      commodityId: product.commodityId,
      shortName: product.shortName,
      name: product.name,
      decision: decision?.decision ?? null,
      remark: decision?.remark ?? '',
    };
  });
}

function toQueueRow(row, samplingRow) {
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
    sampling: toSamplingSummary(samplingRow),
    commodities: queueCommodities(row),
  };
}

/**
 * @param {number} selectedPortId
 * @param {() => Promise<{ queue: object[] }>} loadOverview allocation overview loader
 */
export async function buildQcSamplingQueue(selectedPortId, loadOverview) {
  const overview = await loadOverview(selectedPortId);
  const rows = (Array.isArray(overview?.queue) ? overview.queue : []).filter(isBerthedQueueRow);
  const samplingByOperation = await loadSamplingRows(rows.map((r) => r.operationId));
  return rows.map((r) => toQueueRow(r, samplingByOperation.get(r.operationId)));
}
