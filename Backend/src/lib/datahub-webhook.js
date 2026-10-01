/**
 * Inbound DataHub (DHM) webhooks — verify, dedupe, stage vessel sync.
 * Contract: Docs/Guide/DATAHUB_CLIENT_INTEGRATION.md §10
 */
import crypto from 'crypto';
import { normalizeHubRecord } from './datahub-client.js';
import { getEffectiveWebhookConfig, getEffectiveWebhookAutoApply, updateDataHubWebhookHealth } from './datahub-config.js';
import { stageEntityFromHub, applyStagedEntitySyncRun } from './datahub-master-stage.js';

const WEBHOOK_ENTITY_TYPES = new Set(['vessel', 'incoterm', 'commodity', 'port_master']);

/**
 * @param {string} secret
 * @param {Buffer|string} rawBody
 * @param {string|null|undefined} signatureHeader
 */
export function verifyDhmWebhookSignature(secret, rawBody, signatureHeader) {
  if (!secret || !signatureHeader) return false;
  const expected =
    'sha256=' +
    crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(String(signatureHeader).trim());
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * @param {Buffer|string} rawBody
 * @param {Record<string, string|undefined>} headers lower-case keys optional
 */
export function parseDhmWebhookPayload(rawBody, headers = {}) {
  const h = normalizeHeaders(headers);
  let payload;
  try {
    payload = JSON.parse(typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8'));
  } catch {
    return { error: 'Invalid JSON body' };
  }
  const deliveryId =
    (h['x-dhm-delivery-id'] && String(h['x-dhm-delivery-id']).trim()) ||
    (payload.deliveryId != null && String(payload.deliveryId).trim()) ||
    null;
  if (!deliveryId) return { error: 'Missing delivery id' };
  const event =
    (h['x-dhm-event'] && String(h['x-dhm-event']).trim()) ||
    (payload.event != null && String(payload.event).trim()) ||
    null;
  return { payload, deliveryId, event };
}

function normalizeHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers || {})) {
    if (v != null) out[String(k).toLowerCase()] = String(v);
  }
  return out;
}

/**
 * @param {object} payload parsed JSON body
 * @param {string|null} eventHeader
 */
export function hubRecordFromWebhookPayload(payload, eventHeader, entityType = 'vessel') {
  const event = eventHeader || payload.event || '';
  const isDeleted = event === 'record.deleted' || payload.isDeleted === true;
  const record = {
    id: payload.recordId ?? payload.id,
    version: payload.version,
    isDeleted,
    updatedAt: payload.occurredAt ?? payload.updatedAt,
    data: payload.data,
  };
  return normalizeHubRecord(entityType, record);
}

function strHubCode(data) {
  if (!data || typeof data !== 'object') return null;
  const c = data.code ?? data.Code;
  return c != null && String(c).trim() ? String(c).trim() : null;
}

/**
 * @param {import('pg').Pool} db
 * @param {Buffer} rawBody
 * @param {Record<string, string|undefined>} headers
 * @returns {Promise<{ status: number, body: object }>}
 */
