/**
 * RBAC permission checks.
 * Uses permissions (resource_type/resource_key) linked via user_roles → role_permissions.
 */
import { pool } from '../db.js';
import { requireAuth } from './auth.js';

export function requirePageView(resourceKey) {
  return [
    requireAuth,
    async (req, res, next) => {
      const userId = req.userId;
      const result = await pool.query(
        `SELECT 1
         FROM user_roles ur
         JOIN role_permissions rp ON rp.role_id = ur.role_id AND rp.deleted_at IS NULL
         JOIN permissions p ON p.id = rp.permission_id AND p.deleted_at IS NULL
         WHERE ur.user_id = $1 AND ur.deleted_at IS NULL
           AND p.resource_type = 'page'
           AND p.resource_key = $2
           AND rp.can_view = TRUE
         LIMIT 1`,
        [userId, resourceKey]
      );
      if (result.rows.length === 0) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      next();
    },
  ];
}

/** Whether the user may approve Shipping Instructions (or other pages using can_approve). */
export async function userHasPageApprove(userId, resourceKey) {
  if (userId == null) return false;
  const result = await pool.query(
    `SELECT 1
     FROM user_roles ur
     JOIN role_permissions rp ON rp.role_id = ur.role_id AND rp.deleted_at IS NULL
     JOIN permissions p ON p.id = rp.permission_id AND p.deleted_at IS NULL
     WHERE ur.user_id = $1 AND ur.deleted_at IS NULL
       AND p.resource_type = 'page'
       AND p.resource_key = $2
       AND rp.can_approve = TRUE
     LIMIT 1`,
    [userId, resourceKey]
  );
  return result.rows.length > 0;
}

/** Whether the user may delete entities for this page (role flag can_delete). */
export async function userHasPageDelete(userId, resourceKey) {
  if (userId == null) return false;
  const result = await pool.query(
    `SELECT 1
     FROM user_roles ur
     JOIN role_permissions rp ON rp.role_id = ur.role_id AND rp.deleted_at IS NULL
     JOIN permissions p ON p.id = rp.permission_id AND p.deleted_at IS NULL
     WHERE ur.user_id = $1 AND ur.deleted_at IS NULL
       AND p.resource_type = 'page'
       AND p.resource_key = $2
       AND rp.can_delete = TRUE
     LIMIT 1`,
    [userId, resourceKey]
  );
  return result.rows.length > 0;
}

