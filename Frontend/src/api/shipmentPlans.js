import { apiGet, apiPost, apiPatch, apiDelete } from './client.js'

export function fetchShipmentPlans(params = {}) {
  const sp = new URLSearchParams()
  if (params.approvalStatus) sp.set('approval_status', params.approvalStatus)
  if (params.q) sp.set('q', params.q)
  if (params.purposeId != null && params.purposeId !== '') sp.set('purpose_id', String(params.purposeId))
  if (params.startDate) sp.set('start_date', params.startDate)
  if (params.endDate) sp.set('end_date', params.endDate)
  const q = sp.toString()
  return apiGet(`/shipment-plans${q ? `?${q}` : ''}`)
}

export function fetchShipmentPlan(id) {
  return apiGet(`/shipment-plans/${id}`)
}

export function createShipmentPlan(body) {
  return apiPost('/shipment-plans', {
    vessel_name: body.vesselName,
    vessel_capacity: body.vesselCapacity ?? null,
    vessel_loa_m: body.vesselLoaM ?? null,
    vessel_gross_tonnage: body.vesselGrossTonnage ?? null,
    vessel_draft: body.vesselDraft ?? null,
    jetty_id: body.jettyId ?? null,
    eta: body.eta ?? null,
    purpose_id: body.purposeId ?? null,
    voyage_no: body.voyageNo ?? null,
    agent_id: body.agentId ?? null,
  })
}

export function updateShipmentPlan(id, body) {
  return apiPatch(`/shipment-plans/${id}`, {
    vessel_name: body.vesselName,
    vessel_capacity: body.vesselCapacity,
    vessel_loa_m: body.vesselLoaM,
    vessel_gross_tonnage: body.vesselGrossTonnage,
    vessel_draft: body.vesselDraft,
    jetty_id: body.jettyId,
    eta: body.eta,
    purpose_id: body.purposeId,
    voyage_no: body.voyageNo,
    agent_id: body.agentId,
  })
}

/** Vessel information only (name/LOA/GT/draft) — allowed in any approval status. Cargo MT is synced from breakdown. */
export function updateShipmentPlanVesselInfo(id, body) {
  return apiPatch(`/shipment-plans/${id}/vessel-info`, {
    vessel_name: body.vesselName,
    vessel_loa_m: body.vesselLoaM,
    vessel_gross_tonnage: body.vesselGrossTonnage,
    vessel_draft: body.vesselDraft,
  })
}

export function submitShipmentPlan(id) {
  return apiPost(`/shipment-plans/${id}/submit`, {})
}

export function approveShipmentPlan(id, reason) {
  const r = typeof reason === 'string' ? reason.trim() : ''
  return apiPost(`/shipment-plans/${id}/approve`, { reason: r })
}

export function rejectShipmentPlan(id, rejectionReason) {
  return apiPost(`/shipment-plans/${id}/reject`, { rejection_reason: rejectionReason })
}

/** Multi-SI vessel call: record cast-off for entire plan (all child ops SAILED). */
export function departShipmentPlan(planId, castOffAtIso, clearanceDocumentUrl, vesselPhotoUrl) {
  return apiPost(`/shipment-plans/${planId}/depart`, {
    cast_off_at: castOffAtIso,
    clearance_document_url: clearanceDocumentUrl ?? null,
    vessel_photo_url: vesselPhotoUrl ?? null,
  })
}

export function deleteShipmentPlan(id) {
  return apiDelete(`/shipment-plans/${id}`)
}
