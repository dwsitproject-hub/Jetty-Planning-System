/**
 * Admin notification settings: SLA events, recipients, SMTP, delivery log.
 */
import express from 'express';
import { pool } from '../db.js';
import { requireAdminPageView } from '../middleware/permissions.js';
import { writeActivityLog } from '../lib/activity-log.js';
import { getEventLabel } from '../lib/notification-events.js';
import { isValidRecipientEmail } from '../lib/notification-email-worker.js';
import {
  getFromAddress,
  getSmtpConfigForAdmin,
  getSmtpTransport,
  saveSmtpConfig,
} from '../lib/smtp-config.js';
import { loadAllEventSettings } from '../lib/notification-recipients.js';

const router = express.Router();
router.use(...requireAdminPageView);

const ACTIVITY_PAGE_KEY = 'admin';

function toEventSettings(row) {
  return {
    eventKey: row.event_key,
    enabled: Boolean(row.enabled),
    inAppEnabled: Boolean(row.in_app_enabled),
    emailEnabled: Boolean(row.email_enabled),
    includePostSignoffBreach: Boolean(row.include_post_signoff_breach),
    dailySendHour: Number(row.daily_send_hour) || 8,
    updatedAt: row.updated_at,
    recipientCount: Number(row.recipient_count) || 0,
    label: getEventLabel(row.event_key),
  };
}

router.get('/events', async (_req, res) => {
  const rows = await loadAllEventSettings(pool);
  res.json(rows.map(toEventSettings));
});

router.put('/events/:eventKey', async (req, res) => {
  const eventKey = String(req.params.eventKey || '').trim();
  const body = req.body || {};
  const r = await pool.query(
    `UPDATE notification_event_settings SET
       enabled = COALESCE($2, enabled),
       in_app_enabled = COALESCE($3, in_app_enabled),
       email_enabled = COALESCE($4, email_enabled),
       include_post_signoff_breach = COALESCE($5, include_post_signoff_breach),
       daily_send_hour = COALESCE($6, daily_send_hour),
       updated_at = NOW()
     WHERE event_key = $1
     RETURNING *`,
    [
      eventKey,
      body.enabled != null ? Boolean(body.enabled) : null,
      body.inAppEnabled != null ? Boolean(body.inAppEnabled) : null,
      body.emailEnabled != null ? Boolean(body.emailEnabled) : null,
      body.includePostSignoffBreach != null ? Boolean(body.includePostSignoffBreach) : null,
      body.dailySendHour != null ? Number(body.dailySendHour) : null,
    ]
  );
  if (r.rows.length === 0) return res.status(404).json({ error: 'Event not found' });
  const row = r.rows[0];
  writeActivityLog({
    pageKey: ACTIVITY_PAGE_KEY,
    action: 'update',
    entityType: 'NotificationEventSettings',
    entityId: eventKey,
    entityLabel: getEventLabel(eventKey),
    summary: `Updated ${getEventLabel(eventKey)}: enabled=${row.enabled}, daily hour=${row.daily_send_hour}`,
    actorUserId: req.userId ?? null,
  }).catch(() => {});
  res.json(toEventSettings({ ...row, recipient_count: 0 }));
});

router.get('/events/:eventKey/recipients', async (req, res) => {
  const eventKey = String(req.params.eventKey || '').trim();
  const r = await pool.query(
    `SELECT r.id, r.event_key, r.user_id, r.role_id, r.port_id, r.created_at,
            u.username AS user_username, u.email AS user_email,
            ro.name AS role_name,
            p.name AS port_name
     FROM notification_event_recipients r
     LEFT JOIN users u ON u.id = r.user_id
     LEFT JOIN roles ro ON ro.id = r.role_id
     LEFT JOIN ports p ON p.id = r.port_id
     WHERE r.event_key = $1
     ORDER BY r.id DESC`,
    [eventKey]
  );
  res.json(
    r.rows.map((row) => ({
      id: Number(row.id),
      eventKey: row.event_key,
      userId: row.user_id != null ? Number(row.user_id) : null,
      roleId: row.role_id != null ? Number(row.role_id) : null,
      portId: row.port_id != null ? Number(row.port_id) : null,
      userUsername: row.user_username,
      userEmail: row.user_email,
      roleName: row.role_name,
      portName: row.port_name,
      createdAt: row.created_at,
      kind: row.user_id ? 'user' : 'role',
      label: row.user_id
        ? `${row.user_username || row.user_email || 'User'}${row.port_name ? ` · ${row.port_name}` : row.port_id == null ? ' · all ports' : ''}`
        : `${row.role_name || 'Role'}${row.port_name ? ` · ${row.port_name}` : row.port_id == null ? ' · all ports' : ''}`,
    }))
  );
});

