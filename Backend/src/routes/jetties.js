/**
 * Jetties CRUD + PUT /:id/status — Phase 2 Master data.
 */
import express from 'express';
import { pool } from '../db.js';
import { optionalAuth } from '../middleware/auth.js';
import { writeActivityLog } from '../lib/activity-log.js';
import { countBlockingOperationsOnJetty, isJettyUnavailableMasterStatus } from '../lib/jetty-blocking.js';

const VALID_STATUSES = ['Available', 'Out of Service'];
const router = express.Router();
router.use(optionalAuth);

router.get('/', async (req, res) => {
  const portId = req.query.port_id;
  let result;
  if (portId) {
    const id = parseInt(portId, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid port_id' });
    result = await pool.query(
      `SELECT j.id, j.port_id, j.order_no, j.name, j.description, j.status, j.capacity, j.created_at, j.updated_at,
              p.name AS port_name
       FROM jetties j JOIN ports p ON j.port_id = p.id AND p.deleted_at IS NULL
       WHERE j.port_id = $1 AND j.deleted_at IS NULL ORDER BY j.order_no ASC, j.name ASC`,
      [id]
    );
  } else {
    result = await pool.query(
      `SELECT j.id, j.port_id, j.order_no, j.name, j.description, j.status, j.capacity, j.created_at, j.updated_at,
              p.name AS port_name
       FROM jetties j JOIN ports p ON j.port_id = p.id AND p.deleted_at IS NULL
       WHERE j.deleted_at IS NULL
       ORDER BY p.name ASC, j.order_no ASC, j.name ASC`
    );
  }
  res.json(result.rows.map(toJetty));
});

router.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const result = await pool.query(
    `SELECT j.id, j.port_id, j.order_no, j.name, j.description, j.status, j.capacity, j.created_at, j.updated_at,
            p.name AS port_name
     FROM jetties j JOIN ports p ON j.port_id = p.id AND p.deleted_at IS NULL
     WHERE j.id = $1 AND j.deleted_at IS NULL`,
    [id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Jetty not found' });
  res.json(toJetty(result.rows[0]));
});

router.post('/', async (req, res) => {
  const { port_id, order_no, name, description, capacity } = req.body || {};
  if (port_id == null || !name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'port_id and name are required' });
  }
  const portId = parseInt(port_id, 10);
  if (Number.isNaN(portId)) return res.status(400).json({ error: 'Invalid port_id' });
  const portOk = await pool.query(
    'SELECT 1 FROM ports WHERE id = $1 AND deleted_at IS NULL',
    [portId]
  );
  if (portOk.rows.length === 0) return res.status(404).json({ error: 'Port not found' });
  const orderNo = order_no != null ? parseInt(order_no, 10) : 0;
  const capRaw = capacity != null && capacity !== '' ? parseInt(capacity, 10) : null;
  const cap = capRaw == null || Number.isNaN(capRaw) ? null : capRaw;
  if (cap != null && cap < 1) return res.status(400).json({ error: 'capacity must be an integer >= 1' });
  const result = await pool.query(
    `INSERT INTO jetties (port_id, order_no, name, description, capacity)
     VALUES ($1, $2, $3, $4, COALESCE($5, 1))
     RETURNING id, port_id, order_no, name, description, status, capacity, created_at, updated_at`,
    [portId, Number.isNaN(orderNo) ? 0 : orderNo, name.trim(), description?.trim() ?? null, cap]
  );
  const row = result.rows[0];
  const portName = await pool.query(
    'SELECT name FROM ports WHERE id = $1 AND deleted_at IS NULL',
    [row.port_id]
  );
  writeActivityLog({
    pageKey: 'master-jetty',
    action: 'add',
    entityType: 'Jetty',
    entityId: row.id,
    entityLabel: name.trim(),
    summary: 'Created jetty',
    changes: [
      { field: 'Port', from: null, to: portName.rows[0]?.name ?? String(row.port_id) },
      { field: 'Order', from: null, to: row.order_no },
      { field: 'Name', from: null, to: name.trim() },
      { field: 'Capacity', from: null, to: row.capacity },
      { field: 'Status', from: null, to: row.status },
    ],
    actorUserId: req.userId ?? null,
  }).catch(() => {});
  res.status(201).json(toJetty({ ...row, port_name: portName.rows[0]?.name ?? null }));
});

