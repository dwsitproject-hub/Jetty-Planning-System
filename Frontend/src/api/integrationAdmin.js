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

function toQueryString(params) {
  const sp = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v != null && v !== '') sp.set(k, String(v))
  })
  const qs = sp.toString()
  return qs ? `?${qs}` : ''
}

/** Health summary per partner: API calls/errors, webhook sent/failed/pending. */
export function fetchActivitySummary({ keyId, hours } = {}) {
  return apiGet(`/integration-admin/activity/summary${toQueryString({ keyId, hours })}`)
}

/** Webhook deliveries across partners. Filters: keyId, endpointId, status, eventType, from, to, q, cursor, limit. */
export function fetchWebhookActivity(params = {}) {
  return apiGet(`/integration-admin/activity/webhook-deliveries${toQueryString(params)}`)
}

/** Inbound partner API calls. Filters: keyId, statusClass, method, route, from, to, q, cursor, limit. */
export function fetchApiRequestActivity(params = {}) {
  return apiGet(`/integration-admin/activity/api-requests${toQueryString(params)}`)
}

/** Re-queue a failed delivery by its public delivery id. */
export function retryWebhookActivity(deliveryId) {
  return apiPost(`/integration-admin/activity/webhook-deliveries/${encodeURIComponent(deliveryId)}/retry`)
}
