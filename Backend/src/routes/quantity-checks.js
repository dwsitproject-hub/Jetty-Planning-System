/**
 * Quantity checks endpoints — Phase 4.
 *
 * - GET  /operations/:id/quantity-checks
 * - POST /operations/:id/quantity-checks
 * - PUT  /quantity-checks/:id
 */
import express from 'express';
import { pool } from '../db.js';

const router = express.Router();

router.get('/operations/:operationId/quantity-checks', async (req, res) => {
  const operationId = parseInt(req.params.operationId, 10);
  if (Number.isNaN(operationId)) return res.status(400).json({ error: 'Invalid operation id' });

  const result = await pool.query(
    `SELECT id, operation_id, phase, check_key, value_json, remarks, occurred_at, created_at, updated_at
     FROM quantity_checks
     WHERE operation_id = $1 AND deleted_at IS NULL
     ORDER BY occurred_at NULLS LAST, id ASC`,
    [operationId]
  );
  res.json(result.rows.map(toCheck));
});

router.post('/operations/:operationId/quantity-checks', async (req, res) => {
  const operationId = parseInt(req.params.operationId, 10);
  if (Number.isNaN(operationId)) return res.status(400).json({ error: 'Invalid operation id' });

  const opCheck = await pool.query('SELECT id FROM operations WHERE id = $1 AND deleted_at IS NULL', [
    operationId,
  ]);
  if (opCheck.rows.length === 0) return res.status(404).json({ error: 'Operation not found' });

  const { phase, check_key, value_json, remarks, occurred_at } = req.body || {};
  if (!phase || !['Pre-Checking', 'Operational', 'Post-Checking'].includes(phase)) {
    return res.status(400).json({ error: 'phase must be Pre-Checking, Operational, or Post-Checking' });
  }
  if (!check_key || typeof check_key !== 'string' || !check_key.trim()) {
    return res.status(400).json({ error: 'check_key is required' });
  }

  const result = await pool.query(
    `INSERT INTO quantity_checks (operation_id, phase, check_key, value_json, remarks, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, operation_id, phase, check_key, value_json, remarks, occurred_at, created_at, updated_at`,
    [
      operationId,
      phase,
      check_key.trim(),
      value_json ?? null,
      remarks ?? null,
      occurred_at ? new Date(occurred_at) : null,
    ]
  );
  res.status(201).json(toCheck(result.rows[0]));
});

router.put('/quantity-checks/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

  const { value_json, remarks, occurred_at } = req.body || {};

  const upd = await pool.query(
    `UPDATE quantity_checks SET
       value_json = COALESCE($1, value_json),
       remarks = COALESCE($2, remarks),
       occurred_at = COALESCE($3, occurred_at),
       updated_at = NOW()
     WHERE id = $4 AND deleted_at IS NULL
     RETURNING id, operation_id, phase, check_key, value_json, remarks, occurred_at, created_at, updated_at`,
    [
      value_json !== undefined ? value_json : null,
      remarks !== undefined ? remarks : null,
      occurred_at !== undefined ? (occurred_at ? new Date(occurred_at) : null) : null,
      id,
    ]
  );
  if (upd.rows.length === 0) return res.status(404).json({ error: 'Quantity check not found' });
  res.json(toCheck(upd.rows[0]));
});

router.delete('/quantity-checks/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const result = await pool.query(
    `UPDATE quantity_checks SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
    [id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Quantity check not found' });
  res.status(204).send();
});

function toCheck(row) {
  return {
    id: row.id,
    operationId: row.operation_id,
    phase: row.phase,
    checkKey: row.check_key,
    value: row.value_json ?? null,
    remarks: row.remarks ?? null,
    occurredAt: row.occurred_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export default router;

