/**
 * RBAC admin: roles, permissions, role↔permission, user↔role (all soft-delete aware).
 * Base path: /api/v1/rbac — all routes require JWT.
 */
import express from 'express';
import { pool } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { writeActivityLog } from '../lib/activity-log.js';

const router = express.Router();
router.use(requireAuth);

// --- More specific routes first ---

/** Current user's page permissions (merged across roles). */
router.get('/me/page-permissions', async (req, res) => {
  const userId = req.userId;
  const result = await pool.query(
    `SELECT p.resource_key,
            BOOL_OR(rp.can_view) AS can_view,
            BOOL_OR(rp.can_edit) AS can_edit,
            BOOL_OR(rp.can_delete) AS can_delete,
            BOOL_OR(rp.can_approve) AS can_approve
     FROM user_roles ur
     JOIN role_permissions rp
       ON rp.role_id = ur.role_id
      AND rp.deleted_at IS NULL
     JOIN permissions p
       ON p.id = rp.permission_id
      AND p.deleted_at IS NULL
     WHERE ur.user_id = $1
       AND ur.deleted_at IS NULL
       AND p.resource_type = 'page'
     GROUP BY p.resource_key
     ORDER BY p.resource_key`,
    [userId]
  );

  res.json(
    result.rows.map((r) => ({
      resourceKey: r.resource_key,
      canView: r.can_view,
      canEdit: r.can_edit,
      canDelete: r.can_delete,
      canApprove: r.can_approve,
    }))
  );
});

/** All page permissions for a role (assigned or not). */
router.get('/roles/:roleId/page-permissions', async (req, res) => {
  const roleId = parseInt(req.params.roleId, 10);
  if (Number.isNaN(roleId)) return res.status(400).json({ error: 'Invalid roleId' });
  const role = await pool.query('SELECT id FROM roles WHERE id = $1 AND deleted_at IS NULL', [roleId]);
  if (role.rows.length === 0) return res.status(404).json({ error: 'Role not found' });
  const result = await pool.query(
    `SELECT p.id, p.resource_type, p.resource_key,
            COALESCE(rp.can_view, FALSE) AS can_view,
            COALESCE(rp.can_edit, FALSE) AS can_edit,
            COALESCE(rp.can_delete, FALSE) AS can_delete,
            COALESCE(rp.can_approve, FALSE) AS can_approve,
            p.created_at,
            COALESCE(rp.updated_at, p.updated_at) AS updated_at
     FROM permissions p
     LEFT JOIN role_permissions rp
       ON rp.permission_id = p.id
      AND rp.role_id = $1
      AND rp.deleted_at IS NULL
     WHERE p.deleted_at IS NULL
       AND p.resource_type = 'page'
     ORDER BY p.resource_key`,
    [roleId]
  );
  res.json(
    result.rows.map((row) => ({
      ...toPermission(row),
      canApprove: row.can_approve,
    }))
  );
});

/** Page permissions linked to a role (per-role flags). */
router.get('/roles/:roleId/permissions', async (req, res) => {
  const roleId = parseInt(req.params.roleId, 10);
  if (Number.isNaN(roleId)) return res.status(400).json({ error: 'Invalid roleId' });
  const role = await pool.query('SELECT id FROM roles WHERE id = $1 AND deleted_at IS NULL', [roleId]);
  if (role.rows.length === 0) return res.status(404).json({ error: 'Role not found' });
  const result = await pool.query(
    `SELECT p.id, p.resource_type, p.resource_key,
            rp.can_view, rp.can_edit, rp.can_delete,
            rp.created_at, rp.updated_at
     FROM role_permissions rp
     JOIN permissions p ON p.id = rp.permission_id AND p.deleted_at IS NULL
     WHERE rp.role_id = $1 AND rp.deleted_at IS NULL
     ORDER BY p.resource_type, p.resource_key`,
    [roleId]
  );
  res.json(result.rows.map(toPermission));
});

