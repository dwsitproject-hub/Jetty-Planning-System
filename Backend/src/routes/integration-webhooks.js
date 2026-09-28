/**
 * Partner webhook registration routes (v5.0).
 */
import express from 'express';
import {
  createWebhookEndpoint,
  deactivateWebhookEndpoint,
  listWebhookEndpoints,
  updateWebhookEndpoint,
  WEBHOOK_EVENT_TYPES,
} from '../lib/integration-webhooks.js';
import { pool } from '../db.js';
import { sendIntegrationError, sendIntegrationSuccess } from '../middleware/integration-auth.js';

const router = express.Router();

function parseEvents(raw) {
  if (raw == null) return undefined;
  if (!Array.isArray(raw)) return null;
  return raw.map((e) => String(e).trim()).filter(Boolean);
}

router.get('/', async (req, res) => {
  const rows = await listWebhookEndpoints(pool, req.integrationKey.id);
  return sendIntegrationSuccess(res, 200, { endpoints: rows, available_events: WEBHOOK_EVENT_TYPES });
});

router.post('/', async (req, res) => {
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  const events = parseEvents(b.events);
  if (b.events != null && events == null) {
    return sendIntegrationError(res, 400, 'VALIDATION_ERROR', 'Payload validation failed', [
      { field: 'events', issue: 'must be an array' },
    ]);
  }
  const result = await createWebhookEndpoint(pool, req.integrationKey.id, {
    url: b.url,
    events: events ?? ['*'],
    secret: b.secret ?? null,
  });
  if (result.error) {
    return sendIntegrationError(res, 400, 'VALIDATION_ERROR', 'Payload validation failed', [
      { field: 'url', issue: result.error },
    ]);
  }
  return sendIntegrationSuccess(res, 201, {
    ...result.endpoint,
    secret: result.plaintextSecret,
    secret_note: 'Store this secret securely; it is shown once and used to verify webhook signatures.',
  });
});

router.patch('/:id', async (req, res) => {
  const endpointId = Number.parseInt(req.params.id, 10);
  if (Number.isNaN(endpointId)) {
    return sendIntegrationError(res, 400, 'VALIDATION_ERROR', 'Invalid id', [
      { field: 'id', issue: 'must be an integer' },
    ]);
  }
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  const events = parseEvents(b.events);
  if (b.events != null && events == null) {
    return sendIntegrationError(res, 400, 'VALIDATION_ERROR', 'Payload validation failed', [
      { field: 'events', issue: 'must be an array' },
    ]);
  }
  const result = await updateWebhookEndpoint(pool, req.integrationKey.id, endpointId, {
    url: b.url,
    events: events ?? undefined,
    active: b.active,
    rotate_secret: b.rotate_secret === true,
    secret: b.secret,
  });
  if (result.error === 'not_found') {
    return sendIntegrationError(res, 404, 'NOT_FOUND', 'Webhook endpoint not found');
  }
  if (result.error) {
    return sendIntegrationError(res, 400, 'VALIDATION_ERROR', 'Payload validation failed', [
      { field: 'body', issue: result.error },
    ]);
  }
  const data = { ...result.endpoint };
  if (result.plaintextSecret) {
    data.secret = result.plaintextSecret;
    data.secret_note = 'New secret shown once; update your signature verifier.';
  }
  return sendIntegrationSuccess(res, 200, data);
});

router.delete('/:id', async (req, res) => {
  const endpointId = Number.parseInt(req.params.id, 10);
  if (Number.isNaN(endpointId)) {
    return sendIntegrationError(res, 400, 'VALIDATION_ERROR', 'Invalid id', [
      { field: 'id', issue: 'must be an integer' },
    ]);
  }
  const ok = await deactivateWebhookEndpoint(pool, req.integrationKey.id, endpointId);
  if (!ok) return sendIntegrationError(res, 404, 'NOT_FOUND', 'Webhook endpoint not found');
  return sendIntegrationSuccess(res, 200, { id: endpointId, active: false });
});

export default router;
