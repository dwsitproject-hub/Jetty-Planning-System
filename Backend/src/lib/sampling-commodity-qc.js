/**
 * Per-commodity sampling cards: lab figures, palka rows, QC decision, remark.
 * The visit (start, end, status) stays on the sampling sub-process row.
 */
import { randomUUID } from 'node:crypto';
import { loadSpecsByCommodityIds, specForCommodity } from './qc-spec-store.js';
import { getSiCommodityOptionsForOperation } from './si-commodity-options.js';
import { isLoadingSampleRef, loadOperationSampleRef, parseRecordInput, resolvePortTanks } from './sampling-records.js';
import { formatQualityMetric } from './sampling-sub-process.js';
import { cardMetricFields, fallbackSpec, parseCardMetrics, sampleCodes } from './qc-spec.js';

export const QC_DECISIONS = Object.freeze([
  'approve_in',
  'approve_out',
  'hold',
  'reject_in',
  'reject_out',
]);

const REMARK_MAX = 500;

const DECISION_LABEL = Object.freeze({
  approve_in: 'Approve (In Spec)',
  approve_out: 'Approve (Out Spec)',
  hold: 'Hold',
  reject_in: 'Reject (In Spec)',
  reject_out: 'Reject (Out Spec)',
});

function badRequest(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

export function decisionLabel(code) {
  return DECISION_LABEL[code] || null;
}

/** Where a palka write lands, and whether the parent payload should mirror it. */
export function recordWritePlan(commodityId, productCount) {
  const targeted = commodityId != null && String(commodityId).trim() !== '';
  return {
    scope: targeted ? 'commodity' : 'shared',
    mirrorParent: !targeted || Number(productCount) === 1,
  };
}

/**
 * Validate one save of the commodity cards.
 * Omitted `commodities` keeps stored rows. An explicit array replaces those commodities.
 * @param {unknown} raw
 * @param {Set<number>} allowedIds
 * @param {Map<number, object>} [specsByCommodity]
 */
export function parseCommodityCards(raw, allowedIds, specsByCommodity = new Map(), { purpose, tanksById } = {}) {
  if (raw === undefined) return { provided: false, cards: [] };
  if (!Array.isArray(raw)) throw badRequest('commodities must be an array');
  const cards = raw.map((item) => {
    const commodityId = Number(item?.commodityId);
    if (!Number.isFinite(commodityId) || commodityId <= 0 || !allowedIds.has(commodityId)) {
      throw badRequest('Commodity is not on this shipping instruction');
    }
    const decisionRaw = item?.decision;
    let decision = null;
    if (decisionRaw != null && String(decisionRaw).trim() !== '') {
      decision = String(decisionRaw).trim();
      if (!QC_DECISIONS.includes(decision)) throw badRequest('Invalid QC decision');
    }
    const remark = String(item?.remark ?? '').trim();
    if (remark.length > REMARK_MAX) throw badRequest(`Remark must be at most ${REMARK_MAX} characters`);
    const spec = specsByCommodity.get(commodityId) || fallbackSpec();
    const parsedMetrics = parseCardMetrics(item, spec);
    const records = Array.isArray(item?.records)
      ? item.records.map((record) => {
          const tankId = record?.tankId != null && String(record.tankId).trim() !== '' ? Number(record.tankId) : null;
          const tank = tankId != null && tanksById ? tanksById.get(tankId) || null : null;
          if (isLoadingSampleRef(purpose) && tankId != null && !tank) {
            throw badRequest('Tank is not on this port');
          }
          const parsed = parseRecordInput(record, {
            sampleCodes: sampleCodes(spec),
            purpose,
            tank,
          });
          return { id: record?.id ? String(record.id) : null, ...parsed };
        })
      : [];
    return {
      commodityId,
      decision,
      remark,
      metrics: parsedMetrics.typed,
      metricsJson: parsedMetrics.metricsJson,
      records,
    };
  });
  return { provided: true, cards };
}

function docOf(row) {
  return {
    id: row.id,
    name: row.original_name,
    url: `/api/v1/sub-process-documents/${row.id}/download`,
    mimeType: row.mime_type ?? null,
    commodityId: row.commodity_id != null ? Number(row.commodity_id) : null,
  };
}

/**
 * One card for a commodity. A single-commodity visit that has no card yet keeps the
 * figures, palka rows, and untagged documents already saved on the sampling visit.
 */
export function samplingCardForProduct(product, storedRow, subProcessRow, documents, productCount, spec = fallbackSpec()) {
  const fromParent = productCount === 1 && !storedRow;
  const parentRecords = Array.isArray(subProcessRow?.payload_json?.records) ? subProcessRow.payload_json.records : [];
  const records = fromParent
    ? parentRecords
    : Array.isArray(storedRow?.records_json)
      ? storedRow.records_json
      : [];
  const metric = (childColumn, parentColumn) =>
    formatQualityMetric(fromParent ? subProcessRow?.[parentColumn] : storedRow?.[childColumn]) ?? '';
  const docs = (documents || []).filter((doc) => {
    const id = doc.commodity_id == null ? null : Number(doc.commodity_id);
    if (fromParent) return id == null || id === product.commodityId;
    return id === product.commodityId;
  });
  const metricsJson = storedRow?.metrics_json && typeof storedRow.metrics_json === 'object' ? storedRow.metrics_json : {};
  const fromTyped = {
    ffa: metric('ffa_average', 'ffa_average'),
    moisture: metric('moisture_average', 'moisture_average'),
    mi: metric('moisture_average', 'moisture_average'),
    dobi: metric('dobi', 'dobi'),
    iodine: metric('iodine_value', 'iodine_value'),
  };
  const merged = { ...fromTyped, ...metricsJson };
  return {
    commodityId: product.commodityId,
    name: product.name,
    shortName: product.shortName,
    plannedQty: product.plannedQty,
    metricCode: product.metricCode,
    decision: storedRow?.decision ?? null,
    remark: storedRow?.remark ?? '',
    ...cardMetricFields(merged, spec),
    records,
    documents: docs.map(docOf),
  };
}

/**
 * Cards for the current instruction, plus earlier samples that were never tagged
 * to a commodity (multi-commodity operations saved before this split).
 */
export async function loadSamplingCommodityView(db, operationId, subProcessRow) {
  const products = await getSiCommodityOptionsForOperation(db, operationId);
  if (products.length === 0) {
    return { commodities: [], legacyUnassigned: null, productCount: 0 };
  }
  const specs = products.every((p) => p.spec)
    ? new Map()
    : await loadSpecsByCommodityIds(
        db,
        products.map((p) => p.commodityId)
      );
  const specOf = (product) => product.spec || specForCommodity(specs, product.commodityId);
  if (!subProcessRow) {
    return {
      commodities: products.map((product) =>
        samplingCardForProduct(product, null, null, [], products.length, specOf(product))
      ),
      legacyUnassigned: null,
      productCount: products.length,
    };
  }
  const stored = await db.query(
    `SELECT commodity_id, decision, remark, ffa_average, moisture_average, dobi, iodine_value, records_json, metrics_json
     FROM sampling_commodity_qc
     WHERE sub_process_id = $1 AND deleted_at IS NULL`,
    [subProcessRow.id]
  );
  const docs = await db.query(
    `SELECT id, original_name, mime_type, commodity_id
     FROM operation_sub_process_documents
     WHERE sub_process_id = $1 AND deleted_at IS NULL
     ORDER BY created_at ASC, id ASC`,
    [subProcessRow.id]
  );
  const byCommodity = new Map(stored.rows.map((row) => [Number(row.commodity_id), row]));
  const commodities = products.map((product) =>
    samplingCardForProduct(
      product,
      byCommodity.get(product.commodityId),
      subProcessRow,
      docs.rows,
      products.length,
      specOf(product)
    )
  );
  const childHasRecords = commodities.some((c) => c.records.length > 0);
  const parentRecords = Array.isArray(subProcessRow.payload_json?.records) ? subProcessRow.payload_json.records : [];
  const legacyUnassigned =
    products.length > 1 && !childHasRecords && parentRecords.length > 0
      ? {
          records: parentRecords,
          ffaAverage: formatQualityMetric(subProcessRow.ffa_average) ?? '',
          moistureAverage: formatQualityMetric(subProcessRow.moisture_average) ?? '',
          dobi: formatQualityMetric(subProcessRow.dobi) ?? '',
          iodineValue: formatQualityMetric(subProcessRow.iodine_value) ?? '',
          documents: docs.rows.filter((d) => d.commodity_id == null).map(docOf),
        }
      : null;
  return { commodities, legacyUnassigned, productCount: products.length };
}

export function summarizeCommodityDecisions(commodities) {
  const parts = (commodities || [])
    .filter((c) => c.decision)
    .map((c) => {
      const label = decisionLabel(c.decision);
      const who = c.shortName || c.name || c.commodityId;
      const note = String(c.remark || '').trim();
      return note ? `${who}: ${label} (${note})` : `${who}: ${label}`;
    });
  return parts.length ? parts.join('; ') : null;
}

/** Replace the saved cards and, for a one-commodity visit, mirror figures onto the parent row. */
export async function saveSamplingCommodities(client, { subProcessId, operationId, rawCards, actorUserId }) {
  const products = await getSiCommodityOptionsForOperation(client, operationId);
  const allowed = new Set(products.map((p) => p.commodityId));
  const specs = await loadSpecsByCommodityIds(
    client,
    products.map((p) => p.commodityId)
  );
  const { purpose, portId } = await loadOperationSampleRef(client, operationId);
  const tankIds = (Array.isArray(rawCards) ? rawCards : []).flatMap((item) =>
    (Array.isArray(item?.records) ? item.records : []).map((record) => record?.tankId)
  );
  const tanksById = await resolvePortTanks(client, tankIds, portId, { includeDeleted: true });
  const parsed = parseCommodityCards(rawCards, allowed, specs, { purpose, tanksById });
  if (!parsed.provided) return null;
  for (const card of parsed.cards) {
    const records = card.records.map((r) => ({ ...r, id: r.id || randomUUID() }));
    await client.query(
      `INSERT INTO sampling_commodity_qc (
         sub_process_id, commodity_id, decision, remark,
         ffa_average, moisture_average, dobi, iodine_value, records_json, metrics_json, updated_at
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb, clock_timestamp())
       ON CONFLICT (sub_process_id, commodity_id) WHERE deleted_at IS NULL
       DO UPDATE SET
         decision = EXCLUDED.decision,
         remark = EXCLUDED.remark,
         ffa_average = EXCLUDED.ffa_average,
         moisture_average = EXCLUDED.moisture_average,
         dobi = EXCLUDED.dobi,
         iodine_value = EXCLUDED.iodine_value,
         records_json = EXCLUDED.records_json,
         metrics_json = EXCLUDED.metrics_json,
         updated_at = clock_timestamp()`,
      [
        subProcessId,
        card.commodityId,
        card.decision,
        card.remark,
        card.metrics.ffa_average,
        card.metrics.moisture_average,
        card.metrics.dobi,
        card.metrics.iodine_value,
        JSON.stringify(records),
        JSON.stringify(card.metricsJson || {}),
      ]
    );
    card.records = records;
  }
  if (products.length === 1 && parsed.cards.length === 1) {
    const card = parsed.cards[0];
    await client.query(
      `UPDATE operation_sub_processes
       SET ffa_average = $2, moisture_average = $3, dobi = $4, iodine_value = $5,
           payload_json = jsonb_set(
             CASE WHEN jsonb_typeof(payload_json) = 'object' THEN payload_json ELSE '{}'::jsonb END,
             '{records}', $6::jsonb, true
           ),
           updated_by = COALESCE($7::bigint, updated_by)
       WHERE id = $1`,
      [
        subProcessId,
        card.metrics.ffa_average,
        card.metrics.moisture_average,
        card.metrics.dobi,
        card.metrics.iodine_value,
        JSON.stringify(card.records),
        actorUserId,
      ]
    );
  }
  const names = new Map(products.map((p) => [p.commodityId, p.shortName || p.name]));
  return summarizeCommodityDecisions(
    parsed.cards.map((c) => ({ ...c, shortName: names.get(c.commodityId), decision: c.decision, remark: c.remark }))
  );
}

export function toQcDecisionPill(row) {
  return {
    commodityId: Number(row.commodity_id),
    shortName: row.short_name || row.name || '',
    name: row.name || '',
    decision: row.decision,
    remark: row.remark || '',
  };
}

/** Decisions already chosen for this visit's sampling step, for the activity log. */
export async function loadSamplingDecisionPills(db, operationId) {
  const id = Number(operationId);
  if (!Number.isFinite(id) || id <= 0) return [];
  const r = await db.query(
    `SELECT q.commodity_id, q.decision, q.remark, sc.short_name, sc.name
     FROM sampling_commodity_qc q
     JOIN operation_sub_processes sp ON sp.id = q.sub_process_id AND sp.deleted_at IS NULL
     JOIN si_commodities sc ON sc.id = q.commodity_id
     WHERE sp.operation_id = $1
       AND sp.phase = 'Pre-Checking'
       AND sp.sub_process_key = 'sampling'
       AND q.deleted_at IS NULL
       AND q.decision IS NOT NULL
     ORDER BY q.commodity_id`,
    [id]
  );
  return r.rows.map(toQcDecisionPill);
}

export async function loadDecisionSummary(db, subProcessId) {
  if (!subProcessId) return null;
  const r = await db.query(
    `SELECT q.decision, q.remark, sc.short_name, sc.name
     FROM sampling_commodity_qc q
     JOIN si_commodities sc ON sc.id = q.commodity_id
     WHERE q.sub_process_id = $1 AND q.deleted_at IS NULL AND q.decision IS NOT NULL
     ORDER BY q.commodity_id`,
    [subProcessId]
  );
  return summarizeCommodityDecisions(
    r.rows.map((row) => ({
      decision: row.decision,
      remark: row.remark,
      shortName: row.short_name || row.name,
    }))
  );
}

/** Decisions for the At Berth list, keyed by operation id. */
export async function loadDecisionsByOperation(db, operationIds) {
  const ids = [...new Set(operationIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
  const map = new Map();
  if (ids.length === 0) return map;
  const r = await db.query(
    `SELECT sp.operation_id, q.commodity_id, q.decision, q.remark
     FROM sampling_commodity_qc q
     JOIN operation_sub_processes sp ON sp.id = q.sub_process_id AND sp.deleted_at IS NULL
     WHERE sp.operation_id = ANY($1::bigint[])
       AND sp.phase = 'Pre-Checking'
       AND sp.sub_process_key = 'sampling'
       AND q.deleted_at IS NULL
       AND q.decision IS NOT NULL`,
    [ids]
  );
  for (const row of r.rows) {
    const opId = Number(row.operation_id);
    if (!map.has(opId)) map.set(opId, []);
    map.get(opId).push({
      commodityId: Number(row.commodity_id),
      decision: row.decision,
      remark: row.remark || '',
    });
  }
  return map;
}
