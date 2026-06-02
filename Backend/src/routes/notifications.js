/**
 * In-app notification list, unread count, mark read (current user).
 */
import express from 'express';
import { pool } from '../db.js';
import { loadUserAssignedPorts } from '../middleware/port-scope.js';

const router = express.Router();

function isUndefinedTable(err) {
  return err?.code === '42P01';
}

function handleDbError(res, err) {
  if (isUndefinedTable(err)) {
    res.status(503).json({
      error:
        'Notifications are not available: database tables are missing. Apply migrations (e.g. npm run migrate) including 070_central_notifications.sql.',
    });
    return true;
  }
  return false;
}

async function assignedPortIdsForUser(req, res, next) {
  try {
    if (req.userId == null || Number.isNaN(Number(req.userId))) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const ports = await loadUserAssignedPorts(req.userId);
    req.notificationPortIds = ports.map((p) => Number(p.id));
    next();
  } catch (e) {
    next(e);
  }
}

router.use(assignedPortIdsForUser);

function rowToDto(row) {
  let payload = {};
  if (row.payload != null && typeof row.payload === 'object' && !Array.isArray(row.payload)) {
    payload = row.payload;
  } else if (typeof row.payload === 'string') {
    try {
      const p = JSON.parse(row.payload);
      if (p && typeof p === 'object' && !Array.isArray(p)) payload = p;
    } catch {
      /* ignore */
    }
  }
  return {
    id: Number(row.id),
    portId: row.port_id != null ? Number(row.port_id) : null,
    eventKey: row.event_key,
    kind: row.kind,
    title: row.title,
    body: row.body,
    payload,
    readAt: row.read_at != null ? row.read_at.toISOString?.() ?? row.read_at : null,
    createdAt: row.created_at != null ? row.created_at.toISOString?.() ?? row.created_at : null,
  };
}

router.get('/unread-count', async (req, res) => {
  const userId = req.userId;
  const portIds = req.notificationPortIds || [];
  try {
    if (!portIds.length) {
      return res.json({ count: 0 });
    }
    const r = await pool.query(
      `SELECT COUNT(*)::int AS c
       FROM notifications n
       WHERE n.user_id = $1
         AND n.read_at IS NULL
         AND (n.port_id IS NULL OR n.port_id = ANY($2::bigint[]))`,
      [userId, portIds]
    );
    res.json({ count: r.rows[0]?.c ?? 0 });
  } catch (err) {
    if (handleDbError(res, err)) return;
    throw err;
  }
});

router.get('/', async (req, res) => {
  const userId = req.userId;
  const portIds = req.notificationPortIds || [];
  const limitRaw = parseInt(req.query.limit, 10);
  const limit = Number.isNaN(limitRaw) ? 30 : Math.max(1, Math.min(limitRaw, 100));
  const cursor = (req.query.cursor || '').toString();
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

  try {
    if (!portIds.length) {
      return res.json({ items: [], nextCursor: null });
    }

    const params = [userId, portIds, limit + 1];
    let sql = `
      SELECT n.id, n.port_id, n.event_key, n.kind, n.title, n.body, n.payload, n.read_at, n.created_at
      FROM notifications n
      WHERE n.user_id = $1
        AND (n.port_id IS NULL OR n.port_id = ANY($2::bigint[]))`;
    if (cursorTime && cursorId) {
      params.push(cursorTime, cursorId);
      sql += ` AND (n.created_at, n.id) < ($${params.length - 1}::timestamptz, $${params.length}::bigint)`;
    }
    sql += ` ORDER BY n.created_at DESC, n.id DESC LIMIT $3`;

    const r = await pool.query(sql, params);
    const rows = r.rows || [];
    const hasMore = rows.length > limit;
    const sliced = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore
      ? `${sliced[sliced.length - 1].created_at.toISOString()}|${sliced[sliced.length - 1].id}`
      : null;

    res.json({
      items: sliced.map(rowToDto),
      nextCursor,
    });
  } catch (err) {
    if (handleDbError(res, err)) return;
    throw err;
  }
});

router.patch('/read', async (req, res) => {
  const userId = req.userId;
  const portIds = req.notificationPortIds || [];
  const body = req.body || {};
  const idsRaw = Array.isArray(body.ids) ? body.ids : [];
  const ids = idsRaw.map((x) => parseInt(String(x), 10)).filter((n) => Number.isFinite(n));
  const markAll = Boolean(body.all);

  try {
    if (!portIds.length) {
      return res.json({ updated: 0 });
    }

    if (markAll) {
      const r = await pool.query(
        `UPDATE notifications n
         SET read_at = COALESCE(read_at, NOW())
         WHERE n.user_id = $1
           AND n.read_at IS NULL
           AND (n.port_id IS NULL OR n.port_id = ANY($2::bigint[]))
         RETURNING id`,
        [userId, portIds]
      );
      return res.json({ updated: r.rowCount ?? r.rows?.length ?? 0 });
    }

    if (!ids.length) {
      return res.status(400).json({ error: 'ids array required, or all: true' });
    }

    const r = await pool.query(
      `UPDATE notifications n
       SET read_at = COALESCE(read_at, NOW())
       WHERE n.user_id = $1
         AND n.id = ANY($2::bigint[])
         AND (n.port_id IS NULL OR n.port_id = ANY($3::bigint[]))
       RETURNING id`,
      [userId, ids, portIds]
    );
    res.json({ updated: r.rowCount ?? r.rows?.length ?? 0 });
  } catch (err) {
    if (handleDbError(res, err)) return;
    throw err;
  }
});

export default router;
