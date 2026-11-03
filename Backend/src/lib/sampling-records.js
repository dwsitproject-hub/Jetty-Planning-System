/**
 * Pure per-palka record operations for the `sampling` sub-process payload.
 * The store (`sampling-records-store.js`) applies these under a row lock so two editors
 * (QC menu and Loading hub) never overwrite each other's samples.
 */
import { metricToString, toMetricNumber } from './sampling-document-extract.js';

const MAX_PALKA_CHARS = 20;
const METRIC_MAX = 100;

function badRequest(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function cleanMetric(raw, label) {
  if (raw == null || String(raw).trim() === '') return '';
  const n = toMetricNumber(raw);
  if (n == null || n < 0 || n > METRIC_MAX) throw badRequest(`Invalid ${label}`);
  return metricToString(n);
}

/**
 * Validate a record body. `partial` (PATCH) only checks fields that were sent.
 * @returns {{ noPalka?: string, ffa?: string, moisture?: string }}
 */
export function parseRecordInput(body = {}, { partial = false } = {}) {
  const out = {};
  if (!partial || body.noPalka !== undefined) {
    const noPalka = String(body.noPalka ?? '').trim();
    if (!noPalka) throw badRequest('noPalka is required');
    if (noPalka.length > MAX_PALKA_CHARS) throw badRequest(`noPalka must be at most ${MAX_PALKA_CHARS} characters`);
    out.noPalka = noPalka;
  }
  if (!partial || body.ffa !== undefined) out.ffa = cleanMetric(body.ffa, 'FFA');
  if (!partial || body.moisture !== undefined) out.moisture = cleanMetric(body.moisture, 'Moisture');
  if (!partial && !out.ffa && !out.moisture) throw badRequest('Enter FFA or Moisture');
  return out;
}

function notFound() {
  return Object.assign(new Error('Sample not found'), { statusCode: 404 });
}

export function addRecord(records, input, id) {
  const record = { id, ...input };
  return { records: [...records, record], record };
}

export function updateRecord(records, id, patch) {
  let record = null;
  const next = records.map((r) => {
    if (r.id !== id) return r;
    record = { ...r, ...patch };
    return record;
  });
  if (!record) throw notFound();
  return { records: next, record };
}

export function removeRecord(records, id) {
  const record = records.find((r) => r.id === id);
  if (!record) throw notFound();
  return { records: records.filter((r) => r.id !== id), record };
}
