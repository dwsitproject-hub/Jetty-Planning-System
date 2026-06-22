import { apiGet, apiPost } from './client.js'

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
