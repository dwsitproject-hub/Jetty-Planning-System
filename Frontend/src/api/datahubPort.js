import { apiGet, apiPost } from './client.js'

const BASE = '/ports/datahub/sync'

export function fetchPortSyncRuns({ limit = 10 } = {}) {
  return apiGet(`${BASE}/runs?limit=${limit}`)
}

export function startPortSyncRun() {
  return apiPost(`${BASE}/runs`, {}, 120000)
}

export function fetchPortSyncRun(runId) {
  return apiGet(`${BASE}/runs/${runId}`)
}

export function applyPortSyncRun(runId, itemIds) {
  return apiPost(
    `${BASE}/runs/${runId}/apply`,
    { itemIds: Array.isArray(itemIds) ? itemIds : [] },
    120000
  )
}

export function discardPortSyncRun(runId) {
  return apiPost(`${BASE}/runs/${runId}/discard`, {})
}

export const DATAHUB_PORT_REVIEW_META = {
  recordNoun: 'ports',
  newHint: 'Ports not yet in the JPS master.',
}
