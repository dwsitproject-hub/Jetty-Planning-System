/**
 * System Health Dashboard — aggregated infrastructure / batch job status.
 * Extensible via ADMIN_OPS_CHECK_REGISTRY in admin-ops-checks.js.
 */
import express from 'express';
import { pool } from '../db.js';
import { requireAdminPageView, requirePageEdit } from '../middleware/permissions.js';
import {
  buildResyncAuditSummary,
  deriveResyncOutcome,
  runAtgOperationRecovery,
} from '../lib/atg-operation-recovery.js';
import { runAdminOpsChecks } from '../lib/admin-ops-checks.js';
import {
  computeEmailAlertsActive,
  loadAdminOpsAlertSettings,
  saveAdminOpsAlertSettings,
} from '../lib/admin-ops-alert-job.js';
import { getEffectiveSmtpConfig, isSmtpSendingConfigured } from '../lib/smtp-config.js';
import { writeActivityLog } from '../lib/activity-log.js';

const router = express.Router();
router.use(...requireAdminPageView);

const ACTIVITY_PAGE_KEY = 'admin';

async function buildSettingsResponse() {
  const settings = await loadAdminOpsAlertSettings(pool);
  const smtpCfg = await getEffectiveSmtpConfig(pool);
  const smtpConfigured = isSmtpSendingConfigured(smtpCfg);
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

function logAtgResyncActivity(req, result, extra = {}) {
  const outcome = result.outcome || deriveResyncOutcome(result);
  writeActivityLog({
    pageKey: ACTIVITY_PAGE_KEY,
    action: 'update',
    entityType: 'AtgOperationRecovery',
    entityId: result.operationId != null ? String(result.operationId) : null,
    entityLabel: result.operationLabel || (result.operationId != null ? `Operation #${result.operationId}` : null),
    summary: buildResyncAuditSummary(result),
    meta: {
      kind: 'atg_cargo_resync',
      operationId: result.operationId,
      portId: result.portId ?? null,
      dryRun: Boolean(result.dryRun),
      confirm: extra.confirm ?? null,
      gapKeys: extra.gapKeys ?? null,
      gapsBefore: result.gapsBefore ?? [],
      gapsAfter: result.gapsAfter ?? [],
      samplesInserted: result.samplesInserted ?? 0,
      hourlyUpserted: result.hourlyUpserted ?? 0,
      dailyUpserted: result.dailyUpserted ?? 0,
      durationMs: result.durationMs ?? null,
      archiveErrors: result.archiveErrors ?? [],
      outcome,
      error: extra.error ?? null,
    },
    actorUserId: req.userId ?? null,
  }).catch(() => {});
}

router.post('/atg-cargo-gaps/:operationId/resync', ...requirePageEdit('admin'), async (req, res) => {
  const operationId = parseInt(String(req.params.operationId ?? ''), 10);
  if (!Number.isFinite(operationId) || operationId <= 0) {
    return res.status(400).json({ error: 'Invalid operationId' });
  }

  const body = req.body || {};
  const dryRun = Boolean(body.dryRun);
  if (!dryRun && body.confirm !== true) {
    return res.status(400).json({ error: 'confirmation_required' });
  }

  const gapKeys = Array.isArray(body.gapKeys)
    ? body.gapKeys.map(String).filter(Boolean)
    : undefined;

  try {
    const opExists = await pool.query(
      `SELECT id FROM operations WHERE id = $1 AND deleted_at IS NULL`,
      [operationId]
    );
    if (!opExists.rows.length) {
      return res.status(404).json({ error: 'Operation not found' });
    }

    const result = await runAtgOperationRecovery(pool, operationId, { dryRun, gapKeys });
    logAtgResyncActivity(req, result, { confirm: body.confirm === true, gapKeys });
    res.json(result);
  } catch (err) {
    console.error('admin-ops/atg-cargo-gaps resync failed:', err);
    const status = err.statusCode === 422 ? 422 : 500;
    const failed = {
      ok: false,
      failed: true,
      operationId,
      dryRun,
      samplesInserted: 0,
      hourlyUpserted: 0,
      dailyUpserted: 0,
      gapsBefore: [],
      gapsAfter: [],
      archiveErrors: [],
      outcome: 'failed',
    };
    logAtgResyncActivity(req, failed, {
      confirm: body.confirm === true,
      gapKeys,
      error: err?.message || String(err),
    });
    res.status(status).json({ error: err?.message || 'Resync failed', ...failed });
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
