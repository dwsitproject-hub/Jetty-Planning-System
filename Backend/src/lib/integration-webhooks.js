/**
 * Partner integration webhooks — registration, enqueue, delivery.
 * Contract: Docs/Guide/INBOUND-SHIPPING-INSTRUCTION-PARTNER-API.md v5.0
 */
import crypto from 'crypto';
import { pool } from '../db.js';
import { buildPartnerInstructionPayload } from './integration-partner-payload.js';
import {
  PARTNER_SUBMISSION_BY_PLAN_SQL,
  PARTNER_SUBMISSION_BY_SI_SQL,
} from './integration-master-data.js';
import { decryptSmtpPassword, encryptSmtpPassword } from './smtp-config.js';

export const WEBHOOK_EVENT_TYPES = ['status.changed', 'schedule.updated'];
export const MAX_ACTIVE_WEBHOOKS_PER_KEY = 3;
export const WEBHOOK_DELIVERY_TIMEOUT_MS = 15_000;
export const WEBHOOK_RETRY_DELAYS_MS = [60_000, 300_000, 900_000, 3_600_000, 21_600_000];

function encryptSecret(plaintext) {
  return encryptSmtpPassword(plaintext);
}

function decryptSecret(ciphertext) {
  return decryptSmtpPassword(ciphertext);
}

export function generateWebhookSecret() {
  return `whsec_${crypto.randomBytes(24).toString('hex')}`;
}

export function newDeliveryId() {
  return `whd_${crypto.randomBytes(12).toString('hex')}`;
}

export function webhookSecretPrefix(secret) {
  return String(secret).slice(0, 14);
}

/** @param {string} secret @param {number} timestampMs @param {string} body */
export function signWebhookPayload(secret, timestampMs, body) {
  const payload = `${timestampMs}.${body}`;
  return crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}

function endpointAcceptsEvent(events, eventType) {
  const list = Array.isArray(events) ? events : [];
  if (list.includes('*')) return true;
  return list.includes(eventType);
}

function isHttpsUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:') return true;
    if (u.protocol === 'http:' && process.env.INTEGRATION_WEBHOOK_ALLOW_HTTP === 'true') return true;
    return false;
  } catch {
    return false;
  }
}

