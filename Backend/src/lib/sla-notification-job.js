/**
 * Scheduled SLA notification job (D-1 and breach).
 */
import { writeActivityLog } from './activity-log.js';
import {
  SLA_EVENT_BREACH,
  SLA_EVENT_D1,
  buildBreachCandidatesSql,
  buildD1CandidatesSql,
  formatEtcInPortTz,
  formatOverdueDuration,
} from './etc-sla-eligibility.js';
import { loadEventSettings, resolveEventRecipients } from './notification-recipients.js';
import { getPublicAppBaseUrl, triggerNotification } from './notifications.js';

const ACTIVITY_PAGE_KEY = 'admin';
const ADVISORY_LOCK_KEY = 930931;

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
 * @param {'d1'|'breach'} mode
 */
export async function runSlaNotificationJob(db, mode) {
  const locked = await tryAdvisoryLock(db);
  if (!locked) {
    return { skipped: true, reason: 'lock_not_acquired' };
  }

  try {
    if (mode === 'd1') return await runD1Job(db);
    if (mode === 'breach') return await runBreachJob(db);
    return { skipped: true, reason: 'invalid_mode' };
  } finally {
    await releaseAdvisoryLock(db);
  }
}

/**
 * @param {import('pg').Pool} db
 */
async function runD1Job(db) {
  const settings = await loadEventSettings(db, SLA_EVENT_D1);
  if (!settings?.enabled) {
    return { mode: 'd1', vessels: 0, notifications: 0, emailQueued: 0, skipped: true };
  }

  const { rows } = await db.query(buildD1CandidatesSql());
  let notifications = 0;
  let emailQueued = 0;

  for (const row of rows) {
    const operationId = Number(row.operation_id);
    const portId = row.port_id != null ? Number(row.port_id) : null;
    const etcDatePort = row.etc_date_port;
    const correlationBase = `op:${operationId}:sla_d1:${etcDatePort}`;
    const recipients = await resolveEventRecipients(db, SLA_EVENT_D1, portId);
    if (recipients.length === 0) continue;

    const baseUrl = getPublicAppBaseUrl();
    const payloadVars = {
      vesselName: row.vessel_name,
      jettyName: row.jetty_name,
      jettyOperationCode: row.jetty_operation_code,
      planReference: row.plan_reference,
      portName: row.port_name || '',
      etcFormatted: formatEtcInPortTz(row.etc_at, row.schedule_timezone),
      overdueFormatted: '',
      operationId: String(operationId),
      primaryHref: `${baseUrl}/at-berth`,
      actionUrl: `${baseUrl}/at-berth`,
    };

    for (const userId of recipients) {
      const result = await triggerNotification(db, {
        eventKey: SLA_EVENT_D1,
        correlationId: `${correlationBase}:u:${userId}`,
        portId,
        recipientUserIds: [userId],
        payloadVars,
      });
      notifications += result.sent || 0;
      emailQueued += result.emailQueued || 0;
    }
  }

  const summary = `SLA D-1 job: ${notifications} notification(s) queued for ${rows.length} vessel(s)`;
  await writeActivityLog({
    pageKey: ACTIVITY_PAGE_KEY,
    action: 'create',
    entityType: 'SlaNotificationJob',
    entityLabel: 'd1',
    summary,
    meta: { mode: 'd1', vessels: rows.length, notifications, emailQueued },
    actorUserId: null,
  }).catch(() => {});

  return { mode: 'd1', vessels: rows.length, notifications, emailQueued };
}

/**
 * @param {import('pg').Pool} db
 */
async function runBreachJob(db) {
  const settings = await loadEventSettings(db, SLA_EVENT_BREACH);
  if (!settings?.enabled) {
    return { mode: 'breach', vessels: 0, notifications: 0, emailQueued: 0, skipped: true };
  }

  const includePostSignoff = Boolean(settings.include_post_signoff_breach);
  const { rows } = await db.query(buildBreachCandidatesSql(includePostSignoff));
  let notifications = 0;
  let emailQueued = 0;

  for (const row of rows) {
    const operationId = Number(row.operation_id);
    const portId = row.port_id != null ? Number(row.port_id) : null;
    const todayPortDate = row.today_port_date;
    const correlationBase = `op:${operationId}:sla_breach:${todayPortDate}`;
    const recipients = await resolveEventRecipients(db, SLA_EVENT_BREACH, portId);
    if (recipients.length === 0) continue;

    const overdueFormatted = formatOverdueDuration(Number(row.over_hours));
    const baseUrl = getPublicAppBaseUrl();
    const payloadVars = {
      vesselName: row.vessel_name,
      jettyName: row.jetty_name,
      jettyOperationCode: row.jetty_operation_code,
      planReference: row.plan_reference,
      portName: row.port_name || '',
      etcFormatted: formatEtcInPortTz(row.etc_at, row.schedule_timezone),
      overdueFormatted,
      operationId: String(operationId),
      primaryHref: `${baseUrl}/at-berth`,
      actionUrl: `${baseUrl}/at-berth`,
    };

    for (const userId of recipients) {
      const result = await triggerNotification(db, {
        eventKey: SLA_EVENT_BREACH,
        correlationId: `${correlationBase}:u:${userId}`,
        portId,
        recipientUserIds: [userId],
        payloadVars,
      });
      notifications += result.sent || 0;
      emailQueued += result.emailQueued || 0;
    }
  }

  const summary = `SLA breach job: ${notifications} notification(s) queued for ${rows.length} vessel(s)`;
  await writeActivityLog({
    pageKey: ACTIVITY_PAGE_KEY,
    action: 'create',
    entityType: 'SlaNotificationJob',
    entityLabel: 'breach',
    summary,
    meta: { mode: 'breach', vessels: rows.length, notifications, emailQueued },
    actorUserId: null,
  }).catch(() => {});

  return { mode: 'breach', vessels: rows.length, notifications, emailQueued };
}
