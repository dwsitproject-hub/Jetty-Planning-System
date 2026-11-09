import { apiDelete, apiGet, apiPatch, apiPost } from './client'
import {
  deleteSubProcessDocument,
  fetchSubProcessDocuments,
  fetchSubProcesses,
  uploadSubProcessDocuments,
  upsertSubProcess,
} from './operations'
import { mergePreCheckSubRowsToPreData } from '../utils/loadingHubProcessStagesFromApi'
import { buildSamplingPayload } from '../utils/qcSampling'

const SUB_KEY = 'sampling'
const PHASE = 'Pre-Checking'

export const EMPTY_SAMPLING = Object.freeze({
  startTime: '',
  endTime: '',
  remark: '',
  ffaAverage: '',
  moistureAverage: '',
  dobi: '',
  iodineValue: '',
  records: [],
  documents: [],
  commodities: [],
  legacyUnassigned: null,
  status: null,
  lastSavedAt: null,
})

function newRecordId() {
  return `sampling-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function fetchQcSamplingQueue() {
  return apiGet('/qc/sampling/queue').then((out) => (Array.isArray(out?.queue) ? out.queue : []))
}

/** Header row (vessel, SI, commodity, sampling status) for one berthed operation. */
export function fetchQcSamplingOperation(operationId) {
  return apiGet(`/qc/sampling/operations/${operationId}`)
}

/** Current saved sampling section, shaped like the Loading hub's draft (shared record). */
export async function loadQcSamplingSection(operationId) {
  const rows = await fetchSubProcesses(operationId, PHASE)
  const merged = mergePreCheckSubRowsToPreData(rows).sampling || {}
  const rawDocs = await fetchSubProcessDocuments(operationId, SUB_KEY, PHASE).catch(() => [])
  const docs = (Array.isArray(rawDocs) ? rawDocs : []).map((d) => ({
    id: d.id,
    name: d.name,
    url: d.url,
    mimeType: d.mimeType ?? null,
    commodityId: d.commodityId ?? null,
  }))
  const commodities = (merged.commodities || []).map((card) => ({
    ...card,
    documents: docs.filter((d) => Number(d.commodityId) === Number(card.commodityId)),
  }))
  return {
    ...EMPTY_SAMPLING,
    ...merged,
    commodities,
    records: (merged.records || []).map((r) => ({ ...r, id: r.id ?? newRecordId() })),
    documents: docs.filter((d) => d.commodityId == null),
  }
}

const recordsPath = (operationId) => `/qc/sampling/operations/${operationId}/records`
const RECORD_META = new Set(['id', 'commodityId', 'noPalka', 'ffa', 'moisture', 'remark'])
const pickRecordFields = (record = {}) => {
  const out = {
    noPalka: record.noPalka,
    ffa: record.ffa,
    moisture: record.moisture,
    remark: record.remark ?? '',
  }
  if (record.commodityId != null) out.commodityId = record.commodityId
  if (record.tankId != null && String(record.tankId).trim() !== '') out.tankId = record.tankId
  for (const [key, value] of Object.entries(record)) {
    if (RECORD_META.has(key) || value == null || value === '') continue
    out[key] = value
  }
  return out
}

/** Single-sample writes; each resolves `{ record, records, updatedAt }` with the full, current list. */
export const addQcSamplingRecord = (operationId, record) =>
  apiPost(recordsPath(operationId), pickRecordFields(record))
export const updateQcSamplingRecord = (operationId, recordId, patch) =>
  apiPatch(`${recordsPath(operationId)}/${encodeURIComponent(recordId)}`, pickRecordFields({ ...patch }))
export const removeQcSamplingRecord = (operationId, recordId, commodityId) => {
  const q = commodityId != null ? `?commodityId=${encodeURIComponent(commodityId)}` : ''
  return apiDelete(`${recordsPath(operationId)}/${encodeURIComponent(recordId)}${q}`)
}

/**
 * Save the sampling section ('draft' = In Progress, 'final' = Done), then upload any files
 * picked on this device. Resolves with the new `lastSavedAt` and the saved document list.
 * `options.includeRecords: false` keeps the samples the record endpoints already stored;
 * `options.expectedUpdatedAt` makes the API answer 409 if someone else saved in between.
 */
export async function saveQcSamplingSection(operationId, sampling, mode, options = {}) {
  const sent = await upsertSubProcess(operationId, SUB_KEY, buildSamplingPayload(sampling, mode, options))
  const pending = [
    ...(sampling.documents || []).filter((d) => d?.file),
    ...(sampling.commodities || []).flatMap((card) =>
      (card.documents || []).filter((d) => d?.file).map((d) => ({ ...d, commodityId: card.commodityId }))
    ),
  ]
  const saved = []
  const groups = new Map()
  for (const doc of pending) {
    const key = doc.commodityId != null ? String(doc.commodityId) : ''
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(doc)
  }
  for (const [key, docs] of groups) {
    const upload = await uploadSubProcessDocuments(
      operationId,
      SUB_KEY,
      PHASE,
      docs.map((d) => d.file),
      key || null
    )
    for (const item of Array.isArray(upload?.items) ? upload.items : []) {
      saved.push({
        id: item.id,
        name: item.name,
        url: item.url,
        commodityId: item.commodityId ?? (key ? Number(key) : null),
      })
    }
  }
  const kept = (docs) => (docs || []).filter((d) => !d?.file)
  const commodities = (sampling.commodities || []).map((card) => ({
    ...card,
    documents: [
      ...kept(card.documents),
      ...saved.filter((d) => Number(d.commodityId) === Number(card.commodityId)),
    ],
  }))
  return {
    lastSavedAt: sent?.updatedAt ?? null,
    documents: [...kept(sampling.documents), ...saved.filter((d) => d.commodityId == null)],
    commodities,
    legacyUnassigned: sent?.legacyUnassigned ?? sampling.legacyUnassigned ?? null,
  }
}

export function deleteQcSamplingDocument(operationId, documentId) {
  return deleteSubProcessDocument(operationId, SUB_KEY, documentId, PHASE)
}
