import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test';

const { getActivitySummary, listApiRequestActivity, listWebhookActivity, retryFailedDeliveryById } = await import(
  './integration-activity-log.js'
);

function webhookRow(id, overrides = {}) {
  return {
    id,
    delivery_id: `whd_${id}`,
    event_type: 'schedule.updated',
    external_reference: 'OP-1',
    status: 'sent',
    attempt_count: 1,
    last_error: null,
    last_http_status: 200,
    last_duration_ms: 120,
    last_attempt_at: '2026-10-27T10:00:00.000Z',
    created_at: '2026-10-27T10:00:00.000Z',
    sent_at: '2026-10-27T10:00:01.000Z',
    next_attempt_at: '2026-10-27T10:00:00.000Z',
    payload: { event: 'schedule.updated' },
    endpoint_id: 5,
    endpoint_url: 'https://klip.example.com/hook',
    api_key_id: 2,
    partner_name: 'KLIP',
    ...overrides,
  };
}

describe('listWebhookActivity', () => {
  it('maps rows to camelCase items and drops the probe row into nextCursor', async () => {
    const rows = [webhookRow(30), webhookRow(29), webhookRow(28)];
    const db = { query: async () => ({ rows }) };
    const res = await listWebhookActivity(db, { limit: '2' });
    assert.equal(res.items.length, 2);
    assert.equal(res.nextCursor, '29');
    assert.equal(res.items[0].deliveryId, 'whd_30');
    assert.equal(res.items[0].endpointHost, 'klip.example.com');
    assert.equal(res.items[0].httpStatus, 200);
    assert.equal(res.items[0].durationMs, 120);
    assert.equal(res.items[0].partnerName, 'KLIP');
  });

  it('returns a null cursor on the last page', async () => {
    const db = { query: async () => ({ rows: [webhookRow(1)] }) };
    const res = await listWebhookActivity(db, {});
    assert.equal(res.nextCursor, null);
    assert.equal(res.items.length, 1);
  });
});

describe('listApiRequestActivity', () => {
  const apiRow = {
    id: 9,
    api_key_id: null,
    key_prefix: 'jps_live_zzzz',
    request_id: 'req_1',
    method: 'POST',
    route: '/shipping-instructions',
    path: '/shipping-instructions',
    status_code: 401,
    duration_ms: 3,
    error_code: 'INVALID_API_KEY',
    external_reference: null,
    client_ip: '10.0.0.1',
    created_at: '2026-10-27T10:00:00.000Z',
    partner_name: null,
  };

  it('includes route options on the first page only', async () => {
    const calls = [];
    const db = {
      query: async (sql) => {
        calls.push(sql);
        return sql.includes('SELECT DISTINCT') ? { rows: [{ route: '/catalog' }] } : { rows: [apiRow] };
      },
    };
    const first = await listApiRequestActivity(db, {});
    assert.deepEqual(first.routeOptions, ['/catalog']);
    assert.equal(first.items[0].apiKeyId, null);
    assert.equal(first.items[0].errorCode, 'INVALID_API_KEY');

    calls.length = 0;
    const next = await listApiRequestActivity(db, { cursor: '10' });
    assert.equal(next.routeOptions, undefined);
    assert.equal(calls.length, 1);
  });
});

describe('getActivitySummary', () => {
  it('clamps hours and maps partner health fields', async () => {
    let captured;
    const db = {
      query: async (sql, params) => {
        captured = params;
        return {
          rows: [
            {
              id: 2,
              partner_name: 'KLIP',
              active: true,
              last_used_at: '2026-10-27T10:00:00.000Z',
              calls: 12,
              errors_4xx: 2,
              errors_5xx: 1,
              active_endpoints: 0,
              webhooks_sent: 4,
              webhooks_failed: 1,
              webhooks_pending: 3,
              oldest_pending_at: null,
              last_sent_at: null,
            },
          ],
        };
      },
    };
    const res = await getActivitySummary(db, { keyId: '2', hours: '999999' });
    assert.deepEqual(captured, [24 * 30, 2]);
    assert.equal(res.hours, 24 * 30);
    assert.equal(res.partners[0].keyId, 2);
    assert.equal(res.partners[0].apiErrors4xx, 2);
    assert.equal(res.partners[0].activeWebhookEndpoints, 0);
    assert.equal(res.partners[0].webhooksPending, 3);
  });
});

describe('retryFailedDeliveryById', () => {
  it('returns not_found when the delivery does not exist', async () => {
    const db = { query: async () => ({ rows: [] }) };
    assert.deepEqual(await retryFailedDeliveryById(db, 'whd_missing'), { error: 'not_found' });
  });

  it('resolves endpoint and key, then re-queues only failed rows', async () => {
    const queries = [];
    const db = {
      query: async (sql, params) => {
        queries.push({ sql, params });
        if (sql.includes('SELECT e.id AS endpoint_id')) return { rows: [{ endpoint_id: 5, api_key_id: 2 }] };
        if (sql.includes('SELECT id FROM integration_webhook_endpoints')) return { rows: [{ id: 5 }] };
        if (sql.includes("SET status = 'pending'")) return { rows: [{ delivery_id: 'whd_1' }] };
        throw new Error(`unexpected query: ${sql.slice(0, 60)}`);
      },
    };
    const res = await retryFailedDeliveryById(db, 'whd_1');
    assert.deepEqual(res, { ok: true, delivery_id: 'whd_1' });
    const update = queries.find((q) => q.sql.includes("SET status = 'pending'"));
    assert.deepEqual(update.params, [5, 2, 'whd_1']);
  });
});