router.post('/roles/:roleId/permissions', async (req, res) => {
  const roleId = parseInt(req.params.roleId, 10);
  if (Number.isNaN(roleId)) return res.status(400).json({ error: 'Invalid roleId' });
  const { permission_id, can_view, can_edit, can_delete, can_approve } = req.body || {};
  const permId = parseInt(permission_id, 10);
  if (Number.isNaN(permId)) return res.status(400).json({ error: 'permission_id is required' });
  if (
    can_view === undefined &&
    can_edit === undefined &&
    can_delete === undefined &&
    can_approve === undefined
  ) {
    return res.status(400).json({
      error: 'At least one flag is required: can_view, can_edit, can_delete, can_approve',
    });
  }
  const r = await pool.query('SELECT id FROM roles WHERE id = $1 AND deleted_at IS NULL', [roleId]);
  if (r.rows.length === 0) return res.status(404).json({ error: 'Role not found' });
  const p = await pool.query('SELECT id FROM permissions WHERE id = $1 AND deleted_at IS NULL', [permId]);
  if (p.rows.length === 0) return res.status(404).json({ error: 'Permission not found' });
  const roleName = await pool.query('SELECT name FROM roles WHERE id = $1 AND deleted_at IS NULL', [roleId]);
  const permKey = await pool.query(
    'SELECT resource_key FROM permissions WHERE id = $1 AND deleted_at IS NULL',
    [permId]
  );
  const roleLabel = roleName.rows[0]?.name ?? `Role-${roleId}`;
  const permissionLabel = permKey.rows[0]?.resource_key ?? `permission-${permId}`;
  const active = await pool.query(
    `SELECT 1 FROM role_permissions WHERE role_id = $1 AND permission_id = $2 AND deleted_at IS NULL`,
    [roleId, permId]
  );
  if (active.rows.length > 0) {
    // Update flags on existing assignment (idempotent)
    await pool.query(
      `UPDATE role_permissions SET
         can_view = COALESCE($1, can_view),
         can_edit = COALESCE($2, can_edit),
         can_delete = COALESCE($3, can_delete),
         can_approve = COALESCE($4, can_approve),
         updated_at = NOW()
       WHERE role_id = $5 AND permission_id = $6 AND deleted_at IS NULL`,
      [
        can_view === undefined ? null : Boolean(can_view),
        can_edit === undefined ? null : Boolean(can_edit),
        can_delete === undefined ? null : Boolean(can_delete),
        can_approve === undefined ? null : Boolean(can_approve),
        roleId,
        permId,
      ]
    );
    await writeActivityLog({
      pageKey: 'admin',
      action: 'update',
      entityType: 'Role permission',
      entityId: `${roleId}:${permId}`,
      entityLabel: `${roleLabel} → ${permissionLabel}`,
      summary: `Role permissions updated: ${roleLabel} → ${permissionLabel}`,
      actorUserId: req.userId,
      meta: { roleId, permissionId: permId, permissionKey: permissionLabel },
    });
    return res.status(200).json({ roleId, permissionId: permId, assigned: true, alreadyAssigned: true });
  }
  const revive = await pool.query(
    `UPDATE role_permissions SET
       deleted_at = NULL,
       can_view = $3,
       can_edit = $4,
       can_delete = $5,
       can_approve = $6,
       updated_at = NOW()
     WHERE role_id = $1 AND permission_id = $2 AND deleted_at IS NOT NULL RETURNING id`,
    [
      roleId,
      permId,
      Boolean(can_view),
      Boolean(can_edit),
      Boolean(can_delete),
      Boolean(can_approve),
    ]
  );
  if (revive.rowCount === 0) {
    await pool.query(
      `INSERT INTO role_permissions (role_id, permission_id, can_view, can_edit, can_delete, can_approve)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        roleId,
        permId,
        Boolean(can_view),
        Boolean(can_edit),
        Boolean(can_delete),
        Boolean(can_approve),
      ]
    );
  }
  await writeActivityLog({
    pageKey: 'admin',
    action: 'update',
    entityType: 'Role permission',
    entityId: `${roleId}:${permId}`,
    entityLabel: `${roleLabel} → ${permissionLabel}`,
    summary: `Role permissions updated: ${roleLabel} → ${permissionLabel}`,
    actorUserId: req.userId,
    meta: { roleId, permissionId: permId, permissionKey: permissionLabel },
  });
  res.status(201).json({ roleId, permissionId: permId, assigned: true });
});

router.delete('/roles/:roleId/permissions/:permissionId', async (req, res) => {
  const roleId = parseInt(req.params.roleId, 10);
  const permissionId = parseInt(req.params.permissionId, 10);
  if (Number.isNaN(roleId) || Number.isNaN(permissionId)) {
    return res.status(400).json({ error: 'Invalid id' });
  }
  const result = await pool.query(
    `UPDATE role_permissions SET deleted_at = NOW() WHERE role_id = $1 AND permission_id = $2 AND deleted_at IS NULL RETURNING id`,
    [roleId, permissionId]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: 'Assignment not found' });
  res.status(204).send();
});

/** Roles assigned to a user */
router.get('/users/:userId/roles', async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  if (Number.isNaN(userId)) return res.status(400).json({ error: 'Invalid userId' });
  const u = await pool.query('SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL', [userId]);
  if (u.rows.length === 0) return res.status(404).json({ error: 'User not found' });
  const result = await pool.query(
    `SELECT r.id, r.name, r.description, r.is_system_role, r.created_at, r.updated_at
     FROM user_roles ur
     JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL
     WHERE ur.user_id = $1 AND ur.deleted_at IS NULL
     ORDER BY r.name`,
    [userId]
  );
  res.json(result.rows.map(toRole));
});

router.post('/users/:userId/roles', async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  if (Number.isNaN(userId)) return res.status(400).json({ error: 'Invalid userId' });
  const { role_id } = req.body || {};
  const roleId = parseInt(role_id, 10);
  if (Number.isNaN(roleId)) return res.status(400).json({ error: 'role_id is required' });
  const u = await pool.query('SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL', [userId]);
  if (u.rows.length === 0) return res.status(404).json({ error: 'User not found' });
  const r = await pool.query('SELECT id FROM roles WHERE id = $1 AND deleted_at IS NULL', [roleId]);
  if (r.rows.length === 0) return res.status(404).json({ error: 'Role not found' });
  const active = await pool.query(
    `SELECT 1 FROM user_roles WHERE user_id = $1 AND role_id = $2 AND deleted_at IS NULL`,
    [userId, roleId]
  );
  if (active.rows.length > 0) {
    return res.status(200).json({ userId, roleId, assigned: true, alreadyAssigned: true });
  }
  const revive = await pool.query(
    `UPDATE user_roles SET deleted_at = NULL WHERE user_id = $1 AND role_id = $2 AND deleted_at IS NOT NULL RETURNING id`,
    [userId, roleId]
  );
  if (revive.rowCount === 0) {
    await pool.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`, [userId, roleId]);
  }
  res.status(201).json({ userId, roleId, assigned: true });
});