router.put('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const { port_id, order_no, name, description, capacity } = req.body || {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  const before = await pool.query(
    `SELECT j.id, j.port_id, j.order_no, j.name, j.description, j.status, j.capacity, p.name AS port_name
     FROM jetties j
     JOIN ports p ON j.port_id = p.id AND p.deleted_at IS NULL
     WHERE j.id = $1 AND j.deleted_at IS NULL`,
    [id]
  );
  const beforeRow = before.rows[0] ?? null;
  if (!beforeRow) return res.status(404).json({ error: 'Jetty not found' });

  const portId = port_id != null ? parseInt(port_id, 10) : null;
  const orderNo = order_no != null ? parseInt(order_no, 10) : null;
  const capRaw = capacity != null && capacity !== '' ? parseInt(capacity, 10) : null;
  const cap = capRaw == null || Number.isNaN(capRaw) ? null : capRaw;
  if (cap != null && cap < 1) return res.status(400).json({ error: 'capacity must be an integer >= 1' });
  const result = await pool.query(
    `UPDATE jetties SET
       port_id = COALESCE($1, port_id),
       order_no = COALESCE($2, order_no),
       capacity = COALESCE($3, capacity),
       name = $4,
       description = $5,
       updated_at = NOW()
     WHERE id = $6 AND deleted_at IS NULL
     RETURNING id, port_id, order_no, name, description, status, capacity, created_at, updated_at`,
    [portId, orderNo, cap, name.trim(), description?.trim() ?? null, id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Jetty not found' });
  const row = result.rows[0];
  const portName = await pool.query(
    'SELECT name FROM ports WHERE id = $1 AND deleted_at IS NULL',
    [row.port_id]
  );

  const changes = [];
  const add = (field, from, to) => {
    if ((from ?? null) === (to ?? null)) return;
    changes.push({ field, from, to });
  };
  add('Port', beforeRow.port_name ?? beforeRow.port_id, portName.rows[0]?.name ?? row.port_id);
  add('Order', beforeRow.order_no, row.order_no);
  add('Name', beforeRow.name, row.name);
  add('Capacity', beforeRow.capacity, row.capacity);
  add('Status', beforeRow.status, row.status);
  add('Description', beforeRow.description ?? null, row.description ?? null);

  writeActivityLog({
    pageKey: 'master-jetty',
    action: 'update',
    entityType: 'Jetty',
    entityId: row.id,
    entityLabel: row.name,
    summary: 'Updated jetty',
    changes: changes.length ? changes : [{ field: 'No changes', from: '—', to: '—' }],
    actorUserId: req.userId ?? null,
  }).catch(() => {});
  res.json(toJetty({ ...row, port_name: portName.rows[0]?.name ?? null }));
});

router.put('/:id/status', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const { status } = req.body || {};
  if (!status || !VALID_STATUSES.includes(status)) {
    return res.status(400).json({
      error: 'status required; one of: ' + VALID_STATUSES.join(', '),
    });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const before = await client.query(
      `SELECT id, status, name FROM jetties WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    const beforeRow = before.rows[0] ?? null;
    if (!beforeRow) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Jetty not found' });
    }
    if (isJettyUnavailableMasterStatus(status)) {
      const blocking = await countBlockingOperationsOnJetty(client, id);
      if (blocking > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error:
            'Cannot set this status while active operations use the jetty. Reassign or complete them on Allocation & Berthing first.',
        });
      }
    }
    const up = await client.query(
      `UPDATE jetties SET status = $1, updated_at = NOW() WHERE id = $2 AND deleted_at IS NULL
       RETURNING id, port_id, order_no, name, description, status, created_at, updated_at`,
      [status, id]
    );
    if (up.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Jetty not found' });
    }
    await client.query(
      `INSERT INTO jetty_status_history (jetty_id, status) VALUES ($1, $2)`,
      [id, status]
    );
    await client.query('COMMIT');
    const row = up.rows[0];
    const portName = await pool.query(
      'SELECT name FROM ports WHERE id = $1 AND deleted_at IS NULL',
      [row.port_id]
    );
    writeActivityLog({
      pageKey: 'master-jetty',
      action: 'update',
      entityType: 'Jetty',
      entityId: row.id,
      entityLabel: row.name,
      summary: 'Updated jetty status',
      changes: [{ field: 'Status', from: beforeRow.status ?? null, to: status }],
      actorUserId: req.userId ?? null,
    }).catch(() => {});
    res.json(toJetty({ ...row, port_name: portName.rows[0]?.name ?? null }));
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});

router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const op = await pool.query(
    `SELECT 1 FROM operations WHERE jetty_id = $1 AND deleted_at IS NULL LIMIT 1`,
    [id]
  );
  if (op.rows.length > 0) {
    return res.status(409).json({ error: 'Cannot delete jetty while operations reference it' });
  }
  const result = await pool.query(
    `UPDATE jetties SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
    [id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Jetty not found' });
  writeActivityLog({
    pageKey: 'master-jetty',
    action: 'delete',
    entityType: 'Jetty',
    entityId: id,
    entityLabel: `Jetty ${id}`,
    summary: 'Deleted jetty',
    actorUserId: req.userId ?? null,
  }).catch(() => {});
  res.status(204).send();
});

function toJetty(row) {
  return {
    id: row.id,
    portId: row.port_id,
    portName: row.port_name ?? undefined,
    orderNo: row.order_no,
    name: row.name,
    description: row.description ?? null,
    status: row.status,
    capacity: row.capacity != null ? Number(row.capacity) : 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export default router;
