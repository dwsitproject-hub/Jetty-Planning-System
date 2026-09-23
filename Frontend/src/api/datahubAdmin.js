import { apiGet, apiPost, apiPut } from './client.js'

/** DataHub credentials (admin only). The private key is never returned. */
export function fetchDataHubConfig() {
  return apiGet('/datahub-admin')
}

/** Leave privateKey empty to keep the stored one. */
export function saveDataHubConfig({ baseUrl, publicKey, privateKey, enabled } = {}) {
  const body = {
    baseUrl: baseUrl ?? null,
    publicKey: publicKey ?? null,
    enabled: enabled === true,
  }
  if (privateKey != null && String(privateKey).trim() !== '') {
    body.privateKey = String(privateKey).trim()
  }
  return apiPut('/datahub-admin', body)
}

/** Test against GET /v1/catalog/vessel using either the form values or the stored config. */
export function testDataHubConnection({ baseUrl, publicKey, privateKey } = {}) {
  const body = {}
  if (baseUrl != null && String(baseUrl).trim() !== '') body.baseUrl = String(baseUrl).trim()
  if (publicKey != null && String(publicKey).trim() !== '') body.publicKey = String(publicKey).trim()
  if (privateKey != null && String(privateKey).trim() !== '') body.privateKey = String(privateKey).trim()
  return apiPost('/datahub-admin/test', body, 30000)
}
