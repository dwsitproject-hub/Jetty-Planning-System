import { apiGet } from './client'
import { deleteSubProcessDocument, fetchSubProcessDocuments, uploadSubProcessDocuments, upsertSubProcess } from './operations'
import { isoOrDatetimeToLocal } from '../utils/loadingHubProcessStagesFromApi'
import { CLEARANCE_KEY, CLEARANCE_PHASE, EMPTY_CLEARANCE, buildClearancePayload } from '../utils/customClearance'

export function fetchCustomClearanceQueue() {
  return apiGet('/custom-clearance/queue').then((out) => (Array.isArray(out?.queue) ? out.queue : []))
}

/** Header row (vessel, SI, commodity) plus the current Custom Clearance summary. */
export function fetchCustomClearanceOperation(operationId) {
  return apiGet(`/custom-clearance/operations/${operationId}`)
}

function toDoc(d) {
  return { id: d.id, name: d.name, url: d.url, mimeType: d.mimeType ?? null }
}

/** Saved step shaped for the form: `datetime-local` times in the schedule time zone. */
export async function loadCustomClearance(operationId, header) {
  const docs = await fetchSubProcessDocuments(operationId, CLEARANCE_KEY, CLEARANCE_PHASE).catch(() => [])
  const summary = header?.clearance || {}
  return {
    ...EMPTY_CLEARANCE,
    startTime: isoOrDatetimeToLocal(summary.startAt) || '',
    endTime: isoOrDatetimeToLocal(summary.endAt) || '',
    remark: summary.remark || '',
    status: summary.status === 'done' ? 'Done' : summary.status === 'draft' ? 'In Progress' : null,
    lastSavedAt: summary.updatedAt ?? null,
    documents: (Array.isArray(docs) ? docs : []).map(toDoc),
  }
}

/**
 * Save the step ('draft' = In Progress, 'final' = Done), then upload files picked on this device.
 * `expectedUpdatedAt` makes the API answer 409 when someone else saved in between.
 */
export async function saveCustomClearance(operationId, form, mode, { expectedUpdatedAt } = {}) {
  const sent = await upsertSubProcess(operationId, CLEARANCE_KEY, buildClearancePayload(form, mode, { expectedUpdatedAt }))
  const pending = (form.documents || []).filter((d) => d?.file)
  let uploaded = []
  if (pending.length > 0) {
    const out = await uploadSubProcessDocuments(
      operationId,
      CLEARANCE_KEY,
      CLEARANCE_PHASE,
      pending.map((d) => d.file)
    )
    uploaded = (Array.isArray(out?.items) ? out.items : []).map(toDoc)
  }
  return {
    lastSavedAt: sent?.updatedAt ?? null,
    documents: [...(form.documents || []).filter((d) => !d?.file), ...uploaded],
  }
}

export function deleteCustomClearanceDocument(operationId, documentId) {
  return deleteSubProcessDocument(operationId, CLEARANCE_KEY, documentId, CLEARANCE_PHASE)
}
