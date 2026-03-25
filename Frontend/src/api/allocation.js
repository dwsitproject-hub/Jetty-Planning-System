import { apiDelete, apiGet, apiPut, apiPostForm } from './client'

export function fetchAllocationOverview() {
  return apiGet('/allocation/overview')
}

export function saveArrivalUpdate(body) {
  return apiPut('/allocation/arrival', body)
}

export async function uploadOperationDocuments(operationId, kind, files) {
  const form = new FormData()
  for (const f of Array.from(files || [])) {
    form.append('files', f)
  }
  return apiPostForm(
    `/operation-documents/operations/${encodeURIComponent(String(operationId))}/${encodeURIComponent(String(kind))}`,
    form,
    60000
  )
}

export function deleteOperationDocument(id) {
  return apiDelete(`/operation-documents/${id}`)
}

export function fetchOperationDocuments(operationId, kind) {
  return apiGet(`/operation-documents/operations/${encodeURIComponent(String(operationId))}/${encodeURIComponent(String(kind))}`)
}