router.post('/events/:eventKey/recipients', async (req, res) => {
  const eventKey = String(req.params.eventKey || '').trim();
  const { userId, roleId, portId, portIds } = req.body || {};
  const uid = userId != null ? Number(userId) : null;
  const rid = roleId != null ? Number(roleId) : null;
  if ((uid == null && rid == null) || (uid != null && rid != null)) {
    return res.status(400).json({ error: 'Provide exactly one of userId or roleId' });
  }

  let portIdList = [];
  if (Array.isArray(portIds)) {
    portIdList = portIds
      .map((p) => Number(p))
      .filter((n) => Number.isFinite(n) && n > 0);
  } else if (portId != null && portId !== '') {
    const n = Number(portId);
    if (Number.isFinite(n) && n > 0) portIdList = [n];
  }
  // Empty portIdList → single row with port_id NULL (all ports)
  const targets = portIdList.length > 0 ? portIdList : [null];

  let label = '';
  if (uid) {
    const u = await pool.query(`SELECT username, email FROM users WHERE id = $1`, [uid]);
    label = u.rows[0]?.username || u.rows[0]?.email || `user ${uid}`;
  } else {
    const ro = await pool.query(`SELECT name FROM roles WHERE id = $1`, [rid]);
    label = ro.rows[0]?.name || `role ${rid}`;
  }

  const created = [];
  try {
    for (const pid of targets) {
      const ins = await pool.query(
        `INSERT INTO notification_event_recipients (event_key, user_id, role_id, port_id)
         VALUES ($1, $2, $3, $4)
         RETURNING id, event_key, user_id, role_id, port_id, created_at`,
        [eventKey, uid, rid, pid]
      );
      if (ins.rows[0]) created.push(ins.rows[0]);
    }
  } catch (err) {
    if (err?.code === '23505') {
      return res.status(409).json({ error: 'One or more recipient/port combinations already exist' });
    }
    throw err;
  }

  const portSummary =
    targets.length === 1 && targets[0] == null
      ? 'all ports'
      : `${targets.filter((p) => p != null).length} port(s)`;
  writeActivityLog({
    pageKey: ACTIVITY_PAGE_KEY,
    action: 'create',
    entityType: 'NotificationRecipient',
    entityId: created.map((r) => String(r.id)).join(','),
    entityLabel: label,
    summary: `Added recipient ${label} (${uid ? 'user' : 'role'}, ${portSummary}) for ${getEventLabel(eventKey)}`,
    actorUserId: req.userId ?? null,
  }).catch(() => {});

  res.status(201).json({
    created: created.length,
    items: created.map((row) => ({
      id: Number(row.id),
      eventKey: row.event_key,
      userId: row.user_id != null ? Number(row.user_id) : null,
      roleId: row.role_id != null ? Number(row.role_id) : null,
      portId: row.port_id != null ? Number(row.port_id) : null,
      createdAt: row.created_at,
    })),
  });
});

router.delete('/recipients/:id', async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const r = await pool.query(
    `DELETE FROM notification_event_recipients WHERE id = $1
     RETURNING id, event_key, user_id, role_id`,
    [id]
  );
  if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
  const row = r.rows[0];
  writeActivityLog({
    pageKey: ACTIVITY_PAGE_KEY,
    action: 'delete',
    entityType: 'NotificationRecipient',
    entityId: String(id),
    summary: `Removed recipient for ${getEventLabel(row.event_key)}`,
    actorUserId: req.userId ?? null,
  }).catch(() => {});
  res.json({ ok: true });
});

