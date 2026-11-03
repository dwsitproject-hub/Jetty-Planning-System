import { apiGet, apiPatch, apiPost } from './client.js'

/** List partner integration API keys (masked; never returns plaintext or hash). */
export function fetchPartnerKeys() {
  return apiGet('/integration-admin')
}

/** Create a key. Returns the row plus a one-time `plaintextKey`. */
export function createPartnerKey(partnerName) {
  return apiPost('/integration-admin', { partnerName })
}

/** Revoke (deactivate) a key by id. */
export function revokePartnerKey(id) {
  return apiPost(`/integration-admin/${id}/deactivate`)
}

export function fetchPartnerWebhooks(keyId) {
  return apiGet(`/integration-admin/${keyId}/webhooks`)
}

export function createPartnerWebhook(keyId, body) {
  return apiPost(`/integration-admin/${keyId}/webhooks`, body)
}

export function patchPartnerWebhook(keyId, endpointId, body) {
  return apiPatch(`/integration-admin/${keyId}/webhooks/${endpointId}`, body)
}

export function deactivatePartnerWebhook(keyId, endpointId) {
  return apiPost(`/integration-admin/${keyId}/webhooks/${endpointId}/deactivate`)
}

export function fetchWebhookDeliveries(keyId, endpointId, { limit, offset, status } = {}) {
  const params = new URLSearchParams()
  if (limit != null) params.set('limit', String(limit))
  if (offset != null) params.set('offset', String(offset))
  if (status) params.set('status', status)
  const q = params.toString()
  return apiGet(`/integration-admin/${keyId}/webhooks/${endpointId}/deliveries${q ? `?${q}` : ''}`)
}

export function retryWebhookDelivery(keyId, endpointId, deliveryId) {
  return apiPost(
    `/integration-admin/${keyId}/webhooks/${endpointId}/deliveries/${encodeURIComponent(deliveryId)}/retry`
  )
}
