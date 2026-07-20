/**
 * Polls notification_deliveries (email, queued), sends via SMTP when configured.
 */
import { pool } from '../db.js';
import { getFromAddress, getSmtpTransport } from './smtp-config.js';
import { loadNotificationTemplate, renderTemplate, insertInAppNotificationForUser } from './notifications.js';

/** Reject malformed or injection-prone recipient addresses before SMTP send. */
export function isValidRecipientEmail(address) {
  const a = String(address || '').trim();
  if (!a || a.length > 254) return false;
  if (/[\r\n]/.test(a) || /[<>]/.test(a)) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a);
}

/**
 * @returns {Promise<number>} processed count
 */
export async function processNotificationEmailQueueOnce(limit = 15) {
  const { rows } = await pool.query(
    `SELECT nd.id AS delivery_id, nd.notification_id, n.user_id, n.port_id, n.event_key, n.payload,
            u.email AS user_email, u.username
     FROM notification_deliveries nd
     JOIN notifications n ON n.id = nd.notification_id
     JOIN users u ON u.id = n.user_id AND u.deleted_at IS NULL
     WHERE nd.channel = 'email' AND nd.status = 'queued'
     ORDER BY nd.id ASC
     LIMIT $1`,
    [limit]
  );

  let processed = 0;
  const smtp = await getSmtpTransport(pool);
  const from = await getFromAddress(pool);

  for (const row of rows) {
    const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
    const strVars = Object.fromEntries(
      Object.entries(payload).map(([k, v]) => [k, v == null ? '' : String(v)])
    );
    const emailTpl = await loadNotificationTemplate(pool, row.event_key, 'email');
    if (!emailTpl) {
      await pool.query(
        `UPDATE notification_deliveries SET status = 'failed', error_text = $2, updated_at = NOW() WHERE id = $1`,
        [row.delivery_id, 'No email template']
      );
      processed += 1;
      continue;
    }
    const subject = renderTemplate(emailTpl.title_template, strVars);
    const text = renderTemplate(emailTpl.body_template, strVars);
    const to = row.user_email;

    if (!smtp) {
      await pool.query(
        `UPDATE notification_deliveries
         SET status = 'skipped', error_text = $2, updated_at = NOW()
         WHERE id = $1`,
        [row.delivery_id, 'SMTP not configured — set up in Admin → Notifications']
      );
      processed += 1;
      continue;
    }

    if (!to || !String(to).trim()) {
      await pool.query(
        `UPDATE notification_deliveries SET status = 'skipped', error_text = $2, updated_at = NOW() WHERE id = $1`,
        [row.delivery_id, 'User has no email address']
      );
      processed += 1;
      continue;
    }

    const toAddress = String(to).trim();
    if (!isValidRecipientEmail(toAddress)) {
      await pool.query(
        `UPDATE notification_deliveries SET status = 'failed', error_text = $2, updated_at = NOW() WHERE id = $1`,
        [row.delivery_id, 'Invalid recipient email address']
      );
      processed += 1;
      continue;
    }

    try {
      const info = await smtp.sendMail({
        from,
        to: toAddress,
        subject,
        text,
      });
      await pool.query(
        `UPDATE notification_deliveries
         SET status = 'sent', provider_message_id = $2, updated_at = NOW()
         WHERE id = $1`,
        [row.delivery_id, info?.messageId ?? null]
      );
      processed += 1;

      const echoTpl = await loadNotificationTemplate(pool, 'notification.email_echo', 'in_app');
      if (echoTpl) {
        const detail =
          row.event_key === 'shipment_plan.submitted'
            ? `We emailed you about shipment plan ${strVars.planReference || ''}. Check your inbox.`.trim()
            : row.event_key === 'operation.signoff_requested'
              ? `We emailed you about clearance / sign-off for ${strVars.vesselName || 'a vessel'}. Check your inbox.`.trim()
              : row.event_key === 'operation.sla_etc_d1'
                ? `We emailed you an SLA D-1 reminder for ${strVars.vesselName || 'a vessel'}. Check your inbox.`.trim()
                : row.event_key === 'operation.sla_etc_breach'
                  ? `We emailed you an SLA breach alert for ${strVars.vesselName || 'a vessel'}. Check your inbox.`.trim()
                  : 'A notification email was sent. Check your inbox.';
        const echoTitle = renderTemplate(echoTpl.title_template, { detail });
        const echoBody = renderTemplate(echoTpl.body_template, { detail });
        const echoCorrelation = `email_echo:${row.delivery_id}`;
        await insertInAppNotificationForUser(pool, {
          userId: row.user_id,
          portId: row.port_id,
          eventKey: 'notification.email_echo',
          correlationId: echoCorrelation,
          title: echoTitle,
          body: echoBody,
          kind: 'email_sent',
          payload: { detail, parentEventKey: row.event_key },
        });
      }
    } catch (err) {
      const msg = err?.message || String(err);
      await pool.query(
        `UPDATE notification_deliveries SET status = 'failed', error_text = $2, updated_at = NOW() WHERE id = $1`,
        [row.delivery_id, msg.slice(0, 2000)]
      );
      processed += 1;
    }
  }

  return processed;
}

let intervalId = null;

export function startNotificationEmailWorker() {
  const intervalMs = Math.max(5000, parseInt(process.env.NOTIFICATION_EMAIL_POLL_MS || '20000', 10) || 20000);
  if (intervalId) return;
  intervalId = setInterval(() => {
    processNotificationEmailQueueOnce(20).catch((err) => {
      console.error('[notifications] email worker', err?.message || err);
    });
  }, intervalMs);
  intervalId.unref?.();
}
