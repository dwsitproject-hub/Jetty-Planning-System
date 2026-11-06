import { apiGet, apiPost, apiPut } from './client'

const RESYNC_TIMEOUT_MS = 180000

/** @returns {Promise<{ checkedAt: string, overall: string, checks: Array<object>, emailAlertsEnabled?: boolean, emailAlertsActive?: boolean, alertEmail?: string, smtpConfigured?: boolean }>} */
export function fetchAdminOpsStatus() {
  return apiGet('/admin-ops/status')
}

/** @returns {Promise<{ emailAlertsEnabled: boolean, alertEmail: string, emailAlertsActive: boolean, smtpConfigured: boolean }>} */
export function fetchAdminOpsSettings() {
  return apiGet('/admin-ops/settings')
}

/** @param {{ emailAlertsEnabled: boolean }} body */
export function updateAdminOpsSettings(body) {
  return apiPut('/admin-ops/settings', body)
}

/** @param {number|string} operationId @param {{ confirm?: boolean, dryRun?: boolean, gapKeys?: string[], acknowledgedAt?: string }} body */
export function postAtgCargoGapResync(operationId, body) {
  return apiPost(`/admin-ops/atg-cargo-gaps/${operationId}/resync`, body, RESYNC_TIMEOUT_MS)
}
