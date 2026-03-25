/**
 * Ports CRUD — Phase 2 Master data.
 */
import express from 'express';
import { pool } from '../db.js';

const router = express.Router();

router.get('/', async (req, res) => {
  const result = await pool.query(
    `SELECT id, name, description, created_at, updated_at
     FROM ports WHERE deleted_at IS NULL ORDER BY name ASC`
  );
  res.json(result.rows.map(toPort));
});

router.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const result = await pool.query(
    `SELECT id, name, description, created_at, updated_at FROM ports WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Port not found' });
  res.json(toPort(result.rows[0]));
});

router.post('/', async (req, res) => {
  const { name, description } = req.body || {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  const result = await pool.query(
    `INSERT INTO ports (name, description) VALUES ($1, $2)
     RETURNING id, name, description, created_at, updated_at`,
    [name.trim(), description?.trim() ?? null]
  );
  res.status(201).json(toPort(result.rows[0]));
});

router.put('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const { name, description } = req.body || {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  const result = await pool.query(
    `UPDATE ports SET name = $1, description = $2, updated_at = NOW()
     WHERE id = $3 AND deleted_at IS NULL RETURNING id, name, description, created_at, updated_at`,
    [name.trim(), description?.trim() ?? null, id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Port not found' });
  res.json(toPort(result.rows[0]));
});

/** Soft-delete (blocked if non-deleted jetties reference this port). */
router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const j = await pool.query(
    `SELECT 1 FROM jetties WHERE port_id = $1 AND deleted_at IS NULL LIMIT 1`,
    [id]
  );
  if (j.rows.length > 0) {
    return res.status(409).json({ error: 'Cannot delete port while it has jetties; remove or delete jetties first' });
  }
  const result = await pool.query(
    `UPDATE ports SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
    [id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Port not found' });
  res.status(204).send();
});

function toPort(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export default router;
