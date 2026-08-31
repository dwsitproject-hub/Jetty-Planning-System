import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildClockHourBuckets,
  classifyHourMovement,
  classifyHourDisplayStatus,
  computeCompletionFromMovedQty,
  computeDirectionalTankDelta,
  computeHourlyBucketsFromManualCheckpoints,
  mergeHourlyBuckets,
  buildHourlyRateSummary,
} from './atg-hourly-progress.js';

describe('buildClockHourBuckets', () => {
  it('generates partial first hour and full hours', () => {
    const buckets = buildClockHourBuckets(
      '2026-08-27T07:30:00.000Z',
      '2026-08-27T10:15:00.000Z',
      'Asia/Jakarta'
    );
    assert.ok(buckets.length >= 3);
    assert.equal(buckets[0].isPartial, true);
    assert.ok(buckets[0].effectiveHours > 0);
    assert.ok(buckets[0].hourLabelLocal.includes('–'));
    assert.match(buckets[0].hourLabelLocal, /\d{2}\/\d{2} \d{2}:\d{2}–\d{2}:\d{2}/);
  });

  it('returns empty for invalid window', () => {
    assert.deepEqual(buildClockHourBuckets('bad', '2026-08-27T10:00:00.000Z', 'Asia/Jakarta'), []);
  });
});

describe('computeDirectionalTankDelta', () => {
  it('loading uses mass decrease', () => {
    const r = computeDirectionalTankDelta(1000, 900, 'Loading');
    assert.equal(r.qtyMoved, 100);
    assert.equal(r.directionMismatch, false);
  });

  it('unloading uses mass increase', () => {
    const r = computeDirectionalTankDelta(900, 1000, 'Unloading');
    assert.equal(r.qtyMoved, 100);
    assert.equal(r.directionMismatch, false);
  });

  it('flags wrong direction on loading', () => {
    const r = computeDirectionalTankDelta(900, 1000, 'Loading');
    assert.equal(r.qtyMoved, 0);
    assert.equal(r.directionMismatch, true);
    assert.equal(r.rawDeltaMass, 100);
  });

  it('unloading mass decrease returns raw negative delta', () => {
    const r = computeDirectionalTankDelta(1000, 800, 'Unloading');
    assert.equal(r.qtyMoved, 0);
    assert.equal(r.directionMismatch, true);
    assert.equal(r.rawDeltaMass, -200);
  });

  it('unloading mass increase returns positive raw delta', () => {
    const r = computeDirectionalTankDelta(900, 1000, 'Unloading');
    assert.equal(r.qtyMoved, 100);
    assert.equal(r.rawDeltaMass, 100);
  });
});

describe('classifyHourDisplayStatus', () => {
  const thresholds = { flatRateThresholdTph: 2, minQtyMovedT: 1 };

  it('labels reverse movement when unloading tank decreases significantly', () => {
    assert.equal(
      classifyHourDisplayStatus(-200, true, 200, thresholds),
      'direction_mismatch'
    );
  });

  it('labels flat for tiny reverse delta below min qty', () => {
    assert.equal(
      classifyHourDisplayStatus(-0.5, true, 0.5, thresholds),
      'flat_movement'
    );
  });

  it('labels active for correct-direction unloading increase', () => {
    assert.equal(classifyHourDisplayStatus(100, false, 100, thresholds), 'active');
  });

  it('labels incomplete when samples missing', () => {
    assert.equal(
      classifyHourDisplayStatus(-200, true, 200, thresholds, { incomplete: true }),
      'incomplete'
    );
  });
});

describe('classifyHourMovement', () => {
  it('labels flat below threshold', () => {
    assert.equal(classifyHourMovement(0.5, 0.5, { flatRateThresholdTph: 2, minQtyMovedT: 1 }), 'flat_movement');
  });

  it('labels active at threshold', () => {
    assert.equal(classifyHourMovement(120, 120, { flatRateThresholdTph: 2, minQtyMovedT: 1 }), 'active');
  });

  it('labels incomplete when samples missing', () => {
    assert.equal(
      classifyHourMovement(0, 0, { flatRateThresholdTph: 2, minQtyMovedT: 1 }, { incomplete: true }),
      'incomplete'
    );
  });
});

describe('computeHourlyBucketsFromManualCheckpoints', () => {
  it('allocates checkpoint delta into clock hours', () => {
    const buckets = computeHourlyBucketsFromManualCheckpoints(
      [
        { recordedAt: '2026-08-27T08:00:00.000Z', cumulativeQty: 0 },
        { recordedAt: '2026-08-27T10:00:00.000Z', cumulativeQty: 200 },
      ],
      '2026-08-27T07:00:00.000Z',
      '2026-08-27T11:00:00.000Z',
      'UTC'
    );
    const total = buckets.reduce((s, b) => s + b.qtyMoved, 0);
    assert.ok(Math.abs(total - 200) < 1);
  });
});

