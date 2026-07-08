/**
 * Ports CRUD — Phase 2 Master data.
 */
import express from 'express';
import { pool } from '../db.js';
import { requirePageDelete, requirePageEdit, requirePageView } from '../middleware/permissions.js';
import { writeActivityLog } from '../lib/activity-log.js';

const router = express.Router();
router.use(...requirePageView('master-port'));

router.get('/', async (req, res) => {
  const result = await pool.query(
    `SELECT id, name, description, schedule_timezone, created_at, updated_at
     FROM ports WHERE deleted_at IS NULL ORDER BY name ASC`
  );
  res.json(result.rows.map(toPort));
});

router.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const result = await pool.query(
    `SELECT id, name, description, schedule_timezone, created_at, updated_at FROM ports WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Port not found' });
  res.json(toPort(result.rows[0]));
});

const SCHEDULE_TZ_RE = /^[A-Za-z_/+-]+$/;

router.post('/', ...requirePageEdit('master-port'), async (req, res) => {
  const { name, description, scheduleTimezone } = req.body || {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  const tzRaw = scheduleTimezone != null ? String(scheduleTimezone).trim() : '';
  const tz = tzRaw || 'Asia/Jakarta';
  if (!SCHEDULE_TZ_RE.test(tz)) {
    return res.status(400).json({ error: 'Invalid scheduleTimezone (use IANA, e.g. Asia/Jakarta)' });
  }
  const result = await pool.query(
    `INSERT INTO ports (name, description, schedule_timezone) VALUES ($1, $2, $3)
     RETURNING id, name, description, schedule_timezone, created_at, updated_at`,
    [name.trim(), description?.trim() ?? null, tz]
  );
  writeActivityLog({
    pageKey: 'master-port',
    action: 'add',
    entityType: 'Port',
    entityId: result.rows[0].id,
    entityLabel: result.rows[0].name,
    summary: 'Created port',
    changes: [{ field: 'Name', from: null, to: result.rows[0].name }],
    actorUserId: req.userId ?? null,
  }).catch(() => {});
  res.status(201).json(toPort(result.rows[0]));
});

router.put('/:id', ...requirePageEdit('master-port'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const { name, description, scheduleTimezone } = req.body || {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  const tzRaw = scheduleTimezone != null ? String(scheduleTimezone).trim() : '';
  if (tzRaw && !SCHEDULE_TZ_RE.test(tzRaw)) {
    return res.status(400).json({ error: 'Invalid scheduleTimezone (use IANA, e.g. Asia/Jakarta)' });
  }
  const result = await pool.query(
    `UPDATE ports SET name = $1, description = $2,
       schedule_timezone = CASE WHEN $3::text IS NOT NULL AND $3::text <> '' THEN $3::text ELSE schedule_timezone END,
       updated_at = NOW()
     WHERE id = $4 AND deleted_at IS NULL RETURNING id, name, description, schedule_timezone, created_at, updated_at`,
    [name.trim(), description?.trim() ?? null, tzRaw || null, id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Port not found' });
  writeActivityLog({
    pageKey: 'master-port',
    action: 'update',
    entityType: 'Port',
    entityId: id,
    entityLabel: result.rows[0].name,
    summary: 'Updated port',
    changes: [{ field: 'Name', from: null, to: result.rows[0].name }],
    actorUserId: req.userId ?? null,
  }).catch(() => {});
  res.json(toPort(result.rows[0]));
});

/** Soft-delete (blocked if non-deleted jetties reference this port). */
router.delete('/:id', ...requirePageDelete('master-port'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

  const existing = await pool.query(
    `SELECT id, name FROM ports WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  if (existing.rows.length === 0) return res.status(404).json({ error: 'Port not found' });
  const portName = existing.rows[0].name;

  const j = await pool.query(
    `SELECT 1 FROM jetties WHERE port_id = $1 AND deleted_at IS NULL LIMIT 1`,
    [id]
  );
  if (j.rows.length > 0) {
    return res.status(409).json({ error: 'Cannot delete port while it has jetties; remove or delete jetties first' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE user_ports SET deleted_at = NOW(), updated_at = NOW()
       WHERE port_id = $1 AND deleted_at IS NULL`,
      [id]
    );
    const result = await client.query(
      `UPDATE ports SET deleted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
      [id]
    );
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Port not found' });
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  writeActivityLog({
    pageKey: 'master-port',
    action: 'delete',
    entityType: 'Port',
    entityId: id,
    entityLabel: portName,
    summary: `Deleted port "${portName}"`,
    meta: { portId: id, portName },
    actorUserId: req.userId ?? null,
  }).catch(() => {});
  res.status(204).send();
});

/**
 * Deprecated: port-centric user assignment.
 * Ownership has moved to user-centric APIs in /users/:id/ports.
 * Kept temporarily for backward compatibility during transition.
 */
router.get('/:id/users', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

  const port = await pool.query(`SELECT id FROM ports WHERE id = $1 AND deleted_at IS NULL`, [id]);
  if (port.rows.length === 0) return res.status(404).json({ error: 'Port not found' });

  const users = await pool.query(
    `SELECT
       u.id, u.username, u.display_name, u.email, u.is_active,
       EXISTS(
         SELECT 1
         FROM user_ports up
         WHERE up.user_id = u.id
           AND up.port_id = $1
           AND up.deleted_at IS NULL
       ) AS assigned
     FROM users u
     WHERE u.deleted_at IS NULL
     ORDER BY u.username ASC`,
    [id]
  );
  res.json(
    users.rows.map((u) => ({
      id: Number(u.id),
      username: u.username,
      displayName: u.display_name ?? null,
      email: u.email ?? null,
      isActive: Boolean(u.is_active),
      assigned: Boolean(u.assigned),
    }))
  );
});

router.put('/:id/users', ...requirePageEdit('master-port'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const userIds = Array.isArray(req.body?.user_ids) ? req.body.user_ids : null;
  if (!userIds) return res.status(400).json({ error: 'user_ids must be an array' });

  const normalized = [...new Set(userIds.map((v) => parseInt(v, 10)).filter((n) => Number.isFinite(n) && n > 0))];

  const port = await pool.query(`SELECT id FROM ports WHERE id = $1 AND deleted_at IS NULL`, [id]);
  if (port.rows.length === 0) return res.status(404).json({ error: 'Port not found' });

  if (normalized.length > 0) {
    const users = await pool.query(
      `SELECT id FROM users WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL`,
      [normalized]
    );
    if (users.rows.length !== normalized.length) {
      return res.status(400).json({ error: 'One or more user_ids are invalid' });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE user_ports
       SET deleted_at = NOW(), updated_at = NOW()
       WHERE port_id = $1 AND deleted_at IS NULL`,
      [id]
    );
    for (const uid of normalized) {
      await client.query(
        `INSERT INTO user_ports (user_id, port_id)
         VALUES ($1, $2)`,
        [uid, id]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  res.json({ ok: true, portId: id, userIds: normalized });
});

function toPort(row) {
  return {
    id: row.id != null ? Number(row.id) : row.id,
    name: row.name,
    description: row.description ?? null,
    scheduleTimezone: row.schedule_timezone ?? 'Asia/Jakarta',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export default router;
