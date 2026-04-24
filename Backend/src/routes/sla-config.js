/**
 * SLA config (single resource) GET / PUT — Phase 2 Master data.
 */
import express from 'express';
import { pool } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requireAdminPageView } from '../middleware/permissions.js';

const router = express.Router();
const CONFIG_ID = 1;

router.get('/', requireAuth, async (req, res) => {
  const result = await pool.query(
    `SELECT id, q1_hours, q2_hours, c_hours, s_hours, buffer_default, updated_at
     FROM sla_config WHERE id = $1 AND deleted_at IS NULL`,
    [CONFIG_ID]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'SLA config not found' });
  res.json(toConfig(result.rows[0]));
});

router.put('/', ...requireAdminPageView, async (req, res) => {
  const { q1_hours, q2_hours, c_hours, s_hours, buffer_default } = req.body || {};
  const result = await pool.query(
    `UPDATE sla_config SET
       q1_hours = COALESCE($1, q1_hours),
       q2_hours = COALESCE($2, q2_hours),
       c_hours = COALESCE($3, c_hours),
       s_hours = COALESCE($4, s_hours),
       buffer_default = COALESCE($5, buffer_default),
       updated_at = NOW()
     WHERE id = $6 AND deleted_at IS NULL
     RETURNING id, q1_hours, q2_hours, c_hours, s_hours, buffer_default, updated_at`,
    [
      toNum(q1_hours),
      toNum(q2_hours),
      toNum(c_hours),
      toNum(s_hours),
      toNum(buffer_default),
      CONFIG_ID,
    ]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'SLA config not found' });
  res.json(toConfig(result.rows[0]));
});

function toNum(v) {
  if (v === undefined || v === null) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function toConfig(row) {
  return {
    id: row.id,
    q1Hours: Number(row.q1_hours),
    q2Hours: Number(row.q2_hours),
    cHours: Number(row.c_hours),
    sHours: Number(row.s_hours),
    bufferDefault: Number(row.buffer_default),
    updatedAt: row.updated_at,
  };
}

export default router;
