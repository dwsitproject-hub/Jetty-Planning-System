/**
 * Auth: bcrypt login; JWT in HttpOnly cookie + CSRF cookie (H-1, H-4, H-5).
 * Optional Bearer in JSON when AUTH_RETURN_TOKEN_BODY=true (scripts/integration only).
 */
import bcrypt from 'bcrypt';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { pool } from '../db.js';
import { logAuthEvent } from '../lib/auth-events.js';
import { COOKIE_ACCESS_TOKEN, COOKIE_XSRF, cookieBaseOptions } from '../lib/auth-cookies.js';
import { setSessionCookiesForUserId } from '../lib/session-cookies.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';
const RETURN_TOKEN_BODY = process.env.AUTH_RETURN_TOKEN_BODY === 'true';

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.AUTH_LOGIN_MAX_ATTEMPTS || 40),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, try again later' },
});

function clearAuthCookies(res) {
  const base = cookieBaseOptions();
  res.clearCookie(COOKIE_ACCESS_TOKEN, { path: base.path });
  res.clearCookie(COOKIE_XSRF, { path: base.path });
}

router.post('/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || password === undefined) {
    return res.status(400).json({ error: 'username and password required' });
  }
  if (!JWT_SECRET) {
    return res.status(500).json({ error: 'Server misconfiguration' });
  }

  const result = await pool.query(
    `SELECT id, username, display_name, email, password_hash, is_active
     FROM users WHERE username = $1 AND deleted_at IS NULL AND auth_source = 'local'`,
    [username.trim()]
  );
  const row = result.rows[0];
  if (!row || !row.is_active) {
    logAuthEvent('local.login.failure', { reason: 'invalid_or_inactive', username: username?.trim(), ip: req.ip });
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const passwordOk = await bcrypt.compare(password, row.password_hash);
  if (!passwordOk) {
    logAuthEvent('local.login.failure', { reason: 'bad_password', username: username?.trim(), ip: req.ip });
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const token = setSessionCookiesForUserId(res, row.id);

  const user = {
    id: row.id,
    username: row.username,
    displayName: row.display_name ?? null,
    email: row.email ?? null,
  };
  if (RETURN_TOKEN_BODY) {
    logAuthEvent('local.login.success', { userId: row.id, ip: req.ip });
    return res.json({ user, token });
  }
  logAuthEvent('local.login.success', { userId: row.id, ip: req.ip });
  res.json({ user });
});

router.post('/logout', (req, res) => {
  clearAuthCookies(res);
  res.status(204).send();
});

export default router;
