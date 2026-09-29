/**
 * System Health Dashboard — aggregated infrastructure / batch job status.
 * Extensible via ADMIN_OPS_CHECK_REGISTRY in admin-ops-checks.js.
 */
import express from 'express';
import { pool } from '../db.js';
import { requireAdminPageView } from '../middleware/permissions.js';
import { runAdminOpsChecks } from '../lib/admin-ops-checks.js';
import {
  computeEmailAlertsActive,
  loadAdminOpsAlertSettings,
  saveAdminOpsAlertSettings,
} from '../lib/admin-ops-alert-job.js';
import { getSmtpTransport } from '../lib/smtp-config.js';
import { writeActivityLog } from '../lib/activity-log.js';

const router = express.Router();
router.use(...requireAdminPageView);

const ACTIVITY_PAGE_KEY = 'admin';

async function buildSettingsResponse() {
  const settings = await loadAdminOpsAlertSettings(pool);
  const smtp = await getSmtpTransport(pool);
  const smtpConfigured = Boolean(smtp);
  return {
    emailAlertsEnabled: settings.emailAlertsEnabled,
    alertEmail: settings.alertEmail,
    emailAlertsActive: computeEmailAlertsActive(settings, smtpConfigured),
    smtpConfigured,
    updatedAt: settings.updatedAt,
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
    if (body.emailAlertsEnabled == null) {
      return res.status(400).json({ error: 'emailAlertsEnabled is required' });
    }
    await saveAdminOpsAlertSettings(pool, {
      emailAlertsEnabled: Boolean(body.emailAlertsEnabled),
      updatedBy: req.userId ?? null,
    });
    writeActivityLog({
      pageKey: ACTIVITY_PAGE_KEY,
      action: 'update',
      entityType: 'AdminOpsAlertSettings',
      entityId: '1',
      entityLabel: 'System health email alerts',
      summary: `System health email alerts ${body.emailAlertsEnabled ? 'enabled' : 'disabled'}`,
      actorUserId: req.userId ?? null,
    }).catch(() => {});
    res.json(await buildSettingsResponse());
  } catch (err) {
    console.error('admin-ops/settings PUT failed:', err);
    res.status(500).json({ error: err?.message || 'Failed to save operations alert settings' });
  }
});

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
