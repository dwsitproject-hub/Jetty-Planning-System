import { apiDelete, apiGet, apiPut, apiPost, apiPostForm } from './client'

export function fetchAllocationOverview() {
  return apiGet('/allocation/overview')
}

/** Same payload as overview; requires auth + `allocation-plan` page view on the server. */
export function fetchAllocationPlanOverview() {
  return apiGet('/allocation/plan-overview')
}

export function saveArrivalUpdate(body) {
  return apiPut('/allocation/arrival', body)
}

/** Swap `shipment_plans.sequence` for two plans (plan-centric queue ↑/↓). */
export function swapShipmentPlanBerthingSequence(shipmentPlanIdA, shipmentPlanIdB, options = {}) {
  const activityLogPage = 'allocation-plan'
  const body = {
    shipment_plan_id_a: shipmentPlanIdA,
    shipment_plan_id_b: shipmentPlanIdB,
    activity_log_page: activityLogPage,
  }
  if (options.earlierPlanId != null && Number.isFinite(Number(options.earlierPlanId))) {
    body.earlier_plan_id = Number(options.earlierPlanId)
  }
  return apiPost('/allocation/shipment-plans/swap-berthing-sequence', body)
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