router.delete('/users/:userId/roles/:roleId', async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  const roleId = parseInt(req.params.roleId, 10);
  if (Number.isNaN(userId) || Number.isNaN(roleId)) {
    return res.status(400).json({ error: 'Invalid id' });
  }
  const result = await pool.query(
    `UPDATE user_roles SET deleted_at = NOW() WHERE user_id = $1 AND role_id = $2 AND deleted_at IS NULL RETURNING id`,
    [userId, roleId]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: 'Assignment not found' });
  res.status(204).send();
});

// --- Roles CRUD ---

router.get('/roles', async (req, res) => {
  const result = await pool.query(
    `SELECT id, name, description, is_system_role, created_at, updated_at
     FROM roles WHERE deleted_at IS NULL ORDER BY name ASC`
  );
  res.json(result.rows.map(toRole));
});

router.post('/roles', async (req, res) => {
  const { name, description, is_system_role } = req.body || {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  const sys = Boolean(is_system_role);
  const result = await pool.query(
    `INSERT INTO roles (name, description, is_system_role)
     VALUES ($1, $2, $3)
     RETURNING id, name, description, is_system_role, created_at, updated_at`,
    [name.trim(), description?.trim() ?? null, sys]
  );
  await writeActivityLog({
    pageKey: 'admin',
    action: 'add',
    entityType: 'Role',
    entityId: result.rows[0]?.id,
    entityLabel: result.rows[0]?.name,
    summary: `Role created: ${result.rows[0]?.name || '—'}`,
    actorUserId: req.userId,
  });
  res.status(201).json(toRole(result.rows[0]));
});

router.get('/roles/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const result = await pool.query(
    `SELECT id, name, description, is_system_role, created_at, updated_at
     FROM roles WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Role not found' });
  res.json(toRole(result.rows[0]));
});

router.put('/roles/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const { name, description } = req.body || {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  const result = await pool.query(
    `UPDATE roles SET name = $1, description = $2, updated_at = NOW()
     WHERE id = $3 AND deleted_at IS NULL
     RETURNING id, name, description, is_system_role, created_at, updated_at`,
    [name.trim(), description?.trim() ?? null, id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Role not found' });
  await writeActivityLog({
    pageKey: 'admin',
    action: 'update',
    entityType: 'Role',
    entityId: id,
    entityLabel: result.rows[0]?.name,
    summary: `Role updated: ${result.rows[0]?.name || `Role-${id}`}`,
    actorUserId: req.userId,
  });
  res.json(toRole(result.rows[0]));
});

router.delete('/roles/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const role = await pool.query(
    'SELECT is_system_role FROM roles WHERE id = $1 AND deleted_at IS NULL',
    [id]
  );
  if (role.rows.length === 0) return res.status(404).json({ error: 'Role not found' });
  if (role.rows[0].is_system_role) {
    return res.status(403).json({ error: 'Cannot delete system role' });
  }
  const roleLabel = await pool.query('SELECT name FROM roles WHERE id = $1 AND deleted_at IS NULL', [id]);
  const roleName = roleLabel.rows[0]?.name ?? `Role-${id}`;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE role_permissions SET deleted_at = NOW() WHERE role_id = $1 AND deleted_at IS NULL`,
      [id]
    );
    await client.query(
      `UPDATE user_roles SET deleted_at = NOW() WHERE role_id = $1 AND deleted_at IS NULL`,
      [id]
    );
    await client.query(
      `UPDATE roles SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    await client.query('COMMIT');
    await writeActivityLog({
      pageKey: 'admin',
      action: 'delete',
      entityType: 'Role',
      entityId: id,
      entityLabel: roleName,
      summary: `Role deleted: ${roleName}`,
      actorUserId: req.userId,
    });
    res.status(204).send();
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});

// --- Permissions CRUD ---

router.get('/permissions', async (req, res) => {
  const { resource_type } = req.query;
  let sql = `SELECT id, resource_type, resource_key, can_view, can_edit, can_delete, created_at, updated_at
             FROM permissions WHERE deleted_at IS NULL`;
  const params = [];
  if (resource_type) {
    sql += ` AND resource_type = $1`;
    params.push(resource_type);
  }
  sql += ` ORDER BY resource_type, resource_key`;
  const result = await pool.query(sql, params);
  res.json(result.rows.map(toPermission));
});

router.post('/permissions', async (req, res) => {
  const { resource_type, resource_key, can_view, can_edit, can_delete } = req.body || {};
  const validTypes = ['department', 'page', 'field'];
  if (!resource_type || !validTypes.includes(resource_type)) {
    return res.status(400).json({ error: 'resource_type must be department, page, or field' });
  }
  if (!resource_key || typeof resource_key !== 'string' || !resource_key.trim()) {
    return res.status(400).json({ error: 'resource_key is required' });
  }
  const result = await pool.query(
    `INSERT INTO permissions (resource_type, resource_key, can_view, can_edit, can_delete)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, resource_type, resource_key, can_view, can_edit, can_delete, created_at, updated_at`,
    [
      resource_type,
      resource_key.trim(),
      Boolean(can_view),
      Boolean(can_edit),
      Boolean(can_delete),
    ]
  );
  res.status(201).json(toPermission(result.rows[0]));
});

router.get('/permissions/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const result = await pool.query(
    `SELECT id, resource_type, resource_key, can_view, can_edit, can_delete, created_at, updated_at
     FROM permissions WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Permission not found' });
  res.json(toPermission(result.rows[0]));
});

