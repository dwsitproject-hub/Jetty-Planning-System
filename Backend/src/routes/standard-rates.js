/**
 * Standard rates CRUD — Phase 2 Master data (per material type for SLA).
 */
import express from 'express';
import { pool } from '../db.js';

const router = express.Router();

router.get('/', async (req, res) => {
  const result = await pool.query(
    `SELECT id, material_key, rate_per_hour, buffer, created_at, updated_at
     FROM standard_rates WHERE deleted_at IS NULL ORDER BY material_key ASC`
  );
  res.json(result.rows.map(toRate));
});

router.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const result = await pool.query(
    `SELECT id, material_key, rate_per_hour, buffer, created_at, updated_at
     FROM standard_rates WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Standard rate not found' });
  res.json(toRate(result.rows[0]));
});

router.post('/', async (req, res) => {
  const { material_key, rate_per_hour, buffer } = req.body || {};
  if (!material_key || typeof material_key !== 'string' || !material_key.trim()) {
    return res.status(400).json({ error: 'material_key is required' });
  }
  const rate = toNum(rate_per_hour);
  if (rate == null || rate < 0) return res.status(400).json({ error: 'rate_per_hour must be a non-negative number' });
  const buf = buffer !== undefined && buffer !== null ? toNum(buffer) : 0.85;
  const result = await pool.query(
    `INSERT INTO standard_rates (material_key, rate_per_hour, buffer)
     VALUES ($1, $2, $3)
     RETURNING id, material_key, rate_per_hour, buffer, created_at, updated_at`,
    [material_key.trim(), rate, buf === null ? 0.85 : buf]
  );
  res.status(201).json(toRate(result.rows[0]));
});

router.put('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const { material_key, rate_per_hour, buffer } = req.body || {};
  const updates = [];
  const values = [];
  let i = 1;
  if (material_key !== undefined) {
    if (typeof material_key !== 'string' || !material_key.trim()) {
      return res.status(400).json({ error: 'material_key must be a non-empty string' });
    }
    updates.push(`material_key = $${i++}`);
    values.push(material_key.trim());
  }
  if (rate_per_hour !== undefined) {
    const rate = toNum(rate_per_hour);
    if (rate == null || rate < 0) return res.status(400).json({ error: 'rate_per_hour must be a non-negative number' });
    updates.push(`rate_per_hour = $${i++}`);
    values.push(rate);
  }
  if (buffer !== undefined && buffer !== null) {
    const buf = toNum(buffer);
    updates.push(`buffer = $${i++}`);
    values.push(buf === null ? 0.85 : buf);
  }
  if (updates.length === 0) {
    const result = await pool.query(
      `SELECT id, material_key, rate_per_hour, buffer, created_at, updated_at FROM standard_rates WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Standard rate not found' });
    return res.json(toRate(result.rows[0]));
  }
  values.push(id);
  const result = await pool.query(
    `UPDATE standard_rates SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${i} AND deleted_at IS NULL RETURNING id, material_key, rate_per_hour, buffer, created_at, updated_at`,
    values
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Standard rate not found' });
  res.json(toRate(result.rows[0]));
});

router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const result = await pool.query(
    `UPDATE standard_rates SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
    [id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Standard rate not found' });
  res.status(204).send();
});

function toNum(v) {
  if (v === undefined || v === null) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function toRate(row) {
  return {
    id: row.id,
    materialKey: row.material_key,
    ratePerHour: Number(row.rate_per_hour),
    buffer: Number(row.buffer),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export default router;
