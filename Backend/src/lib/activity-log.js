import { pool } from '../db.js';

export async function writeActivityLog({
  pageKey,
  action,
  entityType,
  entityId,
  entityLabel,
  summary,
  changes,
  meta,
  actorUserId,
}) {
  if (!pageKey || !action || !summary) return;
  let actorUsername = null;
  if (actorUserId) {
    const u = await pool.query(`SELECT username FROM users WHERE id = $1 AND deleted_at IS NULL`, [actorUserId]);
    actorUsername = u.rows[0]?.username ?? null;
  }
  await pool.query(
    `INSERT INTO activity_logs (
       page_key, action, entity_type, entity_id, entity_label, summary, changes_json, meta_json,
       actor_user_id, actor_username
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      pageKey,
      action,
      entityType ?? null,
      entityId != null ? String(entityId) : null,
      entityLabel ?? null,
      summary,
      changes ? JSON.stringify(changes) : null,
      meta ? JSON.stringify(meta) : null,
      actorUserId ?? null,
      actorUsername,
    ]
  );
}

