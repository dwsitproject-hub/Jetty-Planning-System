import { samplingPalkaKey } from './samplingExtractMerge.js'
import { MAX_SAMPLING_PALKA_FIELD_CHARS } from '../constants/inputLimits.js'

const METRIC_MAX = 100

/** Parse a typed metric; accepts a decimal comma (Indonesian locale) and a trailing %. */
export function parseMetric(raw) {
  const s = String(raw ?? '').trim().replace('%', '').replace(',', '.')
  if (!/^\d{1,3}(\.\d{1,4})?$/.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** Store metrics with a dot decimal so the Loading hub and API read the same string. */
export function normalizeMetric(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return ''
  const n = parseMetric(s)
  return n == null ? s : s.replace('%', '').replace(',', '.')
}

function metricError(raw) {
  if (String(raw ?? '').trim() === '') return null
  const n = parseMetric(raw)
  if (n == null) return 'invalid'
  return n < 0 || n > METRIC_MAX ? 'range' : null
}

/**
 * @returns {{ errors: Record<string,string>, duplicate: boolean, ok: boolean }}
 * `duplicate` is a warning only: palka labels are free text, so a repeat is allowed.
 */
export function validateSample(form, records, editingId = null) {
  const errors = {}
  const noPalka = String(form?.noPalka ?? '').trim()
  if (!noPalka) errors.noPalka = 'palkaRequired'
  const ffaError = metricError(form?.ffa)
  const moistureError = metricError(form?.moisture)
  if (ffaError) errors.ffa = ffaError
  if (moistureError) errors.moisture = moistureError
  const hasValue = [form?.ffa, form?.moisture].some((v) => String(v ?? '').trim() !== '')
  if (!hasValue) errors.metrics = 'metricRequired'

  const key = samplingPalkaKey(noPalka)
  const duplicate = Boolean(
    key && (records || []).some((r) => r.id !== editingId && samplingPalkaKey(r.noPalka) === key)
  )
  return { errors, duplicate, ok: Object.keys(errors).length === 0 }
}

/** Build a stored record from the form (trimmed, dot-decimal metrics). */
export function buildSampleRecord(form, id) {
  return {
    id,
    noPalka: String(form.noPalka).trim().slice(0, MAX_SAMPLING_PALKA_FIELD_CHARS),
    ffa: normalizeMetric(form.ffa),
    moisture: normalizeMetric(form.moisture),
  }
}

/** Next palka label after the last record: "3" -> "4", "2P" -> "3P". Empty when not numeric. */
export function suggestNextPalka(records) {
  const last = [...(records || [])].reverse().find((r) => String(r?.noPalka ?? '').trim())
  if (!last) return ''
  const m = String(last.noPalka).trim().match(/^(\D*)(\d+)(\D*)$/)
  if (!m) return ''
  return `${m[1]}${Number(m[2]) + 1}${m[3]}`.slice(0, MAX_SAMPLING_PALKA_FIELD_CHARS)
}

function mean(records, field) {
  const values = (records || []).map((r) => parseMetric(r?.[field])).filter((n) => n != null)
  if (values.length === 0) return null
  return (values.reduce((a, b) => a + b, 0) / values.length).toFixed(2)
}

/** Live averages over the recorded palka rows (2 dp, null when no values). */
export function computeAverages(records) {
  return { avgFfa: mean(records, 'ffa'), avgMoisture: mean(records, 'moisture') }
}

/** True when two sample lists differ in palka or readings (ids are ignored: local ones are temporary). */
export function recordsDiffer(a, b) {
  const sig = (list) => (list || []).map((r) => [r.noPalka, r.ffa, r.moisture].join('|')).join(';')
  return sig(a) !== sig(b)
}

/**
 * Payload for `upsertSubProcess`: 'draft' saves as In Progress, 'final' as Done.
 * Samples already written through the record endpoints are left out (`includeRecords: false`)
 * so this save cannot overwrite a sample another editor added; `expectedUpdatedAt` makes the
 * API reject the save with 409 when the record changed since it was loaded.
 */
export function buildSamplingPayload(sampling, mode, { includeRecords = true, expectedUpdatedAt } = {}) {
  const startTime = sampling?.startTime || null
  const endTime = sampling?.endTime || null
  return {
    phase: 'Pre-Checking',
    status: mode === 'draft' ? 'In Progress' : 'Done',
    occurredAt: startTime,
    startAt: startTime,
    endAt: endTime,
    remark: sampling?.remark || '',
    // Typed columns on the sub-process row, so top-level rather than inside payload.
    ffaAverage: normalizeMetric(sampling?.ffaAverage),
    moistureAverage: normalizeMetric(sampling?.moistureAverage),
    dobi: normalizeMetric(sampling?.dobi),
    iodineValue: normalizeMetric(sampling?.iodineValue),
    ...(includeRecords ? { payload: { records: sampling?.records || [] } } : {}),
    source: 'qc',
    ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
  }
}

/** Metric fields in the report summary that must stay inside their caps before saving. */
export function validateSummaryFields(sampling) {
  const errors = {}
  for (const [field, max] of [['ffaAverage', 100], ['moistureAverage', 100], ['dobi', 100], ['iodineValue', 200]]) {
    const raw = sampling?.[field]
    if (String(raw ?? '').trim() === '') continue
    const n = parseMetric(raw)
    if (n == null) errors[field] = 'invalid'
    else if (n > max) errors[field] = 'range'
  }
  return errors
}
