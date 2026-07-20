/**
 * Central notification trigger: RBAC recipient resolution, in-app rows, email queue.
 */
import { getNotificationEventConfig } from './notification-events.js';
import { loadEventSettings, resolveEventRecipients } from './notification-recipients.js';

/** @param {string} template */
export function renderTemplate(template, vars) {
  if (template == null) return '';
  const v = vars && typeof vars === 'object' ? vars : {};
  return String(template).replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, key) => {
    const k = String(key).trim();
    const val = v[k];
    return val == null ? '' : String(val);
  });
}

export function getPublicAppBaseUrl() {
  const explicit = process.env.APP_PUBLIC_URL || process.env.FRONTEND_APP_URL;
  if (explicit && String(explicit).trim()) return String(explicit).trim().replace(/\/$/, '');
  const cors = process.env.CORS_ORIGIN || '';
  const first = cors.split(',')[0]?.trim();
  if (first) return first.replace(/\/$/, '');
  return 'http://localhost:5173';
}

/**
 * @param {import('pg').Pool} db
 * @param {string} eventKey
 * @param {'in_app'|'email'} channel
 */
export async function loadNotificationTemplate(db, eventKey, channel) {
  const r = await db.query(
    `SELECT title_template, body_template, kind, primary_action_label_key
     FROM notification_templates
     WHERE event_key = $1 AND channel = $2 AND COALESCE(locale, '') = ''
     LIMIT 1`,
    [eventKey, channel]
  );
  return r.rows[0] ?? null;
}

/**
 * Users who have can_approve on the given page permission key.
 * @param {import('pg').Pool} db
 * @param {string} pageKey
 * @param {number | null} excludeUserId
 */
export async function resolveApproverUserIds(db, pageKey, excludeUserId) {
  const r = await db.query(
    `SELECT DISTINCT ur.user_id
     FROM user_roles ur
     JOIN role_permissions rp ON rp.role_id = ur.role_id AND rp.deleted_at IS NULL
     JOIN permissions p ON p.id = rp.permission_id AND p.deleted_at IS NULL
     JOIN users u ON u.id = ur.user_id AND u.deleted_at IS NULL AND u.is_active = TRUE
     WHERE ur.deleted_at IS NULL
       AND p.resource_type = 'page'
       AND p.resource_key = $1
       AND rp.can_approve = TRUE
       AND ($2::bigint IS NULL OR ur.user_id <> $2)`,
    [pageKey, excludeUserId]
  );
  return r.rows.map((row) => Number(row.user_id));
}

/**
 * @param {import('pg').Pool} db
 * @param {{
 *   eventKey: string,
 *   correlationId: string,
 *   portId: number | null,
 *   excludeUserId?: number | null,
 *   recipientUserIds?: number[] | null,
 *   payloadVars: Record<string, string | number | null | undefined>,
 *   forceEmail?: boolean,
 *   forceInApp?: boolean,
 * }} opts
 */
