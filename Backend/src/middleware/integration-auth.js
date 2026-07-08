/**
 * Partner integration API auth (x-api-key) + response envelope helpers.
 * Contract: Docs/Guide/INBOUND-SHIPPING-INSTRUCTION-PARTNER-API.md.
 */
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { pool } from '../db.js';

export function newRequestId() {
  return `req_${crypto.randomBytes(10).toString('hex')}`;
}

export function sendIntegrationSuccess(res, status, data) {
  return res.status(status).json({ success: true, data });
}

export function sendIntegrationError(res, status, code, message, details = null) {
  return res.status(status).json({
    success: false,
    error: { code, message, details },
    request_id: res.req?.integrationRequestId || newRequestId(),
  });
}

export function hashApiKey(plaintextKey) {
  return crypto.createHash('sha256').update(plaintextKey, 'utf8').digest('hex');
}

/**
 * Validates the x-api-key header against integration_api_keys.
 * On success sets req.integrationKey = { id, partnerName, allowedPortIds }.
 */
export async function requireIntegrationKey(req, res, next) {
  req.integrationRequestId = newRequestId();
  const rawKey = req.headers['x-api-key'];
  if (!rawKey || typeof rawKey !== 'string' || !rawKey.trim()) {
    return sendIntegrationError(res, 401, 'INVALID_API_KEY', 'API key is missing or invalid');
  }
  const keyHash = hashApiKey(rawKey.trim());
  const r = await pool.query(
    `SELECT id, partner_name, allowed_port_ids
     FROM integration_api_keys
     WHERE key_hash = $1 AND active`,
    [keyHash]
  );
  if (r.rows.length === 0) {
    return sendIntegrationError(res, 401, 'INVALID_API_KEY', 'API key is missing or invalid');
  }
  const row = r.rows[0];
  req.integrationKey = {
    id: Number(row.id),
    partnerName: row.partner_name,
    allowedPortIds: (row.allowed_port_ids || []).map(Number),
  };
  pool
    .query(`UPDATE integration_api_keys SET last_used_at = NOW() WHERE id = $1`, [row.id])
    .catch(() => {});
  next();
}

/** 120 requests/minute per API key (per the partner guide). Falls back to IP before auth resolves. */
export const integrationRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.INTEGRATION_RATE_LIMIT_PER_MINUTE || 120),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.integrationKey ? `key:${req.integrationKey.id}` : `ip:${req.ip}`),
  handler: (req, res) => {
    sendIntegrationError(res, 429, 'RATE_LIMITED', 'Rate limit exceeded; retry after the window resets');
  },
});
