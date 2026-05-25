import { apiGet, apiPost, apiPut, apiDelete, getSelectedPortId, apiPostForm } from './client.js'

export function fetchShippingInstructions(params = {}) {
  const sp = new URLSearchParams()
  if (params.purpose) sp.set('purpose', params.purpose)
  if (params.status) sp.set('status', params.status)
  const q = sp.toString()
  return apiGet(`/shipping-instructions${q ? `?${q}` : ''}`)
}

export function fetchShippingInstructionCandidates(params = {}) {
  const sp = new URLSearchParams()
  if (params.from) sp.set('from', params.from)
  if (params.to) sp.set('to', params.to)
  if (params.includeIncoming != null) sp.set('include_incoming', params.includeIncoming ? '1' : '0')
  if (params.includeBerthed != null) sp.set('include_berthed', params.includeBerthed ? '1' : '0')
  const q = sp.toString()
  return apiGet(`/shipping-instructions/candidates${q ? `?${q}` : ''}`)
}

export function fetchShippingInstruction(id) {
  return apiGet(`/shipping-instructions/${id}`)
}

/** NPWP master for the current or given port (`?port_id=`); omit for selected port from session. */
export function fetchSiNpwpMaster(portId) {
  const pid = portId != null && portId !== '' ? portId : getSelectedPortId()
  const q = pid != null && pid !== '' ? `?port_id=${encodeURIComponent(pid)}` : ''
  return apiGet(`/shipping-instructions/npwp-master${q}`)
}

export function createShippingInstruction(body) {
  const payload = {
    reference_number: body.referenceNumber ?? null,
    vessel_name: body.vesselName,
    voyage_no: body.voyageNo ?? null,
    trade_term_id: body.tradeTermId ?? null,
    purpose: body.purpose ?? null,
    purpose_id: body.purposeId ?? null,
    eta: body.eta ?? null,
    eta_from: body.etaFrom ?? null,
    eta_to: body.etaTo ?? null,
    status: body.status ?? 'Draft',
    approval_id: body.approvalId ?? null,
    preferred_jetty_id: body.preferredJettyId ?? null,
    loading_port_id: body.loadingPortId ?? null,
    surveyor_id: body.surveyorId ?? null,
    agent_id: body.agentId ?? null,
    breakdown: body.breakdown ?? null,
    note: body.note ?? null,
    destination_text: body.destinationText ?? null,
    freight_terms: body.freightTerms ?? null,
    bill_of_lading_clause: body.billOfLadingClause ?? null,
    bl_split_text: body.blSplitText ?? null,
    consignee_text: body.consigneeText ?? null,
    notify_party_text: body.notifyPartyText ?? null,
    bl_indicated: body.blIndicated ?? null,
    document_date: body.documentDate ?? null,
  }
  if (body.shipmentPlanId != null && body.shipmentPlanId !== '') {
    payload.shipment_plan_id = body.shipmentPlanId
  }
  return apiPost('/shipping-instructions', payload)
}

export function deleteShippingInstruction(id) {
  return apiDelete(`/shipping-instructions/${id}`)
}

export function updateShippingInstruction(id, body) {
  return apiPut(`/shipping-instructions/${id}`, {
    reference_number: body.referenceNumber,
    vessel_name: body.vesselName,
    voyage_no: body.voyageNo,
    trade_term_id: body.tradeTermId,
    purpose: body.purpose,
    purpose_id: body.purposeId,
    eta: body.eta,
    eta_from: body.etaFrom,
    eta_to: body.etaTo,
    status: body.status,
    approval_id: body.approvalId,
    preferred_jetty_id: body.preferredJettyId,
    loading_port_id: body.loadingPortId,
    surveyor_id: body.surveyorId,
    agent_id: body.agentId,
    breakdown: body.breakdown,
    note: body.note,
    destination_text: body.destinationText,
    freight_terms: body.freightTerms,
    bill_of_lading_clause: body.billOfLadingClause,
    bl_split_text: body.blSplitText,
    consignee_text: body.consigneeText,
    notify_party_text: body.notifyPartyText,
    bl_indicated: body.blIndicated,
    document_date: body.documentDate,
  })
}

/** POST multipart: field `file` — OCR / PDF text extract for SI draft autofill (large timeout for first Tesseract run). */
export function extractShippingInstructionFromDocument(file) {
  const fd = new FormData()
  fd.append('file', file)
  return apiPostForm('/si-document-extract', fd, 180000)
}
