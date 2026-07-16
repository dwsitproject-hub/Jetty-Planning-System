import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDateRangeWindow,
  buildWeekChunks,
  parseDashboardFilters,
} from './dashboard-v2-filters.js';

describe('buildDateRangeWindow', () => {
  it('returns UTC midnight window through end+1 day', () => {
    const w = buildDateRangeWindow('2026-06-01', '2026-06-30');
    assert.ok(w);
    assert.equal(w.rangeStartIso, '2026-06-01T00:00:00.000Z');
    assert.equal(w.rangeEndExclusiveIso, '2026-07-01T00:00:00.000Z');
  });

  it('returns null when start is after end', () => {
    assert.equal(buildDateRangeWindow('2026-07-01', '2026-06-01'), null);
  });

  it('supports single-day range', () => {
    const w = buildDateRangeWindow('2026-06-15', '2026-06-15');
    assert.ok(w);
    assert.equal(w.rangeStartIso, '2026-06-15T00:00:00.000Z');
    assert.equal(w.rangeEndExclusiveIso, '2026-06-16T00:00:00.000Z');
  });
});

describe('buildWeekChunks', () => {
  it('splits a 10-day range into two chunks', () => {
    const chunks = buildWeekChunks('2026-06-01', '2026-06-10');
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0].startDate, '2026-06-01');
    assert.equal(chunks[0].endDate, '2026-06-07');
    assert.equal(chunks[1].startDate, '2026-06-08');
    assert.equal(chunks[1].endDate, '2026-06-10');
  });
});

describe('parseDashboardFilters', () => {
  it('parses purpose and commodity_id from query', () => {
    const req = {
      query: {
        purpose: 'Loading,Unloading',
        commodity_id: ['12', '34'],
      },
    };
    const f = parseDashboardFilters(req);
    assert.deepEqual(f.purposeCodes, ['Loading', 'Unloading']);
    assert.deepEqual(f.commodityIds, [12, 34]);
  });

  it('ignores invalid purpose codes', () => {
    const f = parseDashboardFilters({ query: { purpose: 'Foo' } });
    assert.equal(f.purposeCodes, null);
  });
});
