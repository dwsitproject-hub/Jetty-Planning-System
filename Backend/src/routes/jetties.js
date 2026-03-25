/**
 * Jetties CRUD + PUT /:id/status — Phase 2 Master data.
 */
import express from 'express';
import { pool } from '../db.js';

const VALID_STATUSES = ['Available', 'Maintenance', 'High-Priority', 'Out of Service'];
const router = express.Router();

router.get('/', async (req, res) => {
  const portId = req.query.port_id;
  let result;
  if (portId) {
    const id = parseInt(portId, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid port_id' });
    result = await pool.query(
      `SELECT j.id, j.port_id, j.order_no, j.name, j.description, j.status, j.created_at, j.updated_at,
              p.name AS port_name
       FROM jetties j JOIN ports p ON j.port_id = p.id AND p.deleted_at IS NULL
       WHERE j.port_id = $1 AND j.deleted_at IS NULL ORDER BY j.order_no ASC, j.name ASC`,
      [id]
    );
  } else {
    result = await pool.query(
      `SELECT j.id, j.port_id, j.order_no, j.name, j.description, j.status, j.created_at, j.updated_at,
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
    `SELECT j.id, j.port_id, j.order_no, j.name, j.description, j.status, j.created_at, j.updated_at,
            p.name AS port_name
     FROM jetties j JOIN ports p ON j.port_id = p.id AND p.deleted_at IS NULL
     WHERE j.id = $1 AND j.deleted_at IS NULL`,
    [id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Jetty not found' });
  res.json(toJetty(result.rows[0]));
});

router.post('/', async (req, res) => {
  const { port_id, order_no, name, description } = req.body || {};
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
  const result = await pool.query(
    `INSERT INTO jetties (port_id, order_no, name, description)
     VALUES ($1, $2, $3, $4)
     RETURNING id, port_id, order_no, name, description, status, created_at, updated_at`,
    [portId, Number.isNaN(orderNo) ? 0 : orderNo, name.trim(), description?.trim() ?? null]
  );
  const row = result.rows[0];
  const portName = await pool.query(
    'SELECT name FROM ports WHERE id = $1 AND deleted_at IS NULL',
    [row.port_id]
  );
  res.status(201).json(toJetty({ ...row, port_name: portName.rows[0]?.name ?? null }));
});

router.put('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const { port_id, order_no, name, description } = req.body || {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  const portId = port_id != null ? parseInt(port_id, 10) : null;
  const orderNo = order_no != null ? parseInt(order_no, 10) : null;
  const result = await pool.query(
    `UPDATE jetties SET
       port_id = COALESCE($1, port_id),
       order_no = COALESCE($2, order_no),
       name = $3,
       description = $4,
       updated_at = NOW()
     WHERE id = $5 AND deleted_at IS NULL
     RETURNING id, port_id, order_no, name, description, status, created_at, updated_at`,
    [portId, orderNo, name.trim(), description?.trim() ?? null, id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Jetty not found' });
  const row = result.rows[0];
  const portName = await pool.query(
    'SELECT name FROM ports WHERE id = $1 AND deleted_at IS NULL',
    [row.port_id]
  );
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export default router;