router.get('/smtp', async (_req, res) => {
  const cfg = await getSmtpConfigForAdmin(pool);
  res.json(cfg);
});

router.put('/smtp', async (req, res) => {
  const body = req.body || {};
  await saveSmtpConfig(
    pool,
    {
      host: body.host,
      port: body.port,
      secure: body.secure,
      user: body.user,
      password: body.password,
      fromAddress: body.fromAddress,
      rejectUnauthorized: body.rejectUnauthorized,
      enabled: body.enabled,
    },
    req.userId ?? null
  );
  const host = body.host != null ? String(body.host).trim() : '';
  const port = body.port != null ? Number(body.port) : 465;
  writeActivityLog({
    pageKey: ACTIVITY_PAGE_KEY,
    action: 'update',
    entityType: 'SmtpConfig',
    entityId: '1',
    summary: `Updated SMTP configuration (host: ${host || '—'}, port: ${port})`,
    actorUserId: req.userId ?? null,
  }).catch(() => {});
  res.json(await getSmtpConfigForAdmin(pool));
});

router.post('/smtp/test', async (req, res) => {
  const userR = await pool.query(
    `SELECT id, email, username FROM users WHERE id = $1 AND deleted_at IS NULL`,
    [req.userId]
  );
  const user = userR.rows[0];
  const to = user?.email ? String(user.email).trim() : '';
  if (!to || !isValidRecipientEmail(to)) {
    return res.status(400).json({ error: 'Your user account has no valid email address' });
  }
  const smtp = await getSmtpTransport(pool);
  if (!smtp) {
    return res.status(400).json({ error: 'SMTP not configured — set up in Admin → Notifications' });
  }
  const from = await getFromAddress(pool);
  const subject = 'Jetty Planning System — SMTP test';
  const text =
    'This is a test email from Jetty Planning System notification settings.\n\nIf you received this, SMTP is configured correctly.';
  try {
    const info = await smtp.sendMail({ from, to, subject, text });
    const correlationId = `smtp_test:${req.userId}:${Date.now()}`;
    const ins = await pool.query(
      `INSERT INTO notifications (user_id, port_id, event_key, kind, title, body, payload, correlation_id)
       VALUES ($1, NULL, 'notification.email_echo', 'email_sent', $2, $3, $4::jsonb, $5)
       RETURNING id`,
      [
        req.userId,
        subject,
        text,
        JSON.stringify({ detail: 'SMTP test email', test: true }),
        correlationId,
      ]
    );
    const nid = ins.rows[0]?.id;
    if (nid) {
      await pool.query(
        `INSERT INTO notification_deliveries (notification_id, channel, status, provider_message_id)
         VALUES ($1, 'email', 'sent', $2)`,
        [nid, info?.messageId ?? null]
      );
    }
    writeActivityLog({
      pageKey: ACTIVITY_PAGE_KEY,
      action: 'create',
      entityType: 'SmtpTest',
      summary: `Sent SMTP test email to ${to}`,
      meta: { success: true, messageId: info?.messageId ?? null },
      actorUserId: req.userId ?? null,
    }).catch(() => {});
    res.json({ ok: true, to, messageId: info?.messageId ?? null });
  } catch (err) {
    const msg = err?.message || String(err);
    writeActivityLog({
      pageKey: ACTIVITY_PAGE_KEY,
      action: 'create',
      entityType: 'SmtpTest',
      summary: `SMTP test email failed: ${msg.slice(0, 200)}`,
      meta: { success: false, error: msg.slice(0, 500) },
      actorUserId: req.userId ?? null,
    }).catch(() => {});
    res.status(502).json({ error: msg });
  }
});

