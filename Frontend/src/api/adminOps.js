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

const gapsPath = (operationId) => `/admin-ops/atg-cargo-gaps/${operationId}`

/** Queries the Tankvision archive for the selected gaps without writing anything. */
export function previewAtgCargoGapResync(operationId, gapKeys) {
  return apiPost(`${gapsPath(operationId)}/resync`, { dryRun: true, gapKeys }, RESYNC_TIMEOUT_MS)
}

export function runAtgCargoGapResync(operationId, gapKeys) {
  return apiPost(`${gapsPath(operationId)}/resync`, { confirm: true, gapKeys }, RESYNC_TIMEOUT_MS)
}

export function acknowledgeAtgCargoGaps(operationId, gapKeys, reason) {
  return apiPost(`${gapsPath(operationId)}/acknowledge`, { gapKeys, reason })
}

export function reopenAtgCargoGaps(operationId, gapKeys) {
  return apiPost(`${gapsPath(operationId)}/reopen`, { gapKeys })
}

export function fetchAtgCargoGapHistory(operationId) {
  return apiGet(`${gapsPath(operationId)}/history`)
}