describe('mergeHourlyBuckets', () => {
  it('sums qty for same hourStart', () => {
    const merged = mergeHourlyBuckets(
      [
        [{ hourStart: '2026-08-27T08:00:00.000Z', hourEnd: '2026-08-27T09:00:00.000Z', qtyMoved: 50, source: 'atg', movementStatus: 'active' }],
        [{ hourStart: '2026-08-27T08:00:00.000Z', hourEnd: '2026-08-27T09:00:00.000Z', qtyMoved: 30, source: 'manual', movementStatus: 'active' }],
      ],
      { flatRateThresholdTph: 2, minQtyMovedT: 1 }
    );
    assert.equal(merged.length, 1);
    assert.equal(merged[0].qtyMoved, 80);
    assert.equal(merged[0].source, 'hybrid');
  });

  it('merges tankDetail arrays for same hourStart', () => {
    const merged = mergeHourlyBuckets(
      [
        [
          {
            hourStart: '2026-08-27T08:00:00.000Z',
            hourEnd: '2026-08-27T09:00:00.000Z',
            qtyMoved: 50,
            source: 'atg',
            movementStatus: 'active',
            tankDetail: [{ tankId: '1', code: '5102', qtyMoved: 50 }],
          },
        ],
        [
          {
            hourStart: '2026-08-27T08:00:00.000Z',
            hourEnd: '2026-08-27T09:00:00.000Z',
            qtyMoved: 30,
            source: 'atg',
            movementStatus: 'active',
            tankDetail: [{ tankId: '2', code: '5103', qtyMoved: 30 }],
          },
        ],
      ],
      { flatRateThresholdTph: 2, minQtyMovedT: 1 }
    );
    assert.equal(merged.length, 1);
    assert.equal(merged[0].qtyMoved, 80);
    assert.equal(merged[0].tankDetail.length, 2);
    const codes = merged[0].tankDetail.map((t) => t.code).sort();
    assert.deepEqual(codes, ['5102', '5103']);
  });

  it('preserves direction_mismatch status after merge when display delta is reverse', () => {
    const merged = mergeHourlyBuckets(
      [
        [
          {
            hourStart: '2026-08-27T08:00:00.000Z',
            hourEnd: '2026-08-27T09:00:00.000Z',
            qtyMoved: 0,
            displayQtyMoved: -220,
            directionMismatch: true,
            source: 'atg',
            movementStatus: 'direction_mismatch',
            tankDetail: [
              {
                tankId: '1',
                code: '5102',
                qtyMoved: 0,
                rawDeltaMass: -220,
                displayQtyMoved: -220,
                directionMismatch: true,
              },
            ],
          },
        ],
      ],
      { flatRateThresholdTph: 2, minQtyMovedT: 1 }
    );
    assert.equal(merged.length, 1);
    assert.equal(merged[0].qtyMoved, 0);
    assert.equal(merged[0].displayQtyMoved, -220);
    assert.equal(merged[0].movementStatus, 'direction_mismatch');
  });
});

describe('computeCompletionFromMovedQty', () => {
  it('caps completion at 100 when over SI', () => {
    const r = computeCompletionFromMovedQty(10080, 10000);
    assert.equal(r.completionPercent, 100);
    assert.equal(r.siQtyVariance?.kind, 'over');
    assert.equal(r.siQtyVariance?.delta, 80);
  });

  it('returns under variance without blocking semantics', () => {
    const r = computeCompletionFromMovedQty(9500, 10000);
    assert.equal(r.completionPercent, 95);
    assert.equal(r.siQtyVariance?.kind, 'under');
  });

  it('returns null variance on exact match', () => {
    const r = computeCompletionFromMovedQty(10000, 10000);
    assert.equal(r.completionPercent, 100);
    assert.equal(r.siQtyVariance, null);
  });
});

describe('buildHourlyRateSummary', () => {
  it('builds current and last active lines', () => {
    const summary = buildHourlyRateSummary(
      [
        {
          hourLabelLocal: '14:00–15:00 WITA',
          rateTph: 120,
          movementStatus: 'active',
        },
        {
          hourLabelLocal: '15:00–16:00 WITA',
          rateTph: 0,
          movementStatus: 'flat_movement',
        },
      ],
      'MT'
    );
    assert.match(summary.currentHourLine, /15:00–16:00/);
    assert.match(summary.lastActiveHourLine, /14:00–15:00/);
  });
});
