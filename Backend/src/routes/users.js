/**
 * Users: GET /me, CRUD for admin (JWT required except /me is JWT).
 */
import bcrypt from 'bcrypt';
import express from 'express';
import { pool } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { loadUserAssignedPorts, NO_PORT_MESSAGE } from '../middleware/port-scope.js';
import { requireAdminPageView } from '../middleware/permissions.js';
import { getDiscoveryDocument } from '../lib/oidc-client.js';
import { assertOidcConfigured } from '../lib/oidc-config.js';
import { createPkcePair, createSignedState, setOidcFlowCookie } from '../lib/oidc-flow.js';
import { logAuthEvent } from '../lib/auth-events.js';

const router = express.Router();

function toUser(row) {
  let assignedPorts = undefined;
  if (Array.isArray(row.assigned_ports)) {
    assignedPorts = row.assigned_ports
      .filter((p) => p && Number.isFinite(Number(p.id)))
      .map((p) => ({
        id: Number(p.id),
        name: p.name ?? '',
        scheduleTimezone: p.scheduleTimezone ?? p.schedule_timezone ?? 'Asia/Jakarta',
      }));
  }
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name ?? null,
    email: row.email ?? null,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(assignedPorts ? { assignedPorts } : {}),
  };
}

function toSsoStatus(row, linkedByMode = null) {
  const sub = typeof row?.oidc_sub === 'string' ? row.oidc_sub : '';
  const subjectFingerprint = sub ? `...${sub.slice(-6)}` : null;
  return {
    linked: Boolean(sub),
    authSource: row?.auth_source || 'local',
    linkedAt: row?.updated_at || null,
    linkedByMode,
    subjectFingerprint,
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

router.get('/me/sso-status', requireAuth, async (req, res) => {
  const result = await pool.query(
    `SELECT id, auth_source, oidc_sub, updated_at
     FROM users
     WHERE id = $1 AND deleted_at IS NULL`,
    [req.userId]
  );
  const row = result.rows[0];
  if (!row) return res.status(404).json({ error: 'User not found' });
  res.json(toSsoStatus(row));
});

router.post('/me/sso-connect/start', requireAuth, async (req, res) => {
  const me = await pool.query(
    `SELECT id, email, is_active
     FROM users
     WHERE id = $1 AND deleted_at IS NULL`,
    [req.userId]
  );
  const row = me.rows[0];
  if (!row) return res.status(404).json({ error: 'User not found' });
  if (!row.is_active) return res.status(403).json({ error: 'User is inactive' });

  const cfg = assertOidcConfigured();
  const discovery = await getDiscoveryDocument(cfg.discoveryUrl);
  const { verifier, challenge, method } = createPkcePair();
  const state = createSignedState({ verifier, mode: 'connect_sso' });
  setOidcFlowCookie(res, { state, verifier });
  const authUrl = new URL(discovery.authorization_endpoint);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', cfg.clientId);
  authUrl.searchParams.set('redirect_uri', cfg.redirectUri);
  authUrl.searchParams.set('scope', cfg.scopes);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', method);
  logAuthEvent('oidc.link.start', { mode: 'connect_sso', userId: req.userId, ip: req.ip });
  res.json({ url: authUrl.toString(), mode: 'connect_sso' });
});

router.get('/me/ports', requireAuth, async (req, res) => {
  const assignedPorts = await loadUserAssignedPorts(req.userId);
  res.json({
    assignedPorts,
    hasAssignedPort: assignedPorts.length > 0,
    noPortMessage: NO_PORT_MESSAGE,
  });
});

// All routes below this line are admin-only.
router.use(...requireAdminPageView);

router.get('/', async (req, res) => {
  const result = await pool.query(
    `SELECT
       u.id,
       u.username,
       u.display_name,
       u.email,
       u.is_active,
       u.created_at,
       u.updated_at,
       COALESCE(
         JSON_AGG(
           DISTINCT JSONB_BUILD_OBJECT(
             'id', p.id,
             'name', p.name,
             'scheduleTimezone', p.schedule_timezone
           )
         ) FILTER (WHERE up.id IS NOT NULL),
         '[]'::json
       ) AS assigned_ports
     FROM users u
     LEFT JOIN user_ports up
       ON up.user_id = u.id
      AND up.deleted_at IS NULL
     LEFT JOIN ports p
       ON p.id = up.port_id
      AND p.deleted_at IS NULL
     WHERE u.deleted_at IS NULL
     GROUP BY u.id
     ORDER BY u.username ASC`
  );
  res.json(result.rows.map(toUser));
});

router.get('/:id', async (req, res) => {
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

router.get('/:id/sso-status', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const result = await pool.query(
    `SELECT id, email, auth_source, oidc_sub, updated_at, is_active
     FROM users WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  const row = result.rows[0];
  if (!row) return res.status(404).json({ error: 'User not found' });
  res.json({
    userId: row.id,
    email: row.email ?? null,
    isActive: row.is_active !== false,
    ...toSsoStatus(row, 'admin'),
  });
});

router.post('/:id/sso-link/start', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const userResult = await pool.query(
    `SELECT id, email, is_active
     FROM users WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  const user = userResult.rows[0];
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!user.is_active) return res.status(403).json({ error: 'Target user is inactive' });
  const expectedEmail = typeof user.email === 'string' ? user.email.trim().toLowerCase() : '';
  if (!expectedEmail) {
    return res.status(409).json({ error: 'Target user must have an email before generating SSO link' });
  }
  const cfg = assertOidcConfigured();
  const discovery = await getDiscoveryDocument(cfg.discoveryUrl);
  const { verifier, challenge, method } = createPkcePair();
  const state = createSignedState({
    verifier,
    mode: 'admin_prelink',
    targetUserId: id,
    expectedEmail,
  });
  const authUrl = new URL(discovery.authorization_endpoint);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', cfg.clientId);
  authUrl.searchParams.set('redirect_uri', cfg.redirectUri);
  authUrl.searchParams.set('scope', cfg.scopes);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', method);
  logAuthEvent('oidc.link.start', { mode: 'admin_prelink', actorUserId: req.userId, targetUserId: id, ip: req.ip });
  res.json({
    url: authUrl.toString(),
    targetUserId: id,
    expectedEmail,
    expiresInSeconds: 600,
  });
});

router.post('/:id/sso-unlink', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  const result = await pool.query(
    `UPDATE users
     SET oidc_sub = NULL, updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING id, auth_source, oidc_sub, updated_at`,
    [id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
  logAuthEvent('oidc.unlink.success', { actorUserId: req.userId, targetUserId: id, reason: reason || null, ip: req.ip });
  res.json({ userId: id, ...toSsoStatus(result.rows[0], 'admin') });
});

router.get('/:id/ports', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

  const user = await pool.query(
    `SELECT id, username, display_name FROM users WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  if (user.rows.length === 0) return res.status(404).json({ error: 'User not found' });

  const assignedPorts = await loadUserAssignedPorts(id);
  res.json({
    userId: id,
    username: user.rows[0].username,
    displayName: user.rows[0].display_name ?? null,
    assignedPorts,
  });
});

router.post('/', async (req, res) => {
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

router.put('/:id', async (req, res) => {
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

router.put('/:id/ports', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

  const portIds = Array.isArray(req.body?.port_ids) ? req.body.port_ids : null;
  if (!portIds) return res.status(400).json({ error: 'port_ids must be an array' });
  const normalized = [...new Set(portIds.map((v) => parseInt(v, 10)).filter((n) => Number.isFinite(n) && n > 0))];

  const user = await pool.query(`SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL`, [id]);
  if (user.rows.length === 0) return res.status(404).json({ error: 'User not found' });

  if (normalized.length > 0) {
    const ports = await pool.query(
      `SELECT id FROM ports WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL`,
      [normalized]
    );
    if (ports.rows.length !== normalized.length) {
      return res.status(400).json({ error: 'One or more port_ids are invalid' });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE user_ports
       SET deleted_at = NOW(), updated_at = NOW()
       WHERE user_id = $1 AND deleted_at IS NULL`,
      [id]
    );
    for (const pid of normalized) {
      await client.query(
        `INSERT INTO user_ports (user_id, port_id)
         VALUES ($1, $2)`,
        [id, pid]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  const assignedPorts = await loadUserAssignedPorts(id);
  res.json({
    userId: id,
    assignedPorts,
    hasAssignedPort: assignedPorts.length > 0,
    noPortMessage: NO_PORT_MESSAGE,
  });
});

router.delete('/:id', async (req, res) => {
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
      `UPDATE user_ports SET deleted_at = NOW(), updated_at = NOW() WHERE user_id = $1 AND deleted_at IS NULL`,
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
