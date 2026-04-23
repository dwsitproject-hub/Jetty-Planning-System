import { apiGet, apiPost, apiPut, apiDelete } from './client.js'

/**
 * Generic CRUD for SI master dropdown tables.
 *
 * Backend:
 * - GET    /si-lookups/:type
 * - GET    /si-lookups/:type/:id
 * - POST   /si-lookups/:type        { value, rate?, rateMetric? }  (commodities only — KLPH | MTPH | MTPD)
 * - PUT    /si-lookups/:type/:id   { value, rate?, rateMetric?, clearStandardRate? }
 * - DELETE /si-lookups/:type/:id
 */
export function fetchSiLookupList(type) {
  return apiGet(`/si-lookups/${type}`)
}

export function fetchSiLookupItem(type, id) {
  return apiGet(`/si-lookups/${type}/${id}`)
}

export function createSiLookupItem(type, body = {}) {
  return apiPost(`/si-lookups/${type}`, body)
}

export function updateSiLookupItem(type, id, body) {
  return apiPut(`/si-lookups/${type}/${id}`, body)
}

export function deleteSiLookupItem(type, id) {
  return apiDelete(`/si-lookups/${type}/${id}`)
}
