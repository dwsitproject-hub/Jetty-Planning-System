import { apiPostForm, apiPost, apiDelete } from './client.js'

const API_BASE = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api/v1').replace(/\/$/, '')

/**
 * Upload SI source document, persist to storage, and run heuristic extract.
 * @param {File} file
 * @param {{ shipmentPlanId?: number|string, shippingInstructionId?: number|string, draftKey?: string }} opts
 */
export function uploadSiDocumentAndExtract(file, opts = {}) {
  const fd = new FormData()
  fd.append('file', file)
  if (opts.shipmentPlanId != null && opts.shipmentPlanId !== '') {
    fd.append('shipment_plan_id', String(opts.shipmentPlanId))
  }
  if (opts.shippingInstructionId != null && opts.shippingInstructionId !== '') {
    fd.append('shipping_instruction_id', String(opts.shippingInstructionId))
  }
  if (opts.draftKey) fd.append('draft_key', opts.draftKey)
  return apiPostForm('/si-documents/extract', fd, 180000)
}

export function attachDraftSiDocuments(body) {
  return apiPost('/si-documents/attach-draft', {
    draft_key: body.draftKey,
    shipment_plan_id: body.shipmentPlanId,
    shipping_instruction_id: body.shippingInstructionId ?? null,
  })
}

export function deleteSiDocument(id) {
  return apiDelete(`/si-documents/${id}`)
}

export function siDocumentDownloadUrl(documentId) {
  const base = API_BASE
  return `${base}/si-documents/${documentId}/download`
}

export function siDocumentViewUrl(documentId) {
  const base = API_BASE
  return `${base}/si-documents/${documentId}/view`
}
