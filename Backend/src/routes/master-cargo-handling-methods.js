import express from 'express';
import { pool } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
router.use(requireAuth);

router.get('/master/cargo-handling-methods', async (_req, res) => {
  const r = await pool.query(
    `SELECT id, code, name, is_active, created_at, updated_at
     FROM master_cargo_handling_methods
     WHERE deleted_at IS NULL AND is_active = TRUE
     ORDER BY name ASC`
  );
  res.json(
    r.rows.map((x) => ({
      id: x.id,
      code: x.code,
      name: x.name,
      isActive: x.is_active,
      createdAt: x.created_at,
      updatedAt: x.updated_at,
    }))
  );
});

export default router;