router.put('/permissions/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const { resource_type, resource_key, can_view, can_edit, can_delete } = req.body || {};
  const validTypes = ['department', 'page', 'field'];
  if (resource_type && !validTypes.includes(resource_type)) {
    return res.status(400).json({ error: 'Invalid resource_type' });
  }
  if (resource_key !== undefined && (typeof resource_key !== 'string' || !resource_key.trim())) {
    return res.status(400).json({ error: 'resource_key must be non-empty' });
  }
  const updates = [];
  const values = [];
  let i = 1;
  if (resource_type) {
    updates.push(`resource_type = $${i++}`);
    values.push(resource_type);
  }
  if (resource_key !== undefined) {
    updates.push(`resource_key = $${i++}`);
    values.push(resource_key.trim());
  }
  if (can_view !== undefined) {
    updates.push(`can_view = $${i++}`);
    values.push(Boolean(can_view));
  }
  if (can_edit !== undefined) {
    updates.push(`can_edit = $${i++}`);
    values.push(Boolean(can_edit));
  }
  if (can_delete !== undefined) {
    updates.push(`can_delete = $${i++}`);
    values.push(Boolean(can_delete));
  }
  if (updates.length === 0) {
    const r = await pool.query(
      `SELECT id, resource_type, resource_key, can_view, can_edit, can_delete, created_at, updated_at
       FROM permissions WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Permission not found' });
    return res.json(toPermission(r.rows[0]));
  }
  updates.push('updated_at = NOW()');
  values.push(id);
  const result = await pool.query(
    `UPDATE permissions SET ${updates.join(', ')} WHERE id = $${i} AND deleted_at IS NULL
     RETURNING id, resource_type, resource_key, can_view, can_edit, can_delete, created_at, updated_at`,
    values
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Permission not found' });
  res.json(toPermission(result.rows[0]));
});

router.delete('/permissions/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE role_permissions SET deleted_at = NOW() WHERE permission_id = $1 AND deleted_at IS NULL`,
      [id]
    );
    const del = await client.query(
      `UPDATE permissions SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
      [id]
    );
    if (del.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Permission not found' });
    }
    await client.query('COMMIT');
    res.status(204).send();
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});

function toRole(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    isSystemRole: row.is_system_role,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toPermission(row) {
  return {
    id: row.id,
    resourceType: row.resource_type,
    resourceKey: row.resource_key,
    canView: row.can_view,
    canEdit: row.can_edit,
    canDelete: row.can_delete,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export default router;
