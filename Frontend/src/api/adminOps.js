import { apiGet, apiPost, apiPut } from './client'

/** @returns {Promise<{ checkedAt: string, overall: string, checks: Array<object>, emailAlertsEnabled?: boolean, emailAlertsActive?: boolean, alertEmail?: string, smtpConfigured?: boolean }>} */
export function fetchAdminOpsStatus() {
  return apiGet('/admin-ops/status')
}

/** @returns {Promise<{ emailAlertsEnabled: boolean, alertEmail: string, emailAlertsActive: boolean, smtpConfigured: boolean, recipients?: Array<{ checkId: string, portId: number | null, portName?: string, title: string, email: string }> }>} */
export function fetchAdminOpsSettings() {
  return apiGet('/admin-ops/settings')
}

/**
 * @param {{
 *   emailAlertsEnabled?: boolean,
 *   alertEmail?: string,
 *   recipients?: Array<{ checkId: string, portId?: number | null, email?: string }>,
 * }} body
 */
export function updateAdminOpsSettings(body) {
  return apiPut('/admin-ops/settings', body)
}

const gapsPath = (operationId) => `/admin-ops/atg-cargo-gaps/${operationId}`

/**
 * Preview, simulate and resync run as background jobs: each start call answers at once with
 * { jobId }, and fetchAtgCargoGapJob reports progress and the final result.
 */
export function startAtgCargoGapPreview(operationId, gapKeys) {
  return apiPost(`${gapsPath(operationId)}/resync`, { dryRun: true, gapKeys })
}

export function startAtgCargoGapResync(operationId, gapKeys) {
  return apiPost(`${gapsPath(operationId)}/resync`, { confirm: true, gapKeys })
}

/** Runs the real resync in a rolled-back transaction; saves nothing. */
export function startAtgCargoGapSimulation(operationId, gapKeys) {
  return apiPost(`${gapsPath(operationId)}/simulate`, { gapKeys })
}

/** Recover one ATG source's readings for a time range; preview (dryRun) and apply (confirm) are jobs too. */
export function startAtgSourceRecovery(body) {
  return apiPost('/admin-ops/atg-source-recovery', body)
}

export function fetchAtgCargoGapJob(jobId) {
  return apiGet(`/admin-ops/atg-cargo-gaps/jobs/${jobId}`)
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
