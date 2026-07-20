import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  enumerateUtcDays,
  snapshotIsoForDay,
  utcTodayYmd,
} from './dashboard-slot-occupancy.js';
import { buildDateRangeWindow } from './dashboard-v2-filters.js';

describe('enumerateUtcDays', () => {
  it('returns inclusive UTC days for a range', () => {
    assert.deepEqual(enumerateUtcDays('2026-06-01', '2026-06-03'), [
      '2026-06-01',
      '2026-06-02',
      '2026-06-03',
    ]);
  });

  it('returns one day for single-day range', () => {
    assert.deepEqual(enumerateUtcDays('2026-06-15', '2026-06-15'), ['2026-06-15']);
  });

  it('returns empty array when start is after end', () => {
    assert.deepEqual(enumerateUtcDays('2026-07-01', '2026-06-01'), []);
  });
});

describe('snapshotIsoForDay', () => {
  it('uses live now for UTC today', () => {
    const now = new Date('2026-07-20T10:30:00.000Z');
    const today = utcTodayYmd(now);
    assert.equal(snapshotIsoForDay(today, now), now.toISOString());
  });

  it('uses end of UTC day for a past day', () => {
    const now = new Date('2026-07-20T10:30:00.000Z');
    const window = buildDateRangeWindow('2026-07-19', '2026-07-19');
    const expected = new Date(new Date(window.rangeEndExclusiveIso).getTime() - 1).toISOString();
    assert.equal(snapshotIsoForDay('2026-07-19', now), expected);
  });
});
