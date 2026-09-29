import { apiGet, apiPut } from './client'

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
