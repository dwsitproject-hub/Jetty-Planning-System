/**
 * Scheduled System Health Dashboard alert job: email when a check newly becomes unhealthy.
 */
import { runAdminOpsChecks } from './admin-ops-checks.js';
import {
  buildAdminOpsAlertEmail,
  canSendAdminOpsAlerts,
  computeEmailAlertsActive,
  isNewlyUnhealthy,
} from './admin-ops-alert-logic.js';
import { isValidRecipientEmail } from './notification-email-worker.js';
import { getFromAddress, getSmtpTransport } from './smtp-config.js';

export { computeEmailAlertsActive } from './admin-ops-alert-logic.js';

const ADVISORY_LOCK_KEY = 930932;
const SETTINGS_ID = 1;

/**
 * @param {import('pg').Pool | import('pg').PoolClient} db
 */
export async function loadAdminOpsAlertSettings(db) {
  const r = await db.query(
    `SELECT email_alerts_enabled, alert_email, updated_at, updated_by
     FROM admin_ops_alert_settings WHERE id = $1`,
    [SETTINGS_ID]
  );
  const row = r.rows[0];
  if (!row) {
    return {
      emailAlertsEnabled: false,
      alertEmail: process.env.ADMIN_OPS_ALERT_EMAIL || 'it-project@energi-up.com',
      updatedAt: null,
      updatedBy: null,
    };
  }
  return {
    emailAlertsEnabled: Boolean(row.email_alerts_enabled),
    alertEmail: String(row.alert_email || 'it-project@energi-up.com').trim(),
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

/**
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {{ emailAlertsEnabled: boolean, updatedBy?: number | null }} patch
 */
export async function saveAdminOpsAlertSettings(db, patch) {
  const r = await db.query(
    `UPDATE admin_ops_alert_settings SET
       email_alerts_enabled = $2,
       updated_by = $3,
       updated_at = NOW()
     WHERE id = $1
     RETURNING email_alerts_enabled, alert_email, updated_at, updated_by`,
    [SETTINGS_ID, Boolean(patch.emailAlertsEnabled), patch.updatedBy ?? null]
  );
  const row = r.rows[0];
  return {
    emailAlertsEnabled: Boolean(row?.email_alerts_enabled),
    alertEmail: String(row?.alert_email || 'it-project@energi-up.com').trim(),
    updatedAt: row?.updated_at ?? null,
    updatedBy: row?.updated_by ?? null,
  };
}

/**
 * @param {import('pg').Pool | import('pg').PoolClient} db
 */
async function loadAlertStateMap(db) {
  const r = await db.query(
    `SELECT check_id, last_status, last_summary, last_checked_at, last_alerted_at
     FROM admin_ops_alert_state`
  );
  /** @type {Map<string, { lastStatus: string | null, lastSummary: string | null }>} */
  const map = new Map();
  for (const row of r.rows) {
    map.set(String(row.check_id), {
      lastStatus: row.last_status ?? null,
      lastSummary: row.last_summary ?? null,
    });
  }
  return map;
}

/**
 * @param {import('pg').Pool} db
 */
async function tryAdvisoryLock(db) {
  const r = await db.query(`SELECT pg_try_advisory_lock($1) AS ok`, [ADVISORY_LOCK_KEY]);
  return Boolean(r.rows[0]?.ok);
}

/**
 * @param {import('pg').Pool} db
 */
async function releaseAdvisoryLock(db) {
  await db.query(`SELECT pg_advisory_unlock($1)`, [ADVISORY_LOCK_KEY]).catch(() => {});
}

/**
 * @param {import('pg').Pool} db
 * @param {{
 *   status: string,
 *   recipientEmail?: string | null,
 *   subject?: string | null,
 *   unhealthyChecks?: object[] | null,
 *   errorText?: string | null,
 *   providerMessageId?: string | null,
 * }} row
 */
async function recordDelivery(db, row) {
  await db.query(
    `INSERT INTO admin_ops_alert_deliveries
       (status, recipient_email, subject, unhealthy_checks, error_text, provider_message_id)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
    [
      row.status,
      row.recipientEmail ?? null,
      row.subject ?? null,
      JSON.stringify(row.unhealthyChecks ?? []),
      row.errorText ?? null,
      row.providerMessageId ?? null,
    ]
  );
}

/**
 * @param {import('pg').Pool} db
 * @param {{ dryRun?: boolean }} [opts]
 */
export async function runAdminOpsAlertJob(db, opts = {}) {
  const dryRun = Boolean(opts.dryRun);
  const locked = await tryAdvisoryLock(db);
  if (!locked) {
    return { skipped: true, reason: 'lock_not_acquired' };
  }

  try {
    const settings = await loadAdminOpsAlertSettings(db);
    const previousState = await loadAlertStateMap(db);
    const result = await runAdminOpsChecks(db);
    const checkedAt = result.checkedAt;

    /** @type {Array<{ id: string, title: string, summary: string }>} */
    const newlyUnhealthy = [];

    for (const check of result.checks) {
      const prev = previousState.get(check.id);
      const previousStatus = prev?.lastStatus ?? null;
      if (isNewlyUnhealthy(previousStatus, check.status)) {
        newlyUnhealthy.push({
          id: check.id,
          title: check.title,
          summary: check.summary,
        });
      }
    }

    const smtp = await getSmtpTransport(db);
    const smtpConfigured = Boolean(smtp);
    const sendGate = canSendAdminOpsAlerts(settings);
    let emailResult = { sent: false, skipped: true, reason: sendGate.reason || 'no_new_unhealthy' };

    if (newlyUnhealthy.length > 0 && sendGate.ok) {
      const to = String(settings.alertEmail || '').trim();
      if (!isValidRecipientEmail(to)) {
        emailResult = { sent: false, skipped: true, reason: 'invalid_recipient' };
        if (!dryRun) {
          await recordDelivery(db, {
            status: 'skipped',
            recipientEmail: to,
            unhealthyChecks: newlyUnhealthy,
            errorText: 'Invalid alert recipient email',
          });
        }
      } else if (!smtpConfigured) {
        emailResult = { sent: false, skipped: true, reason: 'smtp_not_configured' };
        if (!dryRun) {
          await recordDelivery(db, {
            status: 'skipped',
            recipientEmail: to,
            unhealthyChecks: newlyUnhealthy,
            errorText: 'SMTP not configured',
          });
        }
      } else if (dryRun) {
        emailResult = { sent: false, skipped: true, reason: 'dry_run', wouldSendTo: to };
      } else {
        const { subject, text } = buildAdminOpsAlertEmail(newlyUnhealthy, checkedAt);
        const from = await getFromAddress(db);
        try {
          const info = await smtp.sendMail({ from, to, subject, text });
          emailResult = { sent: true, to, subject, messageId: info?.messageId ?? null };
          await recordDelivery(db, {
            status: 'sent',
            recipientEmail: to,
            subject,
            unhealthyChecks: newlyUnhealthy,
            providerMessageId: info?.messageId ?? null,
          });
        } catch (err) {
          const errorText = err?.message || String(err);
          emailResult = { sent: false, skipped: false, failed: true, error: errorText };
          await recordDelivery(db, {
            status: 'failed',
            recipientEmail: to,
            subject,
            unhealthyChecks: newlyUnhealthy,
            errorText,
          });
        }
      }
    } else if (newlyUnhealthy.length > 0 && !sendGate.ok) {
      emailResult = { sent: false, skipped: true, reason: sendGate.reason };
      if (!dryRun) {
        await recordDelivery(db, {
          status: 'skipped',
          recipientEmail: settings.alertEmail,
          unhealthyChecks: newlyUnhealthy,
          errorText: `Alert gate: ${sendGate.reason}`,
        });
      }
    }

    if (!dryRun) {
      for (const check of result.checks) {
        const alertSent = newlyUnhealthy.some((c) => c.id === check.id) && emailResult.sent;
        await db.query(
          `INSERT INTO admin_ops_alert_state (check_id, last_status, last_summary, last_checked_at, last_alerted_at)
           VALUES ($1, $2, $3, $4::timestamptz, NULL)
           ON CONFLICT (check_id) DO UPDATE SET
             last_status = EXCLUDED.last_status,
             last_summary = EXCLUDED.last_summary,
             last_checked_at = EXCLUDED.last_checked_at,
             last_alerted_at = CASE
               WHEN $5::boolean THEN $4::timestamptz
               ELSE admin_ops_alert_state.last_alerted_at
             END`,
          [check.id, check.status, check.summary, checkedAt, alertSent]
        );
      }
    }

    return {
      skipped: false,
      checkedAt,
      overall: result.overall,
      newlyUnhealthy,
      email: emailResult,
      settings: {
        emailAlertsEnabled: settings.emailAlertsEnabled,
        alertEmail: settings.alertEmail,
      },
    };
  } finally {
    await releaseAdvisoryLock(db);
  }
}
