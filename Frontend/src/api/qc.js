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
  const docs = await fetchSubProcessDocuments(operationId, SUB_KEY, PHASE).catch(() => [])
  return {
    ...EMPTY_SAMPLING,
    ...merged,
    records: (merged.records || []).map((r) => ({ ...r, id: r.id ?? newRecordId() })),
    documents: (Array.isArray(docs) ? docs : []).map((d) => ({
      id: d.id,
      name: d.name,
      url: d.url,
      mimeType: d.mimeType ?? null,
    })),
  }
}

const recordsPath = (operationId) => `/qc/sampling/operations/${operationId}/records`
const pickRecordFields = ({ noPalka, ffa, moisture }) => ({ noPalka, ffa, moisture })

/** Single-sample writes; each resolves `{ record, records, updatedAt }` with the full, current list. */
export const addQcSamplingRecord = (operationId, record) =>
  apiPost(recordsPath(operationId), pickRecordFields(record))
export const updateQcSamplingRecord = (operationId, recordId, patch) =>
  apiPatch(`${recordsPath(operationId)}/${encodeURIComponent(recordId)}`, pickRecordFields({ ...patch }))
export const removeQcSamplingRecord = (operationId, recordId) =>
  apiDelete(`${recordsPath(operationId)}/${encodeURIComponent(recordId)}`)

/**
 * Save the sampling section ('draft' = In Progress, 'final' = Done), then upload any files
 * picked on this device. Resolves with the new `lastSavedAt` and the saved document list.
 * `options.includeRecords: false` keeps the samples the record endpoints already stored;
 * `options.expectedUpdatedAt` makes the API answer 409 if someone else saved in between.
 */
export async function saveQcSamplingSection(operationId, sampling, mode, options = {}) {
  const sent = await upsertSubProcess(operationId, SUB_KEY, buildSamplingPayload(sampling, mode, options))
  const pending = (sampling.documents || []).filter((d) => d?.file)
  let documents = sampling.documents || []
  if (pending.length > 0) {
    const upload = await uploadSubProcessDocuments(
      operationId,
      SUB_KEY,
      PHASE,
      pending.map((d) => d.file)
    )
    const saved = Array.isArray(upload?.items)
      ? upload.items.map((x) => ({ id: x.id, name: x.name, url: x.url }))
      : []
    documents = [...documents.filter((d) => !d?.file), ...saved]
  }
  return { lastSavedAt: sent?.updatedAt ?? null, documents }
}

export function deleteQcSamplingDocument(operationId, documentId) {
  return deleteSubProcessDocument(operationId, SUB_KEY, documentId, PHASE)
}
