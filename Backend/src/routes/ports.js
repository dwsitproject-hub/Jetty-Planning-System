/**
 * Ports CRUD — Phase 2 Master data.
 */
import express from 'express';
import { pool } from '../db.js';
import { requirePageDelete, requirePageEdit, requirePageView } from '../middleware/permissions.js';
import { writeActivityLog } from '../lib/activity-log.js';
import {
  actorUserIdFromReq,
  masterAuditJoinSql,
  masterAuditSelectSql,
  pickMasterAudit,
} from '../lib/master-row-audit.js';
import { parseOperationalDayStart } from '../lib/operational-day.js';
import { registerDataHubSyncRoutes } from './datahub-sync-routes.js';

const router = express.Router();
router.use(...requirePageView('master-port'));

registerDataHubSyncRoutes(router, { entityType: 'port_master', mountPath: '/datahub/sync' });

const PORT_SELECT = `SELECT p.id, p.name, p.description, p.schedule_timezone, p.operational_day_start,
            p.allow_multi_jetty_berthing,
            p.unlocode, p.country, p.is_active,
            p.hub_code, p.datahub_last_apply_source, p.datahub_last_apply_run_id,
            ${masterAuditSelectSql('p')}
     FROM ports p
     ${masterAuditJoinSql('p')}`;

function optionalText(raw) {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  const s = String(raw).trim();
  return s === '' ? null : s;
}

function normalizeHubCode(raw) {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  const s = String(raw).trim();
  return s === '' ? null : s;
}

async function assertPortHubCodeAvailable(hubCode, excludeId = null) {
  if (!hubCode) return null;
  const params = [hubCode];
  let sql = `SELECT id FROM ports WHERE hub_code = $1 AND deleted_at IS NULL`;
  if (excludeId != null) {
    params.push(excludeId);
    sql += ` AND id <> $2`;
  }
  const r = await pool.query(sql, params);
  if (r.rows.length > 0) return 'This Hub Code is already mapped to another port';
  return null;
}

router.get('/', async (req, res) => {
  const result = await pool.query(
    `${PORT_SELECT}
     WHERE p.deleted_at IS NULL ORDER BY p.name ASC`
  );
  res.json(result.rows.map(toPort));
});

router.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const result = await pool.query(
    `${PORT_SELECT}
     WHERE p.id = $1 AND p.deleted_at IS NULL`,
    [id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Port not found' });
  res.json(toPort(result.rows[0]));
});

const SCHEDULE_TZ_RE = /^[A-Za-z_/+-]+$/;

