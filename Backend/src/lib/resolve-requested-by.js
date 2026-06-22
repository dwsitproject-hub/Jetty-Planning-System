/**
 * Resolve a human-readable requestor label for shipment_plans.requested_by.
 * Prefers display_name, falls back to username.
 */
export async function resolveUserRequestedBy(db, userId) {
  if (userId == null) return null;
  const r = await db.query(
    `SELECT username, display_name FROM users WHERE id = $1 AND deleted_at IS NULL`,
    [userId]
  );
  if (r.rows.length === 0) return null;
  const row = r.rows[0];
  const display = typeof row.display_name === 'string' ? row.display_name.trim() : '';
  if (display) return display;
  const username = typeof row.username === 'string' ? row.username.trim() : '';
  return username || null;
}
