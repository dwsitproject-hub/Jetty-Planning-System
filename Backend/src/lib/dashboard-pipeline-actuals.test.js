import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computePipelineActuals } from './dashboard-pipeline-actuals.js';

/**
 * Extracts the WHERE...ORDER BY predicate text (params placeholders like $1, $2
 * are left as-is so structurally-identical predicates compare equal even
 * though surrounding SELECT/ORDER BY/LIMIT clauses differ between the count
 * query and its paired vessel-list query).
 */
function predicateOf(sql) {
  const whereIdx = sql.indexOf('WHERE');
  assert.ok(whereIdx >= 0, `expected a WHERE clause in: ${sql}`);
  const rest = sql.slice(whereIdx);
  const orderIdx = rest.search(/ORDER BY/);
  const predicate = orderIdx >= 0 ? rest.slice(0, orderIdx) : rest;
  return predicate.replace(/\s+/g, ' ').trim();
}

function createMockClient() {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      // Even-indexed calls (0-based) are the COUNT queries, odd-indexed are the
      // paired vessel-list queries — matches the Promise.all ordering in
      // computePipelineActuals (count, vessels, count, vessels, ...).
      const isCountQuery = calls.length % 2 === 1;
      if (isCountQuery) {
        return { rows: [{ c: 3 }] };
      }
      return {
        rows: [
          { vessel_name: 'MV Alpha', purpose: 'Loading' },
          { vessel_name: 'MV Beta', purpose: 'Unloading' },
          { vessel_name: 'MV Gamma', purpose: null },
        ],
      };
    },
  };
}

describe('computePipelineActuals', () => {
  it('issues 12 queries (count + vessel-list per stage) with matching predicates', async () => {
    const client = createMockClient();
    const filters = { purposeCodes: null, commodityIds: null };
    await computePipelineActuals(client, 42, '2026-06-01T00:00:00.000Z', '2026-06-08T00:00:00.000Z', filters);

    assert.equal(client.calls.length, 12);

    for (let i = 0; i < client.calls.length; i += 2) {
      const countCall = client.calls[i];
      const listCall = client.calls[i + 1];
      assert.deepEqual(
        countCall.params,
        listCall.params,
        `stage ${i / 2}: count/list query params should match`
      );
      assert.equal(
        predicateOf(countCall.sql),
        predicateOf(listCall.sql),
        `stage ${i / 2}: count/list query predicates should match`
      );
      assert.match(listCall.sql, /LIMIT 20/, `stage ${i / 2}: vessel list query should cap at 20`);
    }
  });

  it('applies purpose/commodity filter params identically to count and list queries', async () => {
    const client = createMockClient();
    const filters = { purposeCodes: ['Loading'], commodityIds: [7] };
    await computePipelineActuals(client, 42, '2026-06-01T00:00:00.000Z', '2026-06-08T00:00:00.000Z', filters);

    for (let i = 0; i < client.calls.length; i += 2) {
      const countCall = client.calls[i];
      const listCall = client.calls[i + 1];
      assert.deepEqual(countCall.params, listCall.params);
      // Base params (portId, start, end) plus purposeCodes + commodityIds filter arrays.
      assert.equal(countCall.params.length, 5);
      assert.deepEqual(countCall.params[3], ['Loading']);
      assert.deepEqual(countCall.params[4], [7]);
    }
  });

  it('maps vessel rows to { vesselName, purpose } and returns them alongside counts', async () => {
    const client = createMockClient();
    const filters = { purposeCodes: null, commodityIds: null };
    const result = await computePipelineActuals(
      client,
      42,
      '2026-06-01T00:00:00.000Z',
      '2026-06-08T00:00:00.000Z',
      filters
    );

    assert.equal(result.shipmentRequest, 3);
    assert.deepEqual(result.shipmentRequestVessels, [
      { vesselName: 'MV Alpha', purpose: 'Loading' },
      { vesselName: 'MV Beta', purpose: 'Unloading' },
      { vesselName: 'MV Gamma', purpose: null },
    ]);

    for (const stage of ['shipmentRequest', 'incoming', 'plannedBerthing', 'atBerth', 'readyToSail', 'sailed']) {
      assert.equal(result[stage], 3);
      assert.ok(Array.isArray(result[`${stage}Vessels`]));
      assert.ok(result[`${stage}Vessels`].length <= 20);
    }
  });
});
