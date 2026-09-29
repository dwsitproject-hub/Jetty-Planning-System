import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  lookbackStartYmd,
  movingMean,
  applyCommodityMovingMean,
  isAtAnchorageAtSnapshot,
  isAtBerthAtSnapshot,
  round1,
} from './dashboard-weekly-ops-metrics.js';
import { buildWeekChunks } from './dashboard-v2-filters.js';

describe('lookbackStartYmd', () => {
  it('subtracts 21 UTC days so three prior week chunks exist', () => {
    assert.equal(lookbackStartYmd('2026-09-01', 21), '2026-08-11');
    const chunks = buildWeekChunks('2026-08-11', '2026-09-07');
    assert.equal(chunks.length, 4);
    assert.equal(chunks[3].startDate, '2026-09-01');
    assert.equal(chunks[3].endDate, '2026-09-07');
  });

  it('returns null for invalid input', () => {
    assert.equal(lookbackStartYmd(''), null);
    assert.equal(lookbackStartYmd(null), null);
  });
});

describe('movingMean', () => {
  it('uses up to 4 prior finite values and skips nulls', () => {
    const ma = movingMean([10, null, 20, 30, 40], 4);
    assert.deepEqual(ma.map(round1), [10, 10, 15, 20, 30]);
  });

  it('returns null when the window has no values', () => {
    assert.deepEqual(movingMean([null, null], 4), [null, null]);
  });
});

describe('applyCommodityMovingMean', () => {
  it('computes a 4-week MA per commodity', () => {
    const weeks = [
      [{ commodityId: 1, code: 'CPO', mtPerHour: 100 }],
      [{ commodityId: 1, code: 'CPO', mtPerHour: 200 }],
      [{ commodityId: 1, code: 'CPO', mtPerHour: 300 }, { commodityId: 2, code: 'PKO', mtPerHour: 50 }],
      [{ commodityId: 1, code: 'CPO', mtPerHour: 400 }],
    ];
    const out = applyCommodityMovingMean(weeks, 4);
    const cpo = out[3].find((r) => r.commodityId === 1);
    const pko = out[3].find((r) => r.commodityId === 2);
    assert.equal(cpo.mtPerHourMa, 250);
    assert.equal(pko.mtPerHourMa, 50);
  });
});

describe('isAtAnchorageAtSnapshot', () => {
  const t = '2026-09-14T23:59:59.999Z';

  it('counts TA without TB', () => {
    assert.equal(isAtAnchorageAtSnapshot({ ta: '2026-09-10T02:00:00.000Z', alongsideAt: null }, t), true);
  });

  it('excludes vessels already alongside', () => {
    assert.equal(
      isAtAnchorageAtSnapshot(
        { ta: '2026-09-10T02:00:00.000Z', alongsideAt: '2026-09-12T04:00:00.000Z' },
        t
      ),
      false
    );
  });
});

describe('isAtBerthAtSnapshot', () => {
  const t = '2026-09-14T23:59:59.999Z';

  it('counts a vessel that later sailed', () => {
    assert.equal(
      isAtBerthAtSnapshot(
        {
          alongsideAt: '2026-09-08T01:00:00.000Z',
          departedAt: '2026-09-20T06:00:00.000Z',
        },
        t
      ),
      true
    );
  });

  it('excludes a vessel that had already cast off', () => {
    assert.equal(
      isAtBerthAtSnapshot(
        {
          alongsideAt: '2026-09-01T01:00:00.000Z',
          departedAt: '2026-09-14T12:00:00.000Z',
        },
        t
      ),
      false
    );
  });
});
