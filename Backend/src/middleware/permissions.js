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

