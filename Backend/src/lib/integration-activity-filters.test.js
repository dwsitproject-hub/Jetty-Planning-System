import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test';

const {
  MAX_PAGE_LIMIT,
  buildApiRequestActivityQuery,
  buildRouteOptionsQuery,
  buildWebhookActivityQuery,
  escapeLike,
  parseLimit,
  parseTimestamp,
} = await import('./integration-activity-filters.js');

describe('integration-activity-filters helpers', () => {
  it('parseLimit defaults and clamps', () => {
    assert.equal(parseLimit(undefined), 50);
    assert.equal(parseLimit('0'), 1);
    assert.equal(parseLimit('9999'), MAX_PAGE_LIMIT);
    assert.equal(parseLimit('25'), 25);
  });

  it('parseTimestamp accepts ISO and rejects junk', () => {
    assert.equal(parseTimestamp('2026-10-27T10:00:00Z'), '2026-10-27T10:00:00.000Z');
    assert.equal(parseTimestamp('not a date'), null);
    assert.equal(parseTimestamp(''), null);
  });

  it('escapeLike escapes wildcard characters', () => {
    assert.equal(escapeLike('50%_off\\'), '50\\%\\_off\\\\');
  });
});

describe('buildWebhookActivityQuery', () => {
  it('has no WHERE clause without filters and probes limit + 1 rows', () => {
    const { sql, params, limit } = buildWebhookActivityQuery({});
    assert.equal(/WHERE/.test(sql), false);
    assert.equal(limit, 50);
    assert.deepEqual(params, [51]);
    assert.match(sql, /ORDER BY d\.id DESC/);
  });

  it('applies partner, endpoint, status, event, time, search and cursor filters with matching params', () => {
    const { sql, params } = buildWebhookActivityQuery({
      keyId: '3',
      endpointId: '9',
      status: 'failed',
      eventType: 'schedule.updated',
      from: '2026-10-27T00:00:00Z',
      q: 'OP-10',
      cursor: '500',
      limit: '20',
    });
    assert.match(sql, /e\.api_key_id = \$1/);
    assert.match(sql, /d\.endpoint_id = \$2/);
    assert.match(sql, /d\.status = \$3/);
    assert.match(sql, /d\.event_type = \$4/);
    assert.match(sql, /d\.external_reference ILIKE \$5 OR d\.delivery_id ILIKE \$5/);
    assert.match(sql, /d\.created_at >= \$6::timestamptz/);
    assert.match(sql, /d\.id < \$7/);
    assert.match(sql, /LIMIT \$8/);
    assert.deepEqual(params, [3, 9, 'failed', 'schedule.updated', '%OP-10%', '2026-10-27T00:00:00.000Z', 500, 21]);
  });

  it('ignores unknown status and event values instead of passing them to SQL', () => {
    const { sql, params } = buildWebhookActivityQuery({ status: "x'; DROP TABLE y;--", eventType: 'nope' });
    assert.equal(/WHERE/.test(sql), false);
    assert.deepEqual(params, [51]);
  });
});

describe('buildApiRequestActivityQuery', () => {
  it('maps status classes to fixed SQL and never interpolates user text', () => {
    const { sql } = buildApiRequestActivityQuery({ statusClass: 'error' });
    assert.match(sql, /l\.status_code >= 400/);
    const bad = buildApiRequestActivityQuery({ statusClass: '1=1' });
    assert.equal(/WHERE/.test(bad.sql), false);
  });

  it('filters by partner, method, route and search', () => {
    const { sql, params } = buildApiRequestActivityQuery({
      keyId: '2',
      method: 'patch',
      route: '/shipping-instructions/:id',
      q: 'req_ab',
    });
    assert.match(sql, /l\.api_key_id = \$1/);
    assert.match(sql, /l\.method = \$2/);
    assert.match(sql, /l\.route = \$3/);
    assert.match(sql, /l\.request_id ILIKE \$4 OR l\.external_reference ILIKE \$4/);
    assert.deepEqual(params, [2, 'PATCH', '/shipping-instructions/:id', '%req\\_ab%', 51]);
  });
});

describe('buildRouteOptionsQuery', () => {
  it('scopes distinct routes to the partner and time window', () => {
    const { sql, params } = buildRouteOptionsQuery({ keyId: '4', from: '2026-10-27T00:00:00Z' });
    assert.match(sql, /SELECT DISTINCT l\.route/);
    assert.deepEqual(params, [4, '2026-10-27T00:00:00.000Z']);
  });
});
