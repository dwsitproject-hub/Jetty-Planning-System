/**
 * Load/save System Health per-check alert recipients.
 */
import { isValidRecipientEmail } from './notification-email-worker.js';
import {
  ADMIN_OPS_ALERT_CHECK_CATALOG,
  recipientRowsToMap,
} from './admin-ops-alert-units.js';

const VALID_CHECK_IDS = new Set(ADMIN_OPS_ALERT_CHECK_CATALOG.map((c) => c.id));

/**
 * @param {import('pg').Pool | import('pg').PoolClient} db
 */
export async function loadAdminOpsAlertRecipientRows(db) {
  const r = await db.query(
    `SELECT check_id, port_id, recipient_email FROM admin_ops_alert_recipients`
  );
  return r.rows.map((row) => ({
    check_id: String(row.check_id),
    port_id: row.port_id == null ? null : Number(row.port_id),
    recipient_email: String(row.recipient_email || '').trim(),
  }));
}

/**
 * @param {import('pg').Pool | import('pg').PoolClient} db
 */
export async function loadAdminOpsAlertRecipientsForApi(db) {
  const [rows, portsR] = await Promise.all([
    loadAdminOpsAlertRecipientRows(db),
    db.query(
      `SELECT id, name FROM ports WHERE deleted_at IS NULL AND is_active IS TRUE ORDER BY LOWER(name), id`
    ),
  ]);
  const map = recipientRowsToMap(rows);
  /** @type {Array<{ checkId: string, portId: number | null, portName?: string, title: string, email: string }>} */
  const recipients = [];

  for (const cat of ADMIN_OPS_ALERT_CHECK_CATALOG) {
    if (cat.supportsPerPort) {
      for (const port of portsR.rows) {
        const portId = Number(port.id);
        recipients.push({
          checkId: cat.id,
          portId,
          portName: port.name,
          title: `${cat.title} — ${port.name}`,
          email: map.get(`${cat.id}\0${portId}`) || '',
        });
      }
    } else {
      recipients.push({
        checkId: cat.id,
        portId: null,
        title: cat.title,
        email: map.get(`${cat.id}\0`) || '',
      });
    }
  }

  return {
    catalog: ADMIN_OPS_ALERT_CHECK_CATALOG,
    recipients,
  };
}

/**
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {Array<{ checkId: string, portId?: number | null, email?: string }>} items
 * @param {number | null} updatedBy
 */
export async function saveAdminOpsAlertRecipients(db, items, updatedBy) {
  if (!Array.isArray(items)) {
    const err = new Error('recipients must be an array');
    err.status = 400;
    throw err;
  }

  for (const item of items) {
    const checkId = String(item?.checkId || '').trim();
    if (!VALID_CHECK_IDS.has(checkId)) {
      const err = new Error(`Unknown checkId: ${checkId}`);
      err.status = 400;
      throw err;
    }
    const portId =
      item.portId == null || item.portId === '' ? null : Number(item.portId);
    if (portId != null && !Number.isFinite(portId)) {
      const err = new Error(`Invalid portId for check ${checkId}`);
      err.status = 400;
      throw err;
    }
    const email = item.email == null ? '' : String(item.email).trim();
    if (email && !isValidRecipientEmail(email)) {
      const err = new Error(`Invalid email for ${checkId}${portId != null ? ` port ${portId}` : ''}`);
      err.status = 400;
      throw err;
    }

    if (!email) {
      await db.query(
        `DELETE FROM admin_ops_alert_recipients
         WHERE check_id = $1 AND port_id IS NOT DISTINCT FROM $2`,
        [checkId, portId]
      );
    } else {
      await db.query(`DELETE FROM admin_ops_alert_recipients
         WHERE check_id = $1 AND port_id IS NOT DISTINCT FROM $2`, [checkId, portId]);
      await db.query(
        `INSERT INTO admin_ops_alert_recipients (check_id, port_id, recipient_email, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [checkId, portId, email, updatedBy ?? null]
      );
    }
  }
}