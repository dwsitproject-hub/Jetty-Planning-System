/**
 * Activity logs read API (paginated, RBAC protected).
 */
import express from 'express';
import { pool } from '../db.js';
import { requirePageView } from '../middleware/permissions.js';

const router = express.Router();

// View permission is "page:activity-log"
router.get('/', ...requirePageView('activity-log'), async (req, res) => {
  const pageKey = (req.query.page_key || '').toString().trim();
  if (!pageKey) return res.status(400).json({ error: 'page_key is required' });

  const limitRaw = parseInt(req.query.limit, 10);
  const limit = Number.isNaN(limitRaw) ? 50 : Math.max(1, Math.min(limitRaw, 200));

  // Cursor pagination: cursor = "<created_at_iso>|<id>"
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

  const params = [pageKey, limit + 1];
  let sql = `
    SELECT id, page_key, action, entity_type, entity_id, entity_label,
           summary, changes_json, meta_json,
           actor_user_id, actor_username,
           created_at
    FROM activity_logs
    WHERE deleted_at IS NULL
      AND page_key = $1`;
  if (cursorTime && cursorId) {
    params.push(cursorTime, cursorId);
    sql += ` AND (created_at, id) < ($3::timestamptz, $4::bigint)`;
  }
  sql += ` ORDER BY created_at DESC, id DESC LIMIT $2`;

  const r = await pool.query(sql, params);
  const rows = r.rows || [];
  const hasMore = rows.length > limit;
  const sliced = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore
    ? `${sliced[sliced.length - 1].created_at.toISOString()}|${sliced[sliced.length - 1].id}`
    : null;

  res.json({
    items: sliced.map((row) => ({
      id: row.id,
      pageKey: row.page_key,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      entityLabel: row.entity_label,
      summary: row.summary,
      changes: row.changes_json ?? null,
      meta: row.meta_json ?? null,
      actorUserId: row.actor_user_id,
      actorUsername: row.actor_username,
      createdAt: row.created_at,
    })),
    nextCursor,
  });
});

export default router;

