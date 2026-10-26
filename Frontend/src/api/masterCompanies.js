import { apiGet, apiPost, apiPut } from './client.js'

export function fetchMasterCompanies() {
  return apiGet('/master/companies')
}

export function fetchCompanyPortMap(portId) {
  return apiGet(`/master/companies/port-map?portId=${encodeURIComponent(portId)}`)
}

export function saveCompanyPortMap(portId, companyIds) {
  return apiPut('/master/companies/port-map', { portId, companyIds })
}

export function fetchInstructionCompanyOptions() {
  return apiGet('/shipping-instructions/company-options')
}

const BASE = '/master/companies/datahub/sync'

export function fetchCompanySyncRuns({ limit = 10 } = {}) {
  return apiGet(`${BASE}/runs?limit=${limit}`)
}

export function startCompanySyncRun() {
  return apiPost(`${BASE}/runs`, {}, 120000)
}

export function fetchCompanySyncRun(runId) {
  return apiGet(`${BASE}/runs/${runId}`)
}

export function applyCompanySyncRun(runId, itemIds) {
  return apiPost(`${BASE}/runs/${runId}/apply`, { itemIds: Array.isArray(itemIds) ? itemIds : [] }, 120000)
}

export function discardCompanySyncRun(runId) {
  return apiPost(`${BASE}/runs/${runId}/discard`, {})
}

export const DATAHUB_COMPANY_REVIEW_META = {
  recordNoun: 'companies',
  newHint: 'Companies not yet in the JPS master.',
}