export async function processInboundWebhook(db, rawBody, headers) {
  const whCfg = await getEffectiveWebhookConfig(db);
  if (!whCfg.enabled || !whCfg.secret) {
    return {
      status: 503,
      body: { error: 'DataHub webhooks disabled or webhook secret not configured' },
    };
  }

  const sig =
    headers['x-dhm-signature'] ??
    headers['X-DHM-Signature'] ??
    headers['X-Dhm-Signature'];
  if (!verifyDhmWebhookSignature(whCfg.secret, rawBody, sig)) {
    await updateDataHubWebhookHealth(db, { ok: false, error: 'Invalid webhook signature' });
    return { status: 401, body: { error: 'Invalid webhook signature' } };
  }

  const parsed = parseDhmWebhookPayload(rawBody, headers);
  if (parsed.error) {
    await updateDataHubWebhookHealth(db, { ok: false, error: parsed.error });
    return { status: 400, body: { error: parsed.error } };
  }

  const { payload, deliveryId, event } = parsed;
  const entityType = String(payload.entityType || '').trim().toLowerCase();
  const hubCode = strHubCode(payload.data);
  const recordId = payload.recordId != null ? String(payload.recordId) : null;

  const dup = await db.query(
    `SELECT id, status FROM datahub_webhook_receipts WHERE delivery_id = $1`,
    [deliveryId]
  );
  if (dup.rows.length > 0) {
    return { status: 200, body: { status: 'duplicate', deliveryId } };
  }

  async function insertReceipt(status, syncRunId, error) {
    await db.query(
      `INSERT INTO datahub_webhook_receipts (
         delivery_id, event, entity_type, record_id, hub_code, sync_run_id, status, error
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [deliveryId, event, entityType || null, recordId, hubCode, syncRunId, status, error]
    );
  }

  if (entityType && !WEBHOOK_ENTITY_TYPES.has(entityType)) {
    await insertReceipt('ignored', null, 'unsupported entityType');
    await updateDataHubWebhookHealth(db, { ok: true });
    return { status: 200, body: { status: 'ignored', reason: 'unsupported entityType' } };
  }

  const resolvedEntity = entityType || 'vessel';

  if (event === 'record.created') {
    await insertReceipt('ignored', null, 'record.created not subscribed');
    await updateDataHubWebhookHealth(db, { ok: true });
    return { status: 200, body: { status: 'ignored', reason: 'record.created' } };
  }

  if (event === 'record.deleted') {
    await insertReceipt('ignored', null, 'hub_tombstone_policy');
    await updateDataHubWebhookHealth(db, { ok: true });
    return { status: 200, body: { status: 'ignored', reason: 'hub_tombstone_policy' } };
  }

  const hubRecord = hubRecordFromWebhookPayload(payload, event, resolvedEntity);
  if (!hubRecord) {
    await insertReceipt('failed', null, 'missing master payload');
    await updateDataHubWebhookHealth(db, { ok: false, error: 'missing master payload' });
    return { status: 400, body: { error: 'missing master payload' } };
  }

  try {
    const autoApply = await getEffectiveWebhookAutoApply(db);
    const { runId, items } = await stageEntityFromHub(db, resolvedEntity, [hubRecord], {
      source: 'webhook',
      webhookDeliveryId: deliveryId,
      preapproveChanges: autoApply,
    });

    if (runId == null) {
      await insertReceipt('ignored', null, 'unchanged');
      await updateDataHubWebhookHealth(db, { ok: true });
      return { status: 200, body: { status: 'ignored', reason: 'unchanged' } };
    }

    if (autoApply) {
      try {
        const stats = await applyStagedEntitySyncRun(db, runId, null);
        await insertReceipt('accepted', runId, null);
        await updateDataHubWebhookHealth(db, { ok: true });
        return {
          status: 200,
          body: {
            status: 'applied',
            deliveryId,
            runId,
            stagedCount: items.length,
            ...stats,
          },
        };
      } catch (e) {
        const errMsg = String(e?.message || 'auto-apply failed').slice(0, 2000);
        await db
          .query(`UPDATE datahub_vessel_sync_runs SET status = 'failed', error = $1 WHERE id = $2`, [
            errMsg,
            runId,
          ])
          .catch(() => {});
        await insertReceipt('failed', runId, errMsg);
        await updateDataHubWebhookHealth(db, { ok: false, error: errMsg });
        return { status: 500, body: { error: 'Auto-apply failed', message: errMsg } };
      }
    }

    await insertReceipt('accepted', runId, null);
    await updateDataHubWebhookHealth(db, { ok: true });
    return {
      status: 200,
      body: {
        status: 'accepted',
        deliveryId,
        runId,
        stagedCount: items.length,
      },
    };
  } catch (e) {
    await insertReceipt('failed', null, e?.message || 'stage failed');
    await updateDataHubWebhookHealth(db, { ok: false, error: e?.message });
    return { status: 500, body: { error: 'Failed to stage webhook sync' } };
  }
}

/** Sign a body for tests / simulate script (same algorithm as DHM). */
export function signDhmWebhookBody(secret, rawBody) {
  return (
    'sha256=' +
    crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  );
}
