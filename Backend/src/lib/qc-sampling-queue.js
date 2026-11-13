/**
 * Queue for the mobile QC Sampling menu: berthed operations plus the state of their
 * Pre-Checking `sampling` sub-process, loaded with one extra query (no N+1).
 */
import { pool } from '../db.js';
import { isBerthedQueueRow } from './berthed-queue.js';
import { loadSubProcessRows, queueHeader } from './field-queue.js';
import { loadSpecsByCommodityIds, specForCommodity } from './qc-spec-store.js';
import { previewMetricsFromCards, toSamplingSummary } from './sampling-sub-process.js';

async function loadCommodityQc(operationIds) {
  if (operationIds.length === 0) return new Map();
  const r = await pool.query(
    `SELECT sp.operation_id, qc.metrics_json, qc.ffa_average, qc.moisture_average,
            qc.dobi, qc.iodine_value, qc.records_json
     FROM sampling_commodity_qc qc
     JOIN operation_sub_processes sp ON sp.id = qc.sub_process_id
     WHERE sp.operation_id = ANY($1::bigint[])
       AND sp.phase = 'Pre-Checking'
       AND sp.sub_process_key = 'sampling'
       AND sp.deleted_at IS NULL
       AND qc.deleted_at IS NULL`,
    [operationIds]
  );
  const byOp = new Map();
  for (const row of r.rows) {
    const id = Number(row.operation_id);
    if (!byOp.has(id)) byOp.set(id, []);
    byOp.get(id).push(row);
  }
  return byOp;
}

function queueCommodities(row, specs = new Map()) {
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
      spec: specForCommodity(specs, product.commodityId),
    };
  });
}

function toQueueRow(row, samplingRow, cards = [], specs = new Map()) {
  const recordCount = cards.reduce(
    (n, card) => n + (Array.isArray(card.records_json) ? card.records_json.length : 0),
    0
  );
  return {
    ...queueHeader(row),
    sampling: toSamplingSummary(samplingRow, {
      recordCount,
      previewMetrics: previewMetricsFromCards(cards),
    }),
    commodities: queueCommodities(row, specs),
  };
}

function commodityIdsOf(row) {
  const ids = [];
  for (const summary of row.cargoBreakdownSummary || []) {
    for (const product of summary.products || []) {
      if (product.commodityId != null) ids.push(product.commodityId);
    }
  }
  return ids;
}

/**
 * @param {number} selectedPortId
 * @param {() => Promise<{ queue: object[] }>} loadOverview allocation overview loader
 */
export async function buildQcSamplingQueue(selectedPortId, loadOverview) {
  const overview = await loadOverview(selectedPortId);
  const rows = (Array.isArray(overview?.queue) ? overview.queue : []).filter(isBerthedQueueRow);
  const operationIds = rows.map((r) => r.operationId);
  const [samplingByOperation, cardsByOperation, specs] = await Promise.all([
    loadSubProcessRows(operationIds, { phase: 'Pre-Checking', key: 'sampling' }),
    loadCommodityQc(operationIds),
    loadSpecsByCommodityIds(pool, rows.flatMap(commodityIdsOf)),
  ]);
  return rows.map((r) =>
    toQueueRow(r, samplingByOperation.get(r.operationId), cardsByOperation.get(r.operationId) || [], specs)
  );
}
