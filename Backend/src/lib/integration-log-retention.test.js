import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test';

const { DEFAULT_RETENTION_DAYS, purgeIntegrationApiLogs, resolveRetentionDays } = await import(
  './integration-log-retention.js'
);

describe('resolveRetentionDays', () => {
  it('defaults to 30 and rejects invalid values', () => {
    assert.equal(resolveRetentionDays(undefined), DEFAULT_RETENTION_DAYS);
    assert.equal(resolveRetentionDays('0'), DEFAULT_RETENTION_DAYS);
    assert.equal(resolveRetentionDays('abc'), DEFAULT_RETENTION_DAYS);
    assert.equal(resolveRetentionDays('14'), 14);
  });
});

describe('purgeIntegrationApiLogs', () => {
  it('deletes in batches until a short batch and only uses the cutoff parameter', async () => {
    const counts = [5, 5, 2];
    const calls = [];
    const db = {
      query: async (sql, params) => {
        calls.push({ sql, params });
        return { rowCount: counts.shift() };
      },
    };
    const total = await purgeIntegrationApiLogs(db, 30, 5);
    assert.equal(total, 12);
    assert.equal(calls.length, 3);
    assert.match(calls[0].sql, /created_at < NOW\(\) - \(\$1::int \* interval '1 day'\)/);
    assert.deepEqual(calls[0].params, [30, 5]);
  });

  it('stops after one query when nothing is old enough', async () => {
    let n = 0;
    const db = {
      query: async () => {
        n += 1;
        return { rowCount: 0 };
      },
    };
    assert.equal(await purgeIntegrationApiLogs(db, 30, 100), 0);
    assert.equal(n, 1);
  });
});
