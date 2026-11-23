import { apiGet } from './client.js'

/**
 * Stops and delays of the selected port for a period (404 while the report switch is off).
 * @param {{ from?: string, to?: string, purpose?: 'Loading'|'Unloading'|null, jettyId?: number|null }} params ISO instants
 */
export function fetchNoFlowReport({ from, to, purpose, jettyId } = {}) {
  const sp = new URLSearchParams()
  if (from) sp.set('from', from)
  if (to) sp.set('to', to)
  if (purpose) sp.set('purpose', purpose)
  if (jettyId) sp.set('jettyId', String(jettyId))
  const q = sp.toString()
  return apiGet(`/no-flow-report${q ? `?${q}` : ''}`)
}
