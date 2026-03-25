/**
 * Users: GET /me, CRUD for admin (JWT required except /me is JWT).
 */
import bcrypt from 'bcrypt';
import express from 'express';
import { pool } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

function toUser(row) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name ?? null,
    email: row.email ?? null,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

router.get('/me', requireAuth, async (req, res) => {
  const id = req.userId;

  const result = await pool.query(
    `SELECT id, username, display_name, email, is_active, created_at, updated_at
     FROM users WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  const row = result.rows[0];
  if (!row) {
    return res.status(404).json({ error: 'User not found' });
  }
  if (!row.is_active) {
    return res.status(403).json({ error: 'User is inactive' });
  }

  res.json(toUser(row));
});

router.get('/', requireAuth, async (req, res) => {
  const result = await pool.query(
    `SELECT id, username, display_name, email, is_active, created_at, updated_at
     FROM users WHERE deleted_at IS NULL ORDER BY username ASC`
  );
  res.json(result.rows.map(toUser));
});

router.get('/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const result = await pool.query(
    `SELECT id, username, display_name, email, is_active, created_at, updated_at
     FROM users WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
  res.json(toUser(result.rows[0]));
});

router.post('/', requireAuth, async (req, res) => {
  const { username, password, display_name, email, is_active } = req.body || {};
  if (!username || typeof username !== 'string' || !username.trim()) {
    return res.status(400).json({ error: 'username is required' });
  }
  if (password === undefined || password === null || String(password).length < 6) {
    return res.status(400).json({ error: 'password is required (min 6 characters)' });
  }
  const hash = await bcrypt.hash(String(password), 10);
  const active = is_active !== false;
  try {
    const result = await pool.query(
      `INSERT INTO users (username, password_hash, display_name, email, is_active)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, username, display_name, email, is_active, created_at, updated_at`,
      [
        username.trim(),
        hash,
        display_name?.trim() ?? null,
        email?.trim() ?? null,
        active,
      ]
    );
    res.status(201).json(toUser(result.rows[0]));
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Username or email already in use' });
    throw e;
  }
});

router.put('/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const { display_name, email, is_active, password } = req.body || {};
  const updates = [];
  const values = [];
  let i = 1;
  if (display_name !== undefined) {
    updates.push(`display_name = $${i++}`);
    values.push(display_name === null ? null : String(display_name).trim() || null);
  }
  if (email !== undefined) {
    updates.push(`email = $${i++}`);
    values.push(email === null || email === '' ? null : String(email).trim());
  }
  if (is_active !== undefined) {
    updates.push(`is_active = $${i++}`);
    values.push(Boolean(is_active));
  }
  if (password !== undefined && password !== null && String(password).length > 0) {
    if (String(password).length < 6) {
      return res.status(400).json({ error: 'password must be at least 6 characters' });
    }
    const hash = await bcrypt.hash(String(password), 10);
    updates.push(`password_hash = $${i++}`);
    values.push(hash);
  }
  if (updates.length === 0) {
    const r = await pool.query(
      `SELECT id, username, display_name, email, is_active, created_at, updated_at
       FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    return res.json(toUser(r.rows[0]));
  }
  updates.push('updated_at = NOW()');
  values.push(id);
  try {
    const result = await pool.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${i} AND deleted_at IS NULL
       RETURNING id, username, display_name, email, is_active, created_at, updated_at`,
      values
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(toUser(result.rows[0]));
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Email already in use' });
    throw e;
  }
});

router.delete('/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  if (id === req.userId) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const u = await client.query(
      'SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL',
      [id]
    );
    if (u.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found' });
    }
    await client.query(
      `UPDATE user_roles SET deleted_at = NOW() WHERE user_id = $1 AND deleted_at IS NULL`,
      [id]
    );
    await client.query(
      `UPDATE users SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    await client.query('COMMIT');
    res.status(204).send();
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});

export default router;
