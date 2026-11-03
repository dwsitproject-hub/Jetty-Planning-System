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
import {
  createWebhookEndpoint,
  deactivateWebhookEndpoint,
  listWebhookDeliveriesForEndpoint,
  listWebhookEndpoints,
  retryFailedWebhookDelivery,
  updateWebhookEndpoint,
  WEBHOOK_EVENT_TYPES,
} from '../lib/integration-webhooks.js';

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

async function assertApiKeyId(keyId) {
  if (!Number.isFinite(keyId)) return null;
  const r = await pool.query(`SELECT id, partner_name FROM integration_api_keys WHERE id = $1`, [keyId]);
  return r.rows[0] ?? null;
}

function parseEvents(raw) {
  if (raw == null) return undefined;
  if (!Array.isArray(raw)) return null;
  return raw.map((e) => String(e).trim()).filter(Boolean);
}

router.get('/:keyId/webhooks', async (req, res) => {
  const keyId = Number.parseInt(req.params.keyId, 10);
  const keyRow = await assertApiKeyId(keyId);
  if (!keyRow) return res.status(404).json({ error: 'Partner API key not found' });

  const endpoints = await listWebhookEndpoints(pool, keyId);
  res.json({ endpoints, available_events: WEBHOOK_EVENT_TYPES });
});

router.post('/:keyId/webhooks', async (req, res) => {
  const keyId = Number.parseInt(req.params.keyId, 10);
  const keyRow = await assertApiKeyId(keyId);
  if (!keyRow) return res.status(404).json({ error: 'Partner API key not found' });

  const b = req.body && typeof req.body === 'object' ? req.body : {};
  const events = parseEvents(b.events);
  if (b.events != null && events == null) {
    return res.status(400).json({ error: 'events must be an array' });
  }

  const result = await createWebhookEndpoint(pool, keyId, {
    url: b.url,
    events: events ?? ['*'],
    secret: b.secret ?? null,
  });
  if (result.error) {
    return res.status(400).json({ error: result.error, field: 'url' });
  }

  writeActivityLog({
    pageKey: 'admin',
    action: 'create',
    entityType: 'IntegrationWebhook',
    entityId: String(result.endpoint.id),
    entityLabel: keyRow.partner_name,
    summary: `Registered partner webhook for "${keyRow.partner_name}"`,
    meta: { url: result.endpoint.url, apiKeyId: keyId },
    actorUserId: req.userId ?? null,
  }).catch(() => {});

  res.status(201).json({
    endpoint: result.endpoint,
    plaintextSecret: result.plaintextSecret,
    secretNote: 'Store this secret securely; it is shown once and used to verify webhook signatures.',
  });
});

router.patch('/:keyId/webhooks/:endpointId', async (req, res) => {
  const keyId = Number.parseInt(req.params.keyId, 10);
  const endpointId = Number.parseInt(req.params.endpointId, 10);
  const keyRow = await assertApiKeyId(keyId);
  if (!keyRow) return res.status(404).json({ error: 'Partner API key not found' });
  if (Number.isNaN(endpointId)) return res.status(400).json({ error: 'Invalid endpoint id' });

  const b = req.body && typeof req.body === 'object' ? req.body : {};
  const events = parseEvents(b.events);
  if (b.events != null && events == null) {
    return res.status(400).json({ error: 'events must be an array' });
  }

  const result = await updateWebhookEndpoint(pool, keyId, endpointId, {
    url: b.url,
    events: events ?? undefined,
    active: b.active,
    rotate_secret: b.rotate_secret === true,
    secret: b.secret,
  });
  if (result.error === 'not_found') {
    return res.status(404).json({ error: 'Webhook endpoint not found' });
  }
  if (result.error) {
    return res.status(400).json({ error: result.error });
  }

  writeActivityLog({
    pageKey: 'admin',
    action: 'update',
    entityType: 'IntegrationWebhook',
    entityId: String(endpointId),
    entityLabel: keyRow.partner_name,
    summary: `Updated partner webhook for "${keyRow.partner_name}"`,
    meta: { apiKeyId: keyId },
    actorUserId: req.userId ?? null,
  }).catch(() => {});

  const body = { endpoint: result.endpoint };
  if (result.plaintextSecret) {
    body.plaintextSecret = result.plaintextSecret;
    body.secretNote = 'New secret shown once; update the partner signature verifier.';
  }
  res.json(body);
});

router.post('/:keyId/webhooks/:endpointId/deactivate', async (req, res) => {
  const keyId = Number.parseInt(req.params.keyId, 10);
  const endpointId = Number.parseInt(req.params.endpointId, 10);
  const keyRow = await assertApiKeyId(keyId);
  if (!keyRow) return res.status(404).json({ error: 'Partner API key not found' });
  if (Number.isNaN(endpointId)) return res.status(400).json({ error: 'Invalid endpoint id' });

  const ok = await deactivateWebhookEndpoint(pool, keyId, endpointId);
  if (!ok) return res.status(404).json({ error: 'Webhook endpoint not found' });

  writeActivityLog({
    pageKey: 'admin',
    action: 'deactivate',
    entityType: 'IntegrationWebhook',
    entityId: String(endpointId),
    entityLabel: keyRow.partner_name,
    summary: `Deactivated partner webhook for "${keyRow.partner_name}"`,
    meta: { apiKeyId: keyId },
    actorUserId: req.userId ?? null,
  }).catch(() => {});

  res.json({ id: endpointId, active: false });
});

router.get('/:keyId/webhooks/:endpointId/deliveries', async (req, res) => {
  const keyId = Number.parseInt(req.params.keyId, 10);
  const endpointId = Number.parseInt(req.params.endpointId, 10);
  const keyRow = await assertApiKeyId(keyId);
  if (!keyRow) return res.status(404).json({ error: 'Partner API key not found' });
  if (Number.isNaN(endpointId)) return res.status(400).json({ error: 'Invalid endpoint id' });

  const result = await listWebhookDeliveriesForEndpoint(pool, keyId, endpointId, {
    limit: req.query.limit,
    offset: req.query.offset,
    status: req.query.status,
  });
  if (result.error === 'not_found') {
    return res.status(404).json({ error: 'Webhook endpoint not found' });
  }
  res.json({ deliveries: result.deliveries, total: result.total });
});

router.post('/:keyId/webhooks/:endpointId/deliveries/:deliveryId/retry', async (req, res) => {
  const keyId = Number.parseInt(req.params.keyId, 10);
  const endpointId = Number.parseInt(req.params.endpointId, 10);
  const deliveryId = String(req.params.deliveryId ?? '').trim();
  const keyRow = await assertApiKeyId(keyId);
  if (!keyRow) return res.status(404).json({ error: 'Partner API key not found' });
  if (Number.isNaN(endpointId) || !deliveryId) {
    return res.status(400).json({ error: 'Invalid endpoint or delivery id' });
  }

  const result = await retryFailedWebhookDelivery(pool, keyId, endpointId, deliveryId);
  if (result.error === 'not_found') {
    return res.status(404).json({ error: 'Webhook endpoint not found' });
  }
  if (result.error === 'not_found_or_not_failed') {
    return res.status(404).json({ error: 'Delivery not found or not in failed state' });
  }
  res.json({ delivery_id: result.delivery_id, status: 'pending' });
});

export default router;
