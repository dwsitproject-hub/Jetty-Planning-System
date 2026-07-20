/**
 * Resolve notification recipients from admin config (users + roles + port scope).
 */

/**
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {string} eventKey
 * @param {number | null} portId
 * @param {{ emailOnly?: boolean }} [opts]
 * @returns {Promise<number[]>}
 */
export async function resolveEventRecipients(db, eventKey, portId, opts = {}) {
  const { emailOnly = false } = opts;
  const configured = await db.query(
    `SELECT id, user_id, role_id, port_id FROM notification_event_recipients WHERE event_key = $1`,
    [eventKey]
  );
  const rows = configured.rows || [];
  const userIds = new Set();

  for (const row of rows) {
    if (row.user_id) {
      if (row.port_id != null && portId != null && Number(row.port_id) !== Number(portId)) continue;
      userIds.add(Number(row.user_id));
      continue;
    }
    if (row.role_id) {
      const params = [row.role_id];
      let portFilter = '';
      if (row.port_id != null) {
        params.push(row.port_id);
        portFilter = ` AND up.port_id = $2 AND up.deleted_at IS NULL`;
      } else if (portId != null) {
        params.push(portId);
        portFilter = ` AND up.port_id = $2 AND up.deleted_at IS NULL`;
      }
      const roleUsers = await db.query(
        `SELECT DISTINCT ur.user_id
         FROM user_roles ur
         JOIN users u ON u.id = ur.user_id AND u.deleted_at IS NULL AND u.is_active = TRUE
         LEFT JOIN user_ports up ON up.user_id = u.id AND up.deleted_at IS NULL
         WHERE ur.deleted_at IS NULL AND ur.role_id = $1
         ${portFilter}`,
        params
      );
      for (const u of roleUsers.rows) userIds.add(Number(u.user_id));
    }
  }

  if (userIds.size === 0) {
    return resolveFallbackPortUsers(db, portId, emailOnly);
  }

  const ids = [...userIds];
  if (!emailOnly && portId == null) return ids;

  const filtered = await filterActiveUsersForPort(db, ids, portId, emailOnly);
  return filtered;
}

/**
 * Fallback: users assigned to port with at-berth page view.
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {number | null} portId
 * @param {boolean} emailOnly
 */
async function resolveFallbackPortUsers(db, portId, emailOnly) {
  if (portId == null) return [];
  const r = await db.query(
    `SELECT DISTINCT u.id AS user_id
     FROM user_ports up
     JOIN users u ON u.id = up.user_id AND u.deleted_at IS NULL AND u.is_active = TRUE
     JOIN user_roles ur ON ur.user_id = u.id AND ur.deleted_at IS NULL
     JOIN role_permissions rp ON rp.role_id = ur.role_id AND rp.deleted_at IS NULL AND rp.can_view = TRUE
     JOIN permissions p ON p.id = rp.permission_id AND p.deleted_at IS NULL
       AND p.resource_type = 'page' AND p.resource_key = 'at-berth'
     WHERE up.deleted_at IS NULL AND up.port_id = $1
       ${emailOnly ? `AND u.email IS NOT NULL AND TRIM(u.email) <> ''` : ''}`,
    [portId]
  );
  return r.rows.map((row) => Number(row.user_id));
}

/**
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {number[]} userIds
 * @param {number | null} portId
 * @param {boolean} emailOnly
 */
async function filterActiveUsersForPort(db, userIds, portId, emailOnly) {
  if (userIds.length === 0) return [];
  const params = [userIds];
  let sql = `
    SELECT DISTINCT u.id AS user_id
    FROM users u
    WHERE u.deleted_at IS NULL AND u.is_active = TRUE AND u.id = ANY($1::bigint[])`;
  if (emailOnly) sql += ` AND u.email IS NOT NULL AND TRIM(u.email) <> ''`;
  if (portId != null) {
    params.push(portId);
    sql += `
      AND EXISTS (
        SELECT 1 FROM user_ports up
        WHERE up.user_id = u.id AND up.port_id = $2 AND up.deleted_at IS NULL
      )`;
  }
  const r = await db.query(sql, params);
  return r.rows.map((row) => Number(row.user_id));
}

/**
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {string} eventKey
 */
export async function loadEventSettings(db, eventKey) {
  const r = await db.query(
    `SELECT event_key, enabled, in_app_enabled, email_enabled,
            include_post_signoff_breach, daily_send_hour, updated_at
     FROM notification_event_settings WHERE event_key = $1`,
    [eventKey]
  );
  return r.rows[0] ?? null;
}

/**
 * @param {import('pg').Pool | import('pg').PoolClient} db
 */
export async function loadAllEventSettings(db) {
  const r = await db.query(
    `SELECT s.event_key, s.enabled, s.in_app_enabled, s.email_enabled,
            s.include_post_signoff_breach, s.daily_send_hour, s.updated_at,
            (SELECT COUNT(*)::int FROM notification_event_recipients r WHERE r.event_key = s.event_key) AS recipient_count
     FROM notification_event_settings s
     ORDER BY s.event_key`
  );
  return r.rows;
}
