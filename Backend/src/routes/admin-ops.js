/**
 * System Health Dashboard — aggregated infrastructure / batch job status.
 * Extensible via ADMIN_OPS_CHECK_REGISTRY in admin-ops-checks.js.
 */
import express from 'express';
import { pool } from '../db.js';
import { requireAdminPageView } from '../middleware/permissions.js';
import atgGapsRoutes from './admin-ops-atg-gaps.js';
import atgSourceRecoveryRoutes from './admin-ops-atg-source-recovery.js';
import { runAdminOpsChecks } from '../lib/admin-ops-checks.js';
import {
  computeEmailAlertsActive,
  loadAdminOpsAlertSettings,
  loadAdminOpsAlertRecipientsForApi,
  saveAdminOpsAlertSettings,
} from '../lib/admin-ops-alert-job.js';
import { saveAdminOpsAlertRecipients } from '../lib/admin-ops-alert-recipients.js';
import { getEffectiveSmtpConfig, isSmtpSendingConfigured } from '../lib/smtp-config.js';
import { writeActivityLog } from '../lib/activity-log.js';

const router = express.Router();
router.use(...requireAdminPageView);

const ACTIVITY_PAGE_KEY = 'admin';

async function buildSettingsResponse() {
  const [settings, recipientPayload, smtpCfg] = await Promise.all([
    loadAdminOpsAlertSettings(pool),
    loadAdminOpsAlertRecipientsForApi(pool),
    getEffectiveSmtpConfig(pool),
  ]);
  const smtpConfigured = isSmtpSendingConfigured(smtpCfg);
  return {
    emailAlertsEnabled: settings.emailAlertsEnabled,
    alertEmail: settings.alertEmail,
    emailAlertsActive: computeEmailAlertsActive(settings, smtpConfigured),
    smtpConfigured,
    updatedAt: settings.updatedAt,
    catalog: recipientPayload.catalog,
    recipients: recipientPayload.recipients,
  };
}

router.get('/settings', async (_req, res) => {
  try {
    res.json(await buildSettingsResponse());
  } catch (err) {
    console.error('admin-ops/settings GET failed:', err);
    res.status(500).json({ error: err?.message || 'Failed to load operations alert settings' });
  }
});

router.put('/settings', async (req, res) => {
  try {
    const body = req.body || {};
    const hasToggle = body.emailAlertsEnabled != null;
    const hasEmail = body.alertEmail != null;
    const hasRecipients = Array.isArray(body.recipients);

    if (!hasToggle && !hasEmail && !hasRecipients) {
      return res.status(400).json({
        error: 'Provide emailAlertsEnabled, alertEmail, and/or recipients',
      });
    }

    if (hasToggle || hasEmail) {
      await saveAdminOpsAlertSettings(pool, {
        ...(hasToggle ? { emailAlertsEnabled: Boolean(body.emailAlertsEnabled) } : {}),
        ...(hasEmail ? { alertEmail: String(body.alertEmail) } : {}),
        updatedBy: req.userId ?? null,
      });
    }

    if (hasRecipients) {
      await saveAdminOpsAlertRecipients(pool, body.recipients, req.userId ?? null);
    }

    const parts = [];
    if (hasToggle) parts.push(body.emailAlertsEnabled ? 'alerts enabled' : 'alerts disabled');
    if (hasEmail) parts.push('default recipient updated');
    if (hasRecipients) parts.push('per-check recipients updated');

    writeActivityLog({
      pageKey: ACTIVITY_PAGE_KEY,
      action: 'update',
      entityType: 'AdminOpsAlertSettings',
      entityId: '1',
      entityLabel: 'System health email alerts',
      summary: `System health email: ${parts.join('; ') || 'settings saved'}`,
      actorUserId: req.userId ?? null,
    }).catch(() => {});

    res.json(await buildSettingsResponse());
  } catch (err) {
    const status = err?.status === 400 ? 400 : 500;
    console.error('admin-ops/settings PUT failed:', err);
    res.status(status).json({ error: err?.message || 'Failed to save operations alert settings' });
  }
});

router.use('/atg-cargo-gaps', atgGapsRoutes);
router.use('/atg-source-recovery', atgSourceRecoveryRoutes);

router.get('/status', async (_req, res) => {
  try {
    const [status, alertSettings] = await Promise.all([
      runAdminOpsChecks(pool),
      buildSettingsResponse(),
    ]);
    res.json({
      ...status,
      emailAlertsEnabled: alertSettings.emailAlertsEnabled,
      emailAlertsActive: alertSettings.emailAlertsActive,
      alertEmail: alertSettings.alertEmail,
      smtpConfigured: alertSettings.smtpConfigured,
    });
  } catch (err) {
    console.error('admin-ops/status failed:', err);
    res.status(500).json({ error: err?.message || 'Failed to load operations status' });
  }
});

export default router;