router.post('/', ...requirePageEdit('master-port'), async (req, res) => {
  const {
    name,
    description,
    scheduleTimezone,
    operationalDayStart,
    allowMultiJetyBerthing,
    unlocode,
    country,
    isActive,
    hubCode,
    hub_code: hubCodeSnake,
  } = req.body || {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  const tzRaw = scheduleTimezone != null ? String(scheduleTimezone).trim() : '';
  const tz = tzRaw || 'Asia/Jakarta';
  if (!SCHEDULE_TZ_RE.test(tz)) {
    return res.status(400).json({ error: 'Invalid scheduleTimezone (use IANA, e.g. Asia/Jakarta)' });
  }
  const allowMultiJetty = allowMultiJetyBerthing === true;
  const opDayStart = parseOperationalDayStart(operationalDayStart).formatted;
  const actorId = actorUserIdFromReq(req);
  const unlocodeVal = optionalText(unlocode) ?? null;
  const countryVal = optionalText(country) ?? null;
  const isActiveVal = isActive === false ? false : true;
  const hubCodeVal = normalizeHubCode(hubCode ?? hubCodeSnake) ?? null;
  const hubClash = await assertPortHubCodeAvailable(hubCodeVal);
  if (hubClash) return res.status(409).json({ error: hubClash });
  const result = await pool.query(
    `INSERT INTO ports (name, description, schedule_timezone, operational_day_start, allow_multi_jetty_berthing,
       unlocode, country, is_active, hub_code, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
     RETURNING id`,
    [name.trim(), description?.trim() ?? null, tz, opDayStart, allowMultiJetty, unlocodeVal, countryVal, isActiveVal, hubCodeVal, actorId]
  );
  const created = await pool.query(`${PORT_SELECT} WHERE p.id = $1 AND p.deleted_at IS NULL`, [result.rows[0].id]);
  const row = created.rows[0];
  writeActivityLog({
    pageKey: 'master-port',
    action: 'add',
    entityType: 'Port',
    entityId: row.id,
    entityLabel: row.name,
    summary: 'Created port',
    changes: [
      { field: 'Name', from: null, to: row.name },
      ...(allowMultiJetty ? [{ field: 'Allow Multi-Jetty Berthing', from: null, to: 'Yes' }] : []),
    ],
    actorUserId: req.userId ?? null,
  }).catch(() => {});
  res.status(201).json(toPort(row));
});

router.put('/:id', ...requirePageEdit('master-port'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const {
    name,
    description,
    scheduleTimezone,
    operationalDayStart,
    allowMultiJetyBerthing,
    unlocode,
    country,
    isActive,
    hubCode,
    hub_code: hubCodeSnake,
  } = req.body || {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  const tzRaw = scheduleTimezone != null ? String(scheduleTimezone).trim() : '';
  if (tzRaw && !SCHEDULE_TZ_RE.test(tzRaw)) {
    return res.status(400).json({ error: 'Invalid scheduleTimezone (use IANA, e.g. Asia/Jakarta)' });
  }
  const before = await pool.query(
    `SELECT allow_multi_jetty_berthing, operational_day_start, unlocode, country, is_active, hub_code
     FROM ports WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  if (before.rows.length === 0) return res.status(404).json({ error: 'Port not found' });
  const allowMultiJettyProvided = Object.prototype.hasOwnProperty.call(req.body || {}, 'allowMultiJetyBerthing');
  const allowMultiJetty = allowMultiJettyProvided
    ? allowMultiJetyBerthing === true
    : before.rows[0].allow_multi_jetty_berthing;
  const opDayStartProvided = Object.prototype.hasOwnProperty.call(req.body || {}, 'operationalDayStart');
  const opDayStart = opDayStartProvided
    ? parseOperationalDayStart(operationalDayStart).formatted
    : before.rows[0].operational_day_start;
  const unlocodeProvided = Object.prototype.hasOwnProperty.call(req.body || {}, 'unlocode');
  const countryProvided = Object.prototype.hasOwnProperty.call(req.body || {}, 'country');
  const isActiveProvided = Object.prototype.hasOwnProperty.call(req.body || {}, 'isActive');
  const unlocodeVal = unlocodeProvided ? optionalText(unlocode) : before.rows[0].unlocode;
  const countryVal = countryProvided ? optionalText(country) : before.rows[0].country;
  const isActiveVal = isActiveProvided ? isActive !== false : before.rows[0].is_active !== false;
  const hubCodeProvided =
    Object.prototype.hasOwnProperty.call(req.body || {}, 'hubCode') ||
    Object.prototype.hasOwnProperty.call(req.body || {}, 'hub_code');
  const hubCodeVal = hubCodeProvided
    ? normalizeHubCode(hubCode ?? hubCodeSnake) ?? null
    : before.rows[0].hub_code;
  if (hubCodeProvided) {
    const hubClash = await assertPortHubCodeAvailable(hubCodeVal, id);
    if (hubClash) return res.status(409).json({ error: hubClash });
  }

  const actorId = actorUserIdFromReq(req);
  const result = await pool.query(
    `UPDATE ports SET name = $1, description = $2,
       schedule_timezone = CASE WHEN $3::text IS NOT NULL AND $3::text <> '' THEN $3::text ELSE schedule_timezone END,
       operational_day_start = $4,
       allow_multi_jetty_berthing = $5,
       unlocode = $6,
       country = $7,
       is_active = $8,
       hub_code = $9,
       updated_by = $10,
       updated_at = NOW()
     WHERE id = $11 AND deleted_at IS NULL
     RETURNING id`,
    [
      name.trim(),
      description?.trim() ?? null,
      tzRaw || null,
      opDayStart,
      allowMultiJetty,
      unlocodeVal,
      countryVal,
      isActiveVal,
      hubCodeVal,
      actorId,
      id,
    ]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Port not found' });
  const updated = await pool.query(`${PORT_SELECT} WHERE p.id = $1 AND p.deleted_at IS NULL`, [id]);
  const row = updated.rows[0];
  const changes = [{ field: 'Name', from: null, to: row.name }];
  if (allowMultiJettyProvided && Boolean(before.rows[0].allow_multi_jetty_berthing) !== allowMultiJetty) {
    changes.push({
      field: 'Allow Multi-Jetty Berthing',
      from: before.rows[0].allow_multi_jetty_berthing ? 'Yes' : 'No',
      to: allowMultiJetty ? 'Yes' : 'No',
    });
  }
  if (hubCodeProvided && String(before.rows[0].hub_code ?? '') !== String(hubCodeVal ?? '')) {
    changes.push({
      field: 'Hub Code',
      from: before.rows[0].hub_code ?? null,
      to: hubCodeVal,
    });
  }
  writeActivityLog({
    pageKey: 'master-port',
    action: 'update',
    entityType: 'Port',
    entityId: id,
    entityLabel: row.name,
    summary: 'Updated port',
    changes,
    actorUserId: req.userId ?? null,
  }).catch(() => {});
  res.json(toPort(row));
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
    operationalDayStart: parseOperationalDayStart(row.operational_day_start).formatted,
    allowMultiJetyBerthing: row.allow_multi_jetty_berthing === true,
    unlocode: row.unlocode ?? null,
    country: row.country ?? null,
    isActive: row.is_active !== false,
    hubCode: row.hub_code ?? null,
    datahubLastApplySource: row.datahub_last_apply_source ?? null,
    datahubLastApplyRunId:
      row.datahub_last_apply_run_id != null ? Number(row.datahub_last_apply_run_id) : null,
    ...pickMasterAudit(row),
  };
}

export default router;
