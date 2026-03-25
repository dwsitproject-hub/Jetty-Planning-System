import { apiGet, apiPost, apiPut } from './client.js'

export function fetchShippingInstructions(params = {}) {
  const sp = new URLSearchParams()
  if (params.purpose) sp.set('purpose', params.purpose)
  if (params.status) sp.set('status', params.status)
  const q = sp.toString()
  return apiGet(`/shipping-instructions${q ? `?${q}` : ''}`)
}

export function fetchShippingInstruction(id) {
  return apiGet(`/shipping-instructions/${id}`)
}

export function createShippingInstruction(body) {
  return apiPost('/shipping-instructions', {
    reference_number: body.referenceNumber ?? null,
    vessel_name: body.vesselName,
    trade_term_id: body.tradeTermId ?? null,
    purpose: body.purpose ?? null,
    purpose_id: body.purposeId ?? null,
    eta: body.eta ?? null,
    eta_from: body.etaFrom ?? null,
    eta_to: body.etaTo ?? null,
    status: body.status ?? 'Draft',
    approval_id: body.approvalId ?? null,
    preferred_jetty_id: body.preferredJettyId ?? null,
    shipper_id: body.shipperId ?? null,
    loading_port_id: body.loadingPortId ?? null,
    surveyor_id: body.surveyorId ?? null,
    agent_id: body.agentId ?? null,
    breakdown: body.breakdown ?? null,
    note: body.note ?? null,
  })
}

export function updateShippingInstruction(id, body) {
  return apiPut(`/shipping-instructions/${id}`, {
    reference_number: body.referenceNumber,
    vessel_name: body.vesselName,
    trade_term_id: body.tradeTermId,
    purpose: body.purpose,
    purpose_id: body.purposeId,
    eta: body.eta,
    eta_from: body.etaFrom,
    eta_to: body.etaTo,
    status: body.status,
    approval_id: body.approvalId,
    preferred_jetty_id: body.preferredJettyId,
    shipper_id: body.shipperId,
    loading_port_id: body.loadingPortId,
    surveyor_id: body.surveyorId,
    agent_id: body.agentId,
    breakdown: body.breakdown,
    note: body.note,
  })
}