export async function triggerNotification(db, opts) {
  const {
    eventKey,
    correlationId,
    portId,
    excludeUserId = null,
    recipientUserIds = null,
    payloadVars = {},
    forceEmail,
    forceInApp,
  } = opts;
  const cfg = getNotificationEventConfig(eventKey);
  if (!cfg) {
    return { sent: 0, skipped: true, reason: 'no_config' };
  }

  let inAppEnabled = true;
  let emailEnabled = true;
  if (cfg.adminConfigured) {
    const settings = await loadEventSettings(db, eventKey);
    if (!settings?.enabled) {
      return { sent: 0, skipped: true, reason: 'event_disabled' };
    }
    inAppEnabled = settings.in_app_enabled !== false;
    emailEnabled = settings.email_enabled !== false;
  }
  if (forceInApp === false) inAppEnabled = false;
  if (forceInApp === true) inAppEnabled = true;
  if (forceEmail === false) emailEnabled = false;
  if (forceEmail === true) emailEnabled = true;

  const inAppTpl = inAppEnabled ? await loadNotificationTemplate(db, eventKey, 'in_app') : null;
  const emailTpl = emailEnabled ? await loadNotificationTemplate(db, eventKey, 'email') : null;
  if (!inAppTpl && !emailTpl) {
    return { sent: 0, skipped: true, reason: 'no_templates' };
  }

  const strVars = Object.fromEntries(
    Object.entries(payloadVars).map(([k, val]) => [k, val == null ? '' : String(val)])
  );

  const title = inAppTpl
    ? renderTemplate(inAppTpl.title_template, strVars)
    : emailTpl
      ? renderTemplate(emailTpl.title_template, strVars)
      : '';
  const body = inAppTpl
    ? renderTemplate(inAppTpl.body_template, strVars)
    : emailTpl
      ? renderTemplate(emailTpl.body_template, strVars)
      : '';
  const kind = inAppTpl?.kind || emailTpl?.kind || 'info';
  const primaryActionLabelKey = inAppTpl?.primary_action_label_key ?? null;

  const payload = {
    ...strVars,
    eventKey,
    primaryHref: strVars.primaryHref || '',
    primaryActionLabelKey,
  };

  let recipients;
  if (Array.isArray(recipientUserIds) && recipientUserIds.length > 0) {
    recipients = recipientUserIds.map(Number);
  } else if (cfg.adminConfigured) {
    recipients = await resolveEventRecipients(db, eventKey, portId);
  } else if (cfg.approvePageKey) {
    recipients = await resolveApproverUserIds(db, cfg.approvePageKey, excludeUserId ?? null);
  } else {
    return { sent: 0, skipped: true, reason: 'no_recipients' };
  }

  if (excludeUserId != null) {
    recipients = recipients.filter((id) => id !== Number(excludeUserId));
  }

  let queued = 0;
  let inserted = 0;

  for (const userId of recipients) {
    let nid = null;
    if (inAppTpl) {
      const ins = await db.query(
        `INSERT INTO notifications (user_id, port_id, event_key, kind, title, body, payload, correlation_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
         ON CONFLICT (user_id, correlation_id) DO NOTHING
         RETURNING id`,
        [userId, portId ?? null, eventKey, kind, title, body, JSON.stringify(payload), correlationId]
      );
      nid = ins.rows[0]?.id ?? null;
      if (nid != null) inserted += 1;
    }

    if (emailTpl) {
      if (nid == null) {
        const existing = await db.query(
          `SELECT id FROM notifications
           WHERE user_id = $1 AND correlation_id = $2 LIMIT 1`,
          [userId, correlationId]
        );
        nid = existing.rows[0]?.id ?? null;
        if (nid == null) {
          const insEmailOnly = await db.query(
            `INSERT INTO notifications (user_id, port_id, event_key, kind, title, body, payload, correlation_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
             ON CONFLICT (user_id, correlation_id) DO NOTHING
             RETURNING id`,
            [
              userId,
              portId ?? null,
              eventKey,
              kind,
              renderTemplate(emailTpl.title_template, strVars),
              renderTemplate(emailTpl.body_template, strVars),
              JSON.stringify(payload),
              correlationId,
            ]
          );
          nid = insEmailOnly.rows[0]?.id ?? null;
          if (nid != null) inserted += 1;
        }
      }
      if (nid != null) {
        const dup = await db.query(
          `SELECT id FROM notification_deliveries WHERE notification_id = $1 AND channel = 'email' LIMIT 1`,
          [nid]
        );
        if (dup.rows.length === 0) {
          await db.query(
            `INSERT INTO notification_deliveries (notification_id, channel, status)
             VALUES ($1, 'email', 'queued')`,
            [nid]
          );
          queued += 1;
        }
      }
    }
  }

  return { sent: inserted, emailQueued: queued, recipients: recipients.length };
}

/**
 * In-app only (single user), e.g. email echo after SMTP send.
 */
export async function insertInAppNotificationForUser(db, opts) {
  const {
    userId,
    portId,
    eventKey,
    correlationId,
    title,
    body,
    kind = 'email_sent',
    payload = {},
  } = opts;
  await db.query(
    `INSERT INTO notifications (user_id, port_id, event_key, kind, title, body, payload, correlation_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
     ON CONFLICT (user_id, correlation_id) DO NOTHING`,
    [userId, portId ?? null, eventKey, kind, title, body, JSON.stringify(payload), correlationId]
  );
}

/**
 * Fire-and-forget wrapper for HTTP handlers after commit.
 * @param {import('pg').Pool} db
 * @param {Parameters<typeof triggerNotification>[1]} opts
 */
export function triggerNotificationDeferred(db, opts) {
  setImmediate(() => {
    triggerNotification(db, opts).catch((err) => {
      console.error('[notifications] trigger failed', opts?.eventKey, err?.message || err);
    });
  });
}
