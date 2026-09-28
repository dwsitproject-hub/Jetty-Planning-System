/**
 * Unit tests for inbound DHM webhooks.
 * Run: npm run test:datahub
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { describe, it, before, after, beforeEach } from 'node:test';
import {
  verifyDhmWebhookSignature,
  parseDhmWebhookPayload,
  hubRecordFromWebhookPayload,
  signDhmWebhookBody,
  processInboundWebhook,
} from './datahub-webhook.js';

const SECRET = 'whsec_demo_secret';

describe('datahub-webhook', () => {
  it('verifyDhmWebhookSignature accepts valid HMAC', () => {
    const body = Buffer.from('{"event":"record.updated"}', 'utf8');
    const sig = signDhmWebhookBody(SECRET, body);
    assert.equal(verifyDhmWebhookSignature(SECRET, body, sig), true);
  });

  it('verifyDhmWebhookSignature rejects tampered body', () => {
    const body = Buffer.from('{"event":"record.updated"}', 'utf8');
    const sig = signDhmWebhookBody(SECRET, body);
    const tampered = Buffer.from('{"event":"record.deleted"}', 'utf8');
    assert.equal(verifyDhmWebhookSignature(SECRET, tampered, sig), false);
  });

  it('parseDhmWebhookPayload reads delivery id from header', () => {
    const body = Buffer.from(JSON.stringify({ entityType: 'vessel', recordId: 'r1' }), 'utf8');
    const r = parseDhmWebhookPayload(body, { 'x-dhm-delivery-id': 'del-1', 'x-dhm-event': 'record.updated' });
    assert.equal(r.error, undefined);
    assert.equal(r.deliveryId, 'del-1');
    assert.equal(r.event, 'record.updated');
  });

  it('hubRecordFromWebhookPayload maps vessel data', () => {
    const payload = {
      recordId: 'uuid-1',
      version: 2,
      occurredAt: '2026-09-25T00:00:00.000Z',
      data: { code: 'VSL-0001', Vessel_Name: 'TEST SHIP', Vessel_Type: 'tanker' },
    };
    const hub = hubRecordFromWebhookPayload(payload, 'record.updated');
    assert.equal(hub.hubCode, 'VSL-0001');
    assert.equal(hub.values.vessel_name, 'TEST SHIP');
    assert.equal(hub.isDeleted, false);
  });

  it('processInboundWebhook returns duplicate for same delivery_id', async () => {
    process.env.DHM_WEBHOOK_ENABLED = 'true';
    process.env.DHM_WEBHOOK_SECRET = SECRET;
    process.env.JWT_SECRET = 'test-jwt-for-webhook-config';

    const receipts = new Map();
    const db = {
      async query(sql, params = []) {
        if (/FROM datahub_config/i.test(sql)) {
          return {
            rows: [
              {
                id: 1,
                base_url: null,
                public_key: null,
                private_key_encrypted: null,
                enabled: false,
                webhook_enabled: false,
                webhook_secret_encrypted: null,
                last_webhook_at: null,
                last_webhook_error: null,
              },
            ],
          };
        }
        if (/FROM datahub_webhook_receipts WHERE delivery_id/i.test(sql)) {
          return { rows: receipts.has(params[0]) ? [{ id: 1, status: 'accepted' }] : [] };
        }
        if (/INSERT INTO datahub_webhook_receipts/i.test(sql)) {
          receipts.set(params[0], true);
          return { rows: [{ id: 1 }] };
        }
        if (/UPDATE datahub_config SET\s+last_webhook_at/i.test(sql)) {
          return { rows: [] };
        }
        if (/FROM master_vessels/i.test(sql)) {
          return { rows: [] };
        }
        if (/INSERT INTO datahub_vessel_sync_runs/i.test(sql)) {
          return { rows: [{ id: 99 }] };
        }
        if (/INSERT INTO datahub_vessel_sync_items/i.test(sql)) {
          return { rows: [] };
        }
        if (/BEGIN/i.test(sql) || /COMMIT/i.test(sql) || /ROLLBACK/i.test(sql)) {
          return { rows: [] };
        }
        throw new Error(`unexpected: ${sql.slice(0, 80)}`);
      },
      connect: async () => ({
        query: db.query.bind(db),
        release: () => {},
      }),
    };

    const payload = {
      event: 'record.updated',
      deliveryId: 'del-dup-test',
      entityType: 'vessel',
      recordId: 'uuid-1',
      version: 2,
      occurredAt: '2026-09-25T00:00:00.000Z',
      data: { code: 'VSL-0002', Vessel_Name: 'NEW VESSEL', Vessel_Type: 'barge' },
    };
    const raw = Buffer.from(JSON.stringify(payload), 'utf8');
    const headers = {
      'x-dhm-signature': signDhmWebhookBody(SECRET, raw),
      'x-dhm-delivery-id': 'del-dup-test',
      'x-dhm-event': 'record.updated',
    };

    const first = await processInboundWebhook(db, raw, headers);
    assert.equal(first.status, 200);
    assert.equal(first.body.status, 'accepted');

    const second = await processInboundWebhook(db, raw, headers);
    assert.equal(second.status, 200);
    assert.equal(second.body.status, 'duplicate');
  });
});