export function toWebhookEndpointRow(row) {
  return {
    id: Number(row.id),
    url: row.url,
    events: row.events ?? ['*'],
    active: Boolean(row.active),
    secret_prefix: row.secret_prefix,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {number} apiKeyId
 * @param {{ url: string, events?: string[], secret?: string | null }} input
 */
export async function createWebhookEndpoint(db, apiKeyId, input) {
  const url = String(input.url ?? '').trim();
  if (!url || !isHttpsUrl(url)) {
    return { error: 'url must be a valid HTTPS URL' };
  }
  const eventsRaw = input.events ?? ['*'];
  if (!Array.isArray(eventsRaw) || eventsRaw.length === 0) {
    return { error: 'events must be a non-empty array' };
  }
  const events = eventsRaw.map((e) => String(e).trim()).filter(Boolean);
  const invalid = events.filter((e) => e !== '*' && !WEBHOOK_EVENT_TYPES.includes(e));
  if (invalid.length > 0) {
    return { error: `unknown events: ${invalid.join(', ')}` };
  }

  const count = await db.query(
    `SELECT COUNT(*)::int AS c FROM integration_webhook_endpoints WHERE api_key_id = $1 AND active`,
    [apiKeyId]
  );
  if ((count.rows[0]?.c ?? 0) >= MAX_ACTIVE_WEBHOOKS_PER_KEY) {
    return { error: `maximum ${MAX_ACTIVE_WEBHOOKS_PER_KEY} active webhook endpoints per API key` };
  }

  const plaintextSecret =
    input.secret != null && String(input.secret).trim() !== ''
      ? String(input.secret).trim()
      : generateWebhookSecret();
  if (plaintextSecret.length < 16) {
    return { error: 'secret must be at least 16 characters when provided' };
  }

  const ins = await db.query(
    `INSERT INTO integration_webhook_endpoints (api_key_id, url, secret_encrypted, secret_prefix, events, active)
     VALUES ($1, $2, $3, $4, $5, TRUE)
     RETURNING id, url, events, active, secret_prefix, created_at, updated_at`,
    [apiKeyId, url, encryptSecret(plaintextSecret), webhookSecretPrefix(plaintextSecret), events]
  );
  return {
    endpoint: toWebhookEndpointRow(ins.rows[0]),
    plaintextSecret,
  };
}

/**
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {number} apiKeyId
 * @param {number} endpointId
 * @param {{ url?: string, events?: string[], active?: boolean, rotate_secret?: boolean, secret?: string }} input
 */
export async function updateWebhookEndpoint(db, apiKeyId, endpointId, input) {
  const cur = await db.query(
    `SELECT id, url, events, active, secret_encrypted, secret_prefix
     FROM integration_webhook_endpoints WHERE id = $1 AND api_key_id = $2`,
    [endpointId, apiKeyId]
  );
  if (cur.rows.length === 0) return { error: 'not_found' };
  const row = cur.rows[0];

  let url = row.url;
  if (input.url != null) {
    url = String(input.url).trim();
    if (!url || !isHttpsUrl(url)) return { error: 'url must be a valid HTTPS URL' };
  }

  let events = row.events ?? ['*'];
  if (input.events != null) {
    if (!Array.isArray(input.events) || input.events.length === 0) {
      return { error: 'events must be a non-empty array' };
    }
    events = input.events.map((e) => String(e).trim()).filter(Boolean);
    const invalid = events.filter((e) => e !== '*' && !WEBHOOK_EVENT_TYPES.includes(e));
    if (invalid.length > 0) return { error: `unknown events: ${invalid.join(', ')}` };
  }

  const active = input.active !== undefined ? Boolean(input.active) : Boolean(row.active);

  let secretEncrypted = row.secret_encrypted;
  let secretPrefix = row.secret_prefix;
  let plaintextSecret = null;
  if (input.rotate_secret || input.secret != null) {
    plaintextSecret =
      input.secret != null && String(input.secret).trim() !== ''
        ? String(input.secret).trim()
        : generateWebhookSecret();
    if (plaintextSecret.length < 16) return { error: 'secret must be at least 16 characters when provided' };
    secretEncrypted = encryptSecret(plaintextSecret);
    secretPrefix = webhookSecretPrefix(plaintextSecret);
  }

  const upd = await db.query(
    `UPDATE integration_webhook_endpoints SET
       url = $1, events = $2, active = $3, secret_encrypted = $4, secret_prefix = $5, updated_at = NOW()
     WHERE id = $6
     RETURNING id, url, events, active, secret_prefix, created_at, updated_at`,
    [url, events, active, secretEncrypted, secretPrefix, endpointId]
  );
  return { endpoint: toWebhookEndpointRow(upd.rows[0]), plaintextSecret };
}

export async function listWebhookEndpoints(db, apiKeyId) {
  const r = await db.query(
    `SELECT id, url, events, active, secret_prefix, created_at, updated_at
     FROM integration_webhook_endpoints WHERE api_key_id = $1 ORDER BY id DESC`,
    [apiKeyId]
  );
  return r.rows.map(toWebhookEndpointRow);
}

export async function deactivateWebhookEndpoint(db, apiKeyId, endpointId) {
  const r = await db.query(
    `UPDATE integration_webhook_endpoints SET active = FALSE, updated_at = NOW()
     WHERE id = $1 AND api_key_id = $2
     RETURNING id`,
    [endpointId, apiKeyId]
  );
  return r.rows.length > 0;
}

/** @param {import('pg').Pool} db @param {{ shipmentPlanId?: number, shippingInstructionId?: number, eventTypes: string[] }} opts */
async function loadSubmissionRows(db, { shipmentPlanId, shippingInstructionId }) {
  if (shippingInstructionId != null) {
    const r = await db.query(PARTNER_SUBMISSION_BY_SI_SQL, [shippingInstructionId]);
    return r.rows;
  }
  if (shipmentPlanId != null) {
    const r = await db.query(PARTNER_SUBMISSION_BY_PLAN_SQL, [shipmentPlanId]);
    return r.rows;
  }
  return [];
}

/**
 * Enqueue webhook deliveries for integration submissions tied to a plan or SI.
 * @param {import('pg').Pool} db
 * @param {{ shipmentPlanId?: number, shippingInstructionId?: number, eventTypes: string[] }} opts
 */
export async function enqueueIntegrationWebhookEvents(db, opts) {
  const eventTypes = (opts.eventTypes ?? []).filter((e) => WEBHOOK_EVENT_TYPES.includes(e));
  if (eventTypes.length === 0) return 0;

  const rows = await loadSubmissionRows(db, opts);
  if (rows.length === 0) return 0;

  let enqueued = 0;
  for (const row of rows) {
    const apiKeyId = Number(row.api_key_id);
    if (!Number.isFinite(apiKeyId)) continue;

    const endpoints = await db.query(
      `SELECT id, events FROM integration_webhook_endpoints WHERE api_key_id = $1 AND active`,
      [apiKeyId]
    );
    if (endpoints.rows.length === 0) continue;

    const data = buildPartnerInstructionPayload(row);
    for (const eventType of eventTypes) {
      const body = {
        event: eventType,
        occurred_at: new Date().toISOString(),
        data,
      };
      for (const ep of endpoints.rows) {
        if (!endpointAcceptsEvent(ep.events, eventType)) continue;
        await db.query(
          `INSERT INTO integration_webhook_deliveries (
             endpoint_id, delivery_id, event_type, si_id, external_reference, payload, status, next_attempt_at
           ) VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW())`,
          [
            ep.id,
            newDeliveryId(),
            eventType,
            Number(row.si_id),
            row.external_reference,
            body,
          ]
        );
        enqueued += 1;
      }
    }
  }
  return enqueued;
}

/** Fire-and-forget after HTTP handlers commit. */
export function triggerPartnerWebhooksDeferred(opts) {
  setImmediate(() => {
    enqueueIntegrationWebhookEvents(pool, opts).catch((err) => {
      console.error('[integration-webhooks] enqueue failed:', err?.message || err);
    });
  });
}

/** @param {import('pg').Pool} db @param {number} limit */
export async function processWebhookDeliveryQueueOnce(db, limit = 20) {
  const batch = await db.query(
    `SELECT d.id, d.delivery_id, d.event_type, d.payload, d.attempt_count,
            e.url, e.secret_encrypted
     FROM integration_webhook_deliveries d
     JOIN integration_webhook_endpoints e ON e.id = d.endpoint_id AND e.active
     WHERE d.status = 'pending' AND d.next_attempt_at <= NOW()
     ORDER BY d.id ASC
     LIMIT $1`,
    [limit]
  );

  let processed = 0;
  for (const row of batch.rows) {
    processed += 1;
    let secret;
    try {
      secret = decryptSecret(row.secret_encrypted);
    } catch (e) {
      await db.query(
        `UPDATE integration_webhook_deliveries SET status = 'failed', last_error = $2, attempt_count = attempt_count + 1 WHERE id = $1`,
        [row.id, `secret decrypt failed: ${e?.message || e}`.slice(0, 500)]
      );
      continue;
    }

    const body = JSON.stringify(row.payload);
    const timestampMs = Date.now();
    const signature = signWebhookPayload(secret, timestampMs, body);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), WEBHOOK_DELIVERY_TIMEOUT_MS);

    try {
      const res = await fetch(row.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-JPS-Event': row.event_type,
          'X-JPS-Delivery-Id': row.delivery_id,
          'X-JPS-Timestamp': String(timestampMs),
          'X-JPS-Signature': `sha256=${signature}`,
          'User-Agent': 'JPS-Integration-Webhook/5.0',
        },
        body,
        signal: ctrl.signal,
      });
      clearTimeout(timer);

      if (res.ok) {
        await db.query(
          `UPDATE integration_webhook_deliveries SET status = 'sent', sent_at = NOW(), attempt_count = attempt_count + 1, last_error = NULL WHERE id = $1`,
          [row.id]
        );
        continue;
      }

      const errText = `HTTP ${res.status} ${(await res.text()).slice(0, 300)}`;
      await scheduleRetryOrFail(db, row, errText);
    } catch (e) {
      clearTimeout(timer);
      const msg = e?.name === 'AbortError' ? 'delivery timed out' : e?.message || String(e);
      await scheduleRetryOrFail(db, row, msg.slice(0, 500));
    }
  }
  return processed;
}

async function scheduleRetryOrFail(db, row, errText) {
  const attempt = Number(row.attempt_count ?? 0) + 1;
  if (attempt >= WEBHOOK_RETRY_DELAYS_MS.length) {
    await db.query(
      `UPDATE integration_webhook_deliveries SET status = 'failed', attempt_count = $2, last_error = $3 WHERE id = $1`,
      [row.id, attempt, errText]
    );
    return;
  }
  const delay = WEBHOOK_RETRY_DELAYS_MS[attempt - 1] ?? WEBHOOK_RETRY_DELAYS_MS.at(-1);
  await db.query(
    `UPDATE integration_webhook_deliveries SET attempt_count = $2, last_error = $3,
       next_attempt_at = NOW() + ($4::int * interval '1 millisecond')
     WHERE id = $1`,
    [row.id, attempt, errText, delay]
  );
}