router.get('/deliveries', async (req, res) => {
  const limitRaw = parseInt(req.query.limit, 10);
  const limit = Number.isNaN(limitRaw) ? 50 : Math.max(1, Math.min(limitRaw, 200));
  const status = (req.query.status || '').toString().trim();
  const eventKey = (req.query.eventKey || '').toString().trim();
  const portIdRaw = req.query.portId;
  const portId = portIdRaw != null && portIdRaw !== '' ? Number(portIdRaw) : null;
  const fromDate = (req.query.from || '').toString().trim();
  const toDate = (req.query.to || '').toString().trim();
  const q = (req.query.q || '').toString().trim();
  const cursor = (req.query.cursor || '').toString();

  const params = [];
  let paramIdx = 1;
  let sql = `
    SELECT nd.id, nd.status, nd.error_text, nd.provider_message_id,
           nd.created_at AS queued_at, nd.updated_at,
           n.event_key, n.title, n.payload, n.port_id,
           u.email AS recipient_email, u.username AS recipient_username,
           p.name AS port_name
    FROM notification_deliveries nd
    JOIN notifications n ON n.id = nd.notification_id
    JOIN users u ON u.id = n.user_id
    LEFT JOIN ports p ON p.id = n.port_id
    WHERE nd.channel = 'email'`;

  if (status) {
    params.push(status);
    sql += ` AND nd.status = $${paramIdx++}`;
  }
  if (eventKey) {
    params.push(eventKey);
    sql += ` AND n.event_key = $${paramIdx++}`;
  }
  if (portId != null && !Number.isNaN(portId)) {
    params.push(portId);
    sql += ` AND n.port_id = $${paramIdx++}`;
  }
  if (fromDate) {
    params.push(fromDate);
    sql += ` AND nd.updated_at >= $${paramIdx++}::date`;
  }
  if (toDate) {
    params.push(toDate);
    sql += ` AND nd.updated_at < ($${paramIdx++}::date + interval '1 day')`;
  }
  if (q) {
    params.push(`%${q}%`);
    sql += ` AND (u.email ILIKE $${paramIdx} OR u.username ILIKE $${paramIdx}
      OR n.title ILIKE $${paramIdx} OR n.payload::text ILIKE $${paramIdx})`;
    paramIdx += 1;
  }

  let cursorTime = null;
  let cursorId = null;
  if (cursor) {
    const [t, id] = cursor.split('|');
    const d = new Date(t);
    const n = parseInt(id, 10);
    if (!Number.isNaN(d.getTime()) && !Number.isNaN(n)) {
      cursorTime = d.toISOString();
      cursorId = n;
    }
  }
  if (cursorTime && cursorId) {
    params.push(cursorTime, cursorId);
    sql += ` AND (nd.updated_at, nd.id) < ($${paramIdx}::timestamptz, $${paramIdx + 1}::bigint)`;
    paramIdx += 2;
  }

  params.push(limit + 1);
  sql += ` ORDER BY nd.updated_at DESC, nd.id DESC LIMIT $${paramIdx}`;

  const r = await pool.query(sql, params);
  const rows = r.rows || [];
  const hasMore = rows.length > limit;
  const sliced = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore
    ? `${sliced[sliced.length - 1].updated_at.toISOString()}|${sliced[sliced.length - 1].id}`
    : null;

  res.json({
    items: sliced.map((row) => {
      const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
      return {
        id: Number(row.id),
        status: row.status,
        recipientEmail: row.recipient_email,
        recipientUsername: row.recipient_username,
        eventKey: row.event_key,
        eventLabel: getEventLabel(row.event_key),
        subject: row.title,
        portId: row.port_id != null ? Number(row.port_id) : null,
        portName: row.port_name,
        vesselName: payload.vesselName || null,
        jettyOperationCode: payload.jettyOperationCode || null,
        errorText: row.error_text,
        providerMessageId: row.provider_message_id,
        queuedAt: row.queued_at,
        updatedAt: row.updated_at,
      };
    }),
    nextCursor,
  });
});

export default router;
