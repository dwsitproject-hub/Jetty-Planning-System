/**
 * Pure helpers for Admin Operations unhealthy email alerts (unit-testable without DB).
 */
import { getPublicAppBaseUrl } from './notifications.js';

function isEmailEnabledInEnv(env) {
  const raw = env.NOTIFICATION_EMAIL_ENABLED;
  if (raw == null || String(raw).trim() === '') return true;
  return !['0', 'false', 'no', 'off'].includes(String(raw).trim().toLowerCase());
}

/**
 * @param {string | null | undefined} previousStatus
 * @param {string} currentStatus
 * @returns {boolean}
 */
export function isNewlyUnhealthy(previousStatus, currentStatus) {
  if (currentStatus !== 'unhealthy') return false;
  if (previousStatus == null || previousStatus === '') return false;
  if (previousStatus === 'unhealthy') return false;
  return true;
}

/**
 * @param {{ emailAlertsEnabled?: boolean }} settings
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ ok: boolean, reason?: string }}
 */
export function canSendAdminOpsAlerts(settings, env = process.env) {
  if (!settings?.emailAlertsEnabled) return { ok: false, reason: 'disabled' };
  if (!isEmailEnabledInEnv(env)) return { ok: false, reason: 'email_globally_disabled' };
  return { ok: true };
}

/**
 * @param {Array<{ id: string, title: string, summary: string }>} newlyUnhealthy
 * @param {string} checkedAt
 */
export function buildAdminOpsAlertEmail(newlyUnhealthy, checkedAt) {
  const titles = newlyUnhealthy.map((c) => c.title);
  const subject =
    newlyUnhealthy.length === 1
      ? `[JPS Ops] Unhealthy: ${titles[0]}`
      : `[JPS Ops] Unhealthy: ${newlyUnhealthy.length} checks`;

  const baseUrl = getPublicAppBaseUrl();
  const dashboardUrl = `${baseUrl}/admin/operations`;
  const lines = [
    'Jetty Planning System — Operations Dashboard alert',
    '',
    `Checked at: ${checkedAt}`,
    '',
    'The following check(s) newly became UNHEALTHY:',
    '',
  ];
  for (const check of newlyUnhealthy) {
    lines.push(`• ${check.title}`);
    lines.push(`  ${check.summary}`);
    lines.push('');
  }
  lines.push(`Open dashboard: ${dashboardUrl}`);
  lines.push('');
  lines.push('This email was sent because email alerts are enabled on the Operations Dashboard.');

  return { subject, text: lines.join('\n') };
}

/**
 * @param {{ emailAlertsEnabled: boolean }} settings
 * @param {boolean} smtpConfigured
 * @param {NodeJS.ProcessEnv} [env]
 */
export function computeEmailAlertsActive(settings, smtpConfigured, env = process.env) {
  const gate = canSendAdminOpsAlerts(settings, env);
  return gate.ok && smtpConfigured;
}
