import { apiGet } from './client.js'

/** GET /si-lookups — all SI form dropdowns (DB-backed) */
export function fetchSiLookups() {
  return apiGet('/si-lookups')
}
