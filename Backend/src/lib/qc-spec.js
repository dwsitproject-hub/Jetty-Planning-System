/**
 * Pure QC spec helpers: fallback four-field template, metric parse, typed-column sync.
 * Templates in the DB are resolved by qc-spec-store.js; this module stays DB-free.
 */
import { metricToString, toMetricNumber } from './sampling-document-extract.js';

export const SCOPES = Object.freeze(['report', 'sample', 'both']);

/** Legacy body keys still accepted on save so existing QC / Loading clients keep working. */
export const CODE_ALIASES = Object.freeze({
  ffa: ['ffaAverage', 'ffa_average'],
  mi: ['moistureAverage', 'moisture_average', 'moisture'],
  moisture: ['moistureAverage', 'moisture_average'],
  dobi: ['dobi'],
  iodine: ['iodineValue', 'iodine_value'],
});

/** Typed columns kept in sync when those codes are written. */
export const TYPED_COLUMN_BY_CODE = Object.freeze({
  ffa: 'ffa_average',
  mi: 'moisture_average',
  moisture: 'moisture_average',
  dobi: 'dobi',
  iodine: 'iodine_value',
});

export const BODY_BY_COLUMN = Object.freeze({
  ffa_average: 'ffaAverage',
  moisture_average: 'moistureAverage',
  dobi: 'dobi',
  iodine_value: 'iodineValue',
});

const FALLBACK_PARAMS = [
  { code: 'ffa', labelEn: 'FFA', labelId: 'FFA', unit: '%', method: 'AOCS Ca 5a-40', kind: 'number', maxValue: 100, scope: 'both', sortOrder: 10 },
  { code: 'moisture', labelEn: 'Moisture', labelId: 'Moisture', unit: '%', method: 'AOCS Ca 2c-25', kind: 'number', maxValue: 100, scope: 'both', sortOrder: 20 },
  { code: 'dobi', labelEn: 'DOBI', labelId: 'DOBI', unit: null, method: null, kind: 'number', maxValue: 100, scope: 'report', sortOrder: 30 },
  { code: 'iodine', labelEn: 'IV', labelId: 'IV', unit: 'gI2/100g', method: 'AOCS Cd 1-25', kind: 'number', maxValue: 200, scope: 'report', sortOrder: 40 },
];

export function fallbackSpec() {
  return { templateId: null, name: null, parameters: FALLBACK_PARAMS.map((p) => ({ ...p })) };
}

export function valueCodesOf(param) {
  if (param?.kind === 'color_pair') return ['color_red', 'color_yellow'];
  return [param.code];
}

export function reportParams(spec) {
  return (spec?.parameters || []).filter((p) => p.scope === 'report' || p.scope === 'both');
}

export function sampleParams(spec) {
  return (spec?.parameters || []).filter((p) => p.scope === 'sample' || p.scope === 'both');
}

export function sampleCodes(spec) {
  return sampleParams(spec).flatMap(valueCodesOf);
}

function badRequest(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function rawForCode(item, code) {
  if (item?.metrics && item.metrics[code] !== undefined) return item.metrics[code];
  for (const alias of CODE_ALIASES[code] || []) {
    if (item?.[alias] !== undefined) return item[alias];
  }
  return undefined;
}

/** Parse one number; blank stays null. */
export function parseMetricValue(raw, label, max) {
  if (raw == null || String(raw).trim() === '') return null;
  const n = toMetricNumber(raw);
  if (n == null || n < 0 || n > max) throw badRequest(`Invalid ${label}`);
  return n;
}

/** Codes the card loader always echoes from the typed columns, even when the template uses only one of them. */
const LEGACY_METRIC_CODES = new Set(['ffa', 'moisture', 'mi', 'dobi', 'iodine']);

/**
 * Read stated report values for a spec. Unknown codes are rejected.
 * Legacy echoes (moisture beside M&I, and so on) are ignored when the template does not list them.
 * @returns {{ metricsJson: Record<string, string>, typed: Record<string, number|null> }}
 */
export function parseCardMetrics(item, spec = fallbackSpec()) {
  const params = spec.parameters || [];
  const allowed = new Set(params.flatMap(valueCodesOf));
  if (item?.metrics && typeof item.metrics === 'object') {
    for (const key of Object.keys(item.metrics)) {
      if (!allowed.has(key) && !LEGACY_METRIC_CODES.has(key)) throw badRequest(`Unknown quality field ${key}`);
    }
  }
  const metricsJson = {};
  for (const param of params) {
    for (const code of valueCodesOf(param)) {
      const raw = rawForCode(item, code);
      if (raw === undefined) continue;
      const n = parseMetricValue(raw, param.labelEn || code, param.maxValue);
      if (n != null) metricsJson[code] = metricToString(n);
    }
  }
  return { metricsJson, typed: typedColumnsFromMetrics(metricsJson) };
}

export function typedColumnsFromMetrics(metricsJson = {}) {
  const typed = { ffa_average: null, moisture_average: null, dobi: null, iodine_value: null };
  for (const [code, column] of Object.entries(TYPED_COLUMN_BY_CODE)) {
    if (metricsJson[code] != null && metricsJson[code] !== '') {
      typed[column] = toMetricNumber(metricsJson[code]);
    }
  }
  return typed;
}

/** Card DTO extras: template codes only, plus the four legacy aliases. */
export function cardMetricFields(metricsJson = {}, spec = fallbackSpec()) {
  const formatted = {};
  for (const [code, raw] of Object.entries(metricsJson || {})) {
    const n = toMetricNumber(raw);
    formatted[code] = n == null ? '' : metricToString(n);
  }
  const allowed = new Set((spec?.parameters || []).flatMap(valueCodesOf));
  const metrics = {};
  for (const code of allowed) {
    const own = formatted[code];
    const alias = code === 'mi' ? formatted.moisture : code === 'moisture' ? formatted.mi : undefined;
    const value = own != null && own !== '' ? own : alias;
    if (value != null && value !== '') metrics[code] = value;
  }
  const aliases = {
    ffaAverage: metrics.ffa ?? formatted.ffa ?? '',
    moistureAverage: metrics.mi ?? metrics.moisture ?? formatted.mi ?? formatted.moisture ?? '',
    dobi: metrics.dobi ?? formatted.dobi ?? '',
    iodineValue: metrics.iodine ?? formatted.iodine ?? '',
  };
  return { spec, metrics, ...aliases };
}
