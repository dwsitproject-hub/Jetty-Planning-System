/**
 * Shared helpers for the Pre-Checking `sampling` sub-process.
 *
 * Used by the Loading hub sub-process routes and the QC Sampling routes so both read and
 * write the same record shape: `payload_json.records[]` plus the report summary columns.
 */
import { metricToString, toMetricNumber } from './sampling-document-extract.js';

/**
 * The quality figures the report prints in its own summary box. Only the Pre-Checking
 * sampling sub-process has them; the columns stay NULL for every other key.
 *
 * Ceilings are per field: FFA, moisture and DOBI are the extract's 0-100 metric range,
 * while iodine value needs more headroom — CPO sits near 52 but other oils run higher.
 */
export const QUALITY_SUMMARY_FIELDS = [
  { body: 'ffaAverage', column: 'ffa_average', label: 'FFA Average', max: 100 },
  { body: 'moistureAverage', column: 'moisture_average', label: 'Moisture Average', max: 100 },
  { body: 'dobi', column: 'dobi', label: 'DOBI', max: 100 },
  { body: 'iodineValue', column: 'iodine_value', label: 'Iodine Value', max: 200 },
];

/**
 * Read the quality figures out of a request body.
 *
 * `provided` drives the same omit-keeps-existing merge the other Pre-Checking columns use,
 * so a save that leaves a field out never clears it. An explicit empty string does clear it.
 *
 * @returns {Record<string, { provided: boolean, value: number|null }>}
 */
export function readQualitySummary(key, body = {}) {
  const out = {};
  for (const field of QUALITY_SUMMARY_FIELDS) {
    const raw = key === 'sampling' ? body[field.body] : undefined;
    if (raw === undefined) {
      out[field.body] = { provided: false, value: null };
      continue;
    }
    if (raw === null || String(raw).trim() === '') {
      out[field.body] = { provided: true, value: null };
      continue;
    }
    const n = toMetricNumber(raw);
    if (n == null || n < 0 || n > field.max) {
      throw Object.assign(new Error(`Invalid ${field.label}`), { statusCode: 400 });
    }
    out[field.body] = { provided: true, value: n };
  }
  return out;
}

/** Postgres returns numeric as a string ("7.620"); the form and the log want "7.62". */
export function formatQualityMetric(raw) {
  if (raw == null) return null;
  const n = toMetricNumber(raw);
  return n == null ? null : metricToString(n);
}

/** Activity-log summary of the per-palka records, or null when there are none. */
export function summarizeSamplingRecords(payload) {
  const records = Array.isArray(payload?.records) ? payload.records : [];
  if (records.length === 0) return null;
  return records
    .map((r) => {
      const palka = r?.noPalka ?? '-';
      const ffa = r?.ffa ?? '-';
      const moisture = r?.moisture ?? '-';
      return `${palka} (FFA:${ffa}, Moisture:${moisture})`;
    })
    .join('; ');
}

/**
 * Sample count and mean FFA / moisture over the per-palka records.
 * Blank or non-numeric cells are skipped per metric; a metric with no values is null.
 */
export function computeSamplingStats(payload) {
  const records = Array.isArray(payload?.records) ? payload.records : [];
  const mean = (field) => {
    const values = records.map((r) => toMetricNumber(r?.[field])).filter((n) => n != null);
    if (values.length === 0) return null;
    return metricToString(values.reduce((a, b) => a + b, 0) / values.length);
  };
  return { count: records.length, avgFfa: mean('ffa'), avgMoisture: mean('moisture') };
}

export const SAMPLING_STATUS = Object.freeze({
  NOT_STARTED: 'not_started',
  DRAFT: 'draft',
  DONE: 'done',
});

/**
 * Mirrors the Loading hub: an explicit `Done` is final; with no explicit status the hub
 * treats recorded palka rows as Done. Any other saved row is a draft.
 */
export function deriveSamplingStatus(row) {
  if (!row) return SAMPLING_STATUS.NOT_STARTED;
  const explicit = String(row.status || '').trim();
  if (explicit === 'Done') return SAMPLING_STATUS.DONE;
  const recordCount = Array.isArray(row.payload_json?.records) ? row.payload_json.records.length : 0;
  if (!explicit && recordCount > 0) return SAMPLING_STATUS.DONE;
  return SAMPLING_STATUS.DRAFT;
}

/** Queue-card summary of one `sampling` sub-process row (undefined row = not started). */
export function toSamplingSummary(row) {
  const stats = computeSamplingStats(row?.payload_json);
  return {
    status: deriveSamplingStatus(row),
    recordCount: stats.count,
    avgFfa: formatQualityMetric(row?.ffa_average) ?? stats.avgFfa,
    avgMoisture: formatQualityMetric(row?.moisture_average) ?? stats.avgMoisture,
    documentCount: Number(row?.document_count) || 0,
    updatedAt: row?.updated_at ?? null,
    updatedByName: row?.updated_by_name ?? null,
  };
}
