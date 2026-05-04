/**
 * Downstream Hub SSO consumer: POST /auth/hub (form field "token").
 * Does not change local username/password login under /api/v1/auth/*.
 */
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import { pool } from '../db.js';
import { logAuthEvent } from '../lib/auth-events.js';
import { getOidcConfig } from '../lib/oidc-config.js';
import { setSessionCookiesForUserId } from '../lib/session-cookies.js';

const router = express.Router();
const urlencoded = express.urlencoded({ extended: false });

const SSO_SECRET = process.env.SSO_TOKEN_SECRET;
const JIT_PROVISION = String(process.env.HUB_SSO_JIT_PROVISION || '').toLowerCase() === 'true';
const JIT_ROLE_NAME = (process.env.HUB_SSO_JIT_ROLE_NAME || '').trim();
const JIT_PORTS = (process.env.HUB_SSO_JIT_ASSIGN_PORTS || 'first').toLowerCase();
const PUBLIC_ORIGIN = (process.env.JPS_PUBLIC_ORIGIN || 'http://localhost:5173').replace(/\/$/, '');
const { legacyBridgeEnabled } = getOidcConfig();

function htmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function insertJitUser(email, payload) {
  const roleResult = await pool.query(
    `SELECT id FROM roles WHERE name = $1 AND deleted_at IS NULL`,
    [JIT_ROLE_NAME]
  );
  if (roleResult.rows.length === 0) {
    console.error('HUB_SSO_JIT_ROLE_NAME not found:', JIT_ROLE_NAME);
    throw new Error('JIT role not configured');
  }
  const roleId = roleResult.rows[0].id;

  const hubUserId =
    payload.user_id != null ? String(payload.user_id).replace(/[^a-zA-Z0-9-]/g, '').slice(0, 36) : '';
  const localPart = email.split('@')[0]?.replace(/[^a-zA-Z0-9._-]/g, '_') || 'user';
  const randomPw = crypto.randomBytes(32).toString('hex');
  const passwordHash = await bcrypt.hash(randomPw, 10);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let userId;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const suffix = attempt === 0 ? '' : `_${crypto.randomBytes(4).toString('hex')}`;
      const username = `hub_${localPart}${suffix}`;
      try {
        const ins = await client.query(
          `INSERT INTO users (username, display_name, email, password_hash, is_active, auth_source)
           VALUES ($1, $2, $3, $4, TRUE, 'sso')
           RETURNING id`,
          [username, localPart, email, passwordHash]
        );
        userId = ins.rows[0].id;
        break;
      } catch (e) {
        if (e.code === '23505' && attempt < 7) continue;
        throw e;
      }
    }
    if (userId == null) {
      throw new Error('Could not allocate username');
    }

    await client.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`, [userId, roleId]);

    if (JIT_PORTS === 'all') {
      const ports = await client.query(`SELECT id FROM ports WHERE deleted_at IS NULL ORDER BY id ASC`);
      for (const p of ports.rows) {
        await client.query(`INSERT INTO user_ports (user_id, port_id) VALUES ($1, $2)`, [userId, p.id]);
      }
    } else {
      const one = await client.query(
        `SELECT id FROM ports WHERE deleted_at IS NULL ORDER BY id ASC LIMIT 1`
      );
      if (one.rows.length > 0) {
        await client.query(`INSERT INTO user_ports (user_id, port_id) VALUES ($1, $2)`, [
          userId,
          one.rows[0].id,
        ]);
      }
    }

    await client.query('COMMIT');
    console.info(`Hub SSO: JIT user created id=${userId} email=${email} hub_user_id=${hubUserId || 'n/a'}`);
    return userId;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

router.post('/hub', urlencoded, async (req, res) => {
  try {
    if (!legacyBridgeEnabled) {
      return res.status(410).type('html')
        .send(`<!DOCTYPE html><html><body><p>Legacy SSO bridge disabled. Use OIDC launch flow.</p></body></html>`);
    }
    if (!SSO_SECRET) {
      return res.status(503).type('html')
        .send(`<!DOCTYPE html><html><body><p>SSO is not configured on this server.</p></body></html>`);
    }

    const rawToken = req.body?.token;
    if (!rawToken || typeof rawToken !== 'string') {
      return res.status(400).type('html')
        .send(`<!DOCTYPE html><html><body><p>Missing token.</p></body></html>`);
    }

    let payload;
    try {
      payload = jwt.verify(rawToken, SSO_SECRET, { algorithms: ['HS256'] });
    } catch {
      return res.status(401).type('html')
        .send(`<!DOCTYPE html><html><body><p>Invalid or expired SSO token. Open Jetty from Downstream Hub again.</p></body></html>`);
    }

    const email = typeof payload.email === 'string' ? payload.email.trim() : '';
    if (!email) {
      return res.status(400).type('html')
        .send(`<!DOCTYPE html><html><body><p>SSO token has no email claim.</p></body></html>`);
    }

    const lookup = await pool.query(
      `SELECT id, is_active FROM users
       WHERE lower(email) = lower($1) AND deleted_at IS NULL`,
      [email]
    );

    let userId;
    if (lookup.rows.length > 0) {
      const row = lookup.rows[0];
      if (!row.is_active) {
        return res.status(403).type('html')
          .send(`<!DOCTYPE html><html><body><p>Your account is inactive.</p></body></html>`);
      }
      userId = row.id;
    } else if (!JIT_PROVISION) {
      return res.status(403).type('html')
        .send(`<!DOCTYPE html><html><body><p>${htmlEscape(
          'No Jetty account for this email. Ask an administrator to create your user, or enable JIT provisioning.'
        )}</p></body></html>`);
    } else {
      if (!JIT_ROLE_NAME) {
        console.error('HUB_SSO_JIT_PROVISION=true but HUB_SSO_JIT_ROLE_NAME is empty');
        return res.status(500).type('html')
          .send(`<!DOCTYPE html><html><body><p>Server SSO configuration error.</p></body></html>`);
      }
      try {
        userId = await insertJitUser(email, payload);
      } catch (e) {
        if (e.message === 'JIT role not configured') {
          return res.status(500).type('html')
            .send(`<!DOCTYPE html><html><body><p>Server SSO configuration error (role).</p></body></html>`);
        }
        throw e;
      }
    }

    setSessionCookiesForUserId(res, userId);
    const target = `${PUBLIC_ORIGIN}/`;
    logAuthEvent('legacy-hub.callback.success', { userId, ip: req.ip });
    return res.redirect(302, target);
  } catch (err) {
    logAuthEvent('legacy-hub.callback.failure', { reason: err.message, ip: req.ip });
    return res.status(500).type('html')
      .send(`<!DOCTYPE html><html><body><p>Sign-on failed. Try again from Downstream Hub.</p></body></html>`);
  }
});

export default router;
