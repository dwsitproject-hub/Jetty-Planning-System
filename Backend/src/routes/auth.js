/**
 * Auth routes (Step 1.9). Bcrypt password check; JWT in response.
 */
import bcrypt from 'bcrypt';
import express from 'express';
import jwt from 'jsonwebtoken';
import { pool } from '../db.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || password === undefined) {
    return res.status(400).json({ error: 'username and password required' });
  }
  if (!JWT_SECRET) {
    return res.status(500).json({ error: 'Server misconfiguration' });
  }

  const result = await pool.query(
    `SELECT id, username, display_name, email, password_hash, is_active
     FROM users WHERE username = $1 AND deleted_at IS NULL`,
    [username.trim()]
  );
  const row = result.rows[0];
  if (!row || !row.is_active) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const passwordOk = await bcrypt.compare(password, row.password_hash);
  if (!passwordOk) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const token = jwt.sign(
    { userId: row.id },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );

  res.json({
    user: {
      id: row.id,
      username: row.username,
      displayName: row.display_name ?? null,
      email: row.email ?? null,
    },
    token,
  });
});

export default router;
