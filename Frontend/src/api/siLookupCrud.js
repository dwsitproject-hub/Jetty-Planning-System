import { apiGet, apiPost, apiPut, apiDelete } from './client.js'

/**
 * Generic CRUD for SI master dropdown tables.
 *
 * Backend:
 * - GET    /si-lookups/:type
 * - GET    /si-lookups/:type/:id
 * - POST   /si-lookups/:type        { value }
 * - PUT    /si-lookups/:type/:id   { value }
 * - DELETE /si-lookups/:type/:id
 */
export function fetchSiLookupList(type) {
  return apiGet(`/si-lookups/${type}`)
}

export function fetchSiLookupItem(type, id) {
  return apiGet(`/si-lookups/${type}/${id}`)
}

export function createSiLookupItem(type, { value }) {
  return apiPost(`/si-lookups/${type}`, { value })
}

export function updateSiLookupItem(type, id, { value }) {
  return apiPut(`/si-lookups/${type}/${id}`, { value })
}

export function deleteSiLookupItem(type, id) {
  return apiDelete(`/si-lookups/${type}/${id}`)
}

