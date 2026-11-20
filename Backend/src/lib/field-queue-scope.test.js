import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SAILED_RANGE_DEFAULT_DAYS,
  isSailedStatus,
  parseSailedRange,
  queueScopeOf,
  sortByCastOffDesc,
} from './field-queue-scope.js';

const NOW = new Date('2026-11-19T08:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

test('queueScopeOf: only scope=sailed switches to the sailed list', () => {
  assert.equal(queueScopeOf({ scope: 'sailed' }), 'sailed');
  assert.equal(queueScopeOf({ scope: 'SAILED' }), 'sailed');
  assert.equal(queueScopeOf({}), 'active');
  assert.equal(queueScopeOf({ scope: 'other' }), 'active');
});

test('isSailedStatus is case-insensitive and false for berthed statuses', () => {
  assert.equal(isSailedStatus('SAILED'), true);
  assert.equal(isSailedStatus('sailed'), true);
  assert.equal(isSailedStatus('DOCKED'), false);
  assert.equal(isSailedStatus(null), false);
});

test('parseSailedRange defaults to the last 30 days ending now', () => {
  const { from, to } = parseSailedRange({}, NOW);
  assert.equal(to.toISOString(), NOW.toISOString());
  assert.equal(to.getTime() - from.getTime(), SAILED_RANGE_DEFAULT_DAYS * DAY);
});

test('parseSailedRange keeps an explicit range and fills a missing from', () => {
  const r = parseSailedRange({ from: '2026-10-01T00:00:00.000Z', to: '2026-10-08T00:00:00.000Z' }, NOW);
  assert.equal(r.from.toISOString(), '2026-10-01T00:00:00.000Z');
  assert.equal(r.to.toISOString(), '2026-10-08T00:00:00.000Z');
  const onlyTo = parseSailedRange({ to: '2026-10-31T00:00:00.000Z' }, NOW);
  assert.equal(onlyTo.to.getTime() - onlyTo.from.getTime(), SAILED_RANGE_DEFAULT_DAYS * DAY);
});

test('parseSailedRange rejects bad dates, reversed and over-long ranges with 400', () => {
  const bad = (query) => assert.throws(() => parseSailedRange(query, NOW), (e) => e.statusCode === 400);
  bad({ from: 'not-a-date' });
  bad({ from: '2026-11-10T00:00:00Z', to: '2026-11-01T00:00:00Z' });
  bad({ from: '2026-11-10T00:00:00Z', to: '2026-11-10T00:00:00Z' });
  bad({ from: '2025-01-01T00:00:00Z', to: '2026-11-01T00:00:00Z' });
});

test('sortByCastOffDesc puts the latest sailing first and missing cast-offs last', () => {
  const rows = [
    { operationId: 1, castOffDateTime: '2026-11-01T00:00:00Z' },
    { operationId: 2, castOffDateTime: null },
    { operationId: 3, castOffDateTime: '2026-11-05T00:00:00Z' },
  ];
  assert.deepEqual(sortByCastOffDesc(rows).map((r) => r.operationId), [3, 1, 2]);
});
