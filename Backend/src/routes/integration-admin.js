/**
 * Admin UI for managing partner integration API keys (integration_api_keys, migration 084).
 * Mirrors scripts/create-integration-api-key.mjs: keys are jps_live_<hex>, only the SHA-256
 * hash + a short prefix are stored, and the plaintext is returned exactly once on creation.
 * Gated by the shared 'admin' page permission (same as Users/Roles).
 */
import crypto from 'crypto';
import express from 'express';
import { pool } from '../db.js';
import { requireAdminPageView } from '../middleware/permissions.js';
import { hashApiKey } from '../middleware/integration-auth.js';
import { writeActivityLog } from '../lib/activity-log.js';

const router = express.Router();
router.use(...requireAdminPageView);

function toKeyRow(row) {
  return {
    id: Number(row.id),
    partnerName: row.partner_name,
    keyPrefix: row.key_prefix,
    maskedKey: `${row.key_prefix}…`,
    active: Boolean(row.active),
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at ?? null,
    deactivatedAt: row.deactivated_at ?? null,
  };
}

router.get('/', async (req, res) => {
  const r = await pool.query(
    `SELECT id, partner_name, key_prefix, active, created_at, last_used_at, deactivated_at
     FROM integration_api_keys ORDER BY id DESC`
  );
  res.json(r.rows.map(toKeyRow));
});

router.post('/', async (req, res) => {
  const partnerName = typeof req.body?.partnerName === 'string' ? req.body.partnerName.trim() : '';
  if (!partnerName) return res.status(400).json({ error: 'partnerName is required' });
  if (partnerName.length > 200) return res.status(400).json({ error: 'partnerName max length 200' });

  const plaintext = `jps_live_${crypto.randomBytes(16).toString('hex')}`;
  const keyHash = hashApiKey(plaintext);
  const keyPrefix = plaintext.slice(0, 13);

  // Keys are not port-scoped; partners pass a valid port_id per request (validated by the integration route).
  const ins = await pool.query(
    `INSERT INTO integration_api_keys (partner_name, key_prefix, key_hash)
     VALUES ($1, $2, $3)
     RETURNING id, partner_name, key_prefix, active, created_at, last_used_at, deactivated_at`,
    [partnerName, keyPrefix, keyHash]
  );
  const created = ins.rows[0];

  writeActivityLog({
    pageKey: 'admin',
    action: 'create',
    entityType: 'IntegrationApiKey',
    entityId: String(created.id),
    entityLabel: partnerName,
    summary: `Created partner API key for "${partnerName}"`,
    meta: { keyPrefix },
    actorUserId: req.userId ?? null,
  }).catch(() => {});

  res.status(201).json({ ...toKeyRow(created), plaintextKey: plaintext });
});

router.post('/:id/deactivate', async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

  const r = await pool.query(
    `UPDATE integration_api_keys SET active = false, deactivated_at = NOW()
     WHERE id = $1 AND active
     RETURNING id, partner_name, key_prefix, active, created_at, last_used_at, deactivated_at`,
    [id]
  );
  if (r.rows.length === 0) {
    return res.status(404).json({ error: 'No active API key with that id' });
  }
  const row = r.rows[0];

  writeActivityLog({
    pageKey: 'admin',
    action: 'deactivate',
    entityType: 'IntegrationApiKey',
    entityId: String(row.id),
    entityLabel: row.partner_name,
    summary: `Revoked partner API key for "${row.partner_name}"`,
    meta: { keyPrefix: row.key_prefix },
    actorUserId: req.userId ?? null,
  }).catch(() => {});

  res.json(toKeyRow(row));
});

export default router;
