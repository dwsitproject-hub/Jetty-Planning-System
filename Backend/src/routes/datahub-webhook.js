/**
 * Inbound DataHub (DHM) webhook endpoint — no session auth; HMAC only.
 */
import { pool } from '../db.js';
import { processInboundWebhook } from '../lib/datahub-webhook.js';

export async function datahubWebhookHandler(req, res) {
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body ?? ''), 'utf8');
  const result = await processInboundWebhook(pool, rawBody, req.headers);
  return res.status(result.status).json(result.body);
}
