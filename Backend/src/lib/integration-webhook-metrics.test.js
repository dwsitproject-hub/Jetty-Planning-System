import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test';
process.env.JWT_SECRET ??= 'test-secret-for-webhook-metrics';

const { processWebhookDeliveryQueueOnce } = await import('./integration-webhooks.js');
const { encryptSmtpPassword } = await import('./smtp-config.js');

const realFetch = globalThis.fetch;

function fakeDb(attemptCount = 0) {
  const updates = [];
  const row = {
    id: 11,
    delivery_id: 'whd_x',
    event_type: 'status.changed',
    payload: { event: 'status.changed' },
    attempt_count: attemptCount,
    url: 'https://klip.example.com/hook',
    secret_encrypted: encryptSmtpPassword('whsec_test'),
  };
  return {
    updates,
    query: async (sql, params) => {
      if (sql.includes('FROM integration_webhook_deliveries d')) return { rows: [row] };
      updates.push({ sql, params });
      return { rows: [] };
    },
  };
}

describe('webhook worker attempt metrics', () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('stores HTTP status and duration when the partner accepts the delivery', async () => {
    globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => '' });
    const db = fakeDb();
    await processWebhookDeliveryQueueOnce(db, 5);
    assert.equal(db.updates.length, 1);
    const { sql, params } = db.updates[0];
    assert.match(sql, /status = 'sent'/);
    assert.match(sql, /last_http_status = \$2/);
    assert.equal(params[1], 200);
    assert.equal(typeof params[2], 'number');
  });

  it('stores the failing HTTP status and schedules a retry', async () => {
    globalThis.fetch = async () => ({ ok: false, status: 503, text: async () => 'unavailable' });
    const db = fakeDb(0);
    await processWebhookDeliveryQueueOnce(db, 5);
    const { sql, params } = db.updates[0];
    assert.match(sql, /next_attempt_at/);
    assert.match(sql, /last_attempt_at = NOW\(\)/);
    assert.match(params[2], /^HTTP 503/);
    assert.equal(params[4], 503);
  });

  it('marks the delivery failed with a null HTTP status when the request throws', async () => {
    globalThis.fetch = async () => {
      throw new Error('connect ECONNREFUSED');
    };
    const db = fakeDb(10);
    await processWebhookDeliveryQueueOnce(db, 5);
    const { sql, params } = db.updates[0];
    assert.match(sql, /status = 'failed'/);
    assert.match(params[2], /ECONNREFUSED/);
    assert.equal(params[3], null);
    assert.equal(typeof params[4], 'number');
  });
});
