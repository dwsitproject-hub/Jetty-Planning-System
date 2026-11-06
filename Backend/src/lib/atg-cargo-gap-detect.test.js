import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_MIN_GAP_MS,
  gapsFromIncompleteHourlyBuckets,
  gapsFromSampleTimeline,
  mergeAdjacentIntervals,
  rollupLineGaps,
  rollupOperationGaps,
  deriveGapCheckStatus,
} from './atg-cargo-gap-detect.js';

describe('atg-cargo-gap-detect', () => {
  it('merges overlapping intervals', () => {
    const merged = mergeAdjacentIntervals([
      { startAt: '2026-01-01T10:00:00.000Z', endAt: '2026-01-01T12:00:00.000Z' },
      { startAt: '2026-01-01T11:00:00.000Z', endAt: '2026-01-01T13:00:00.000Z' },
    ]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].startAt, '2026-01-01T10:00:00.000Z');
    assert.equal(merged[0].endAt, '2026-01-01T13:00:00.000Z');
  });

  it('detects gap 15:00–17:00 with samples before and after', () => {
    const windowStart = '2026-01-01T10:00:00.000Z';
    const windowEnd = '2026-01-01T17:00:00.000Z';
    const samples = [
      '2026-01-01T10:00:00.000Z',
      '2026-01-01T12:00:00.000Z',
      '2026-01-01T15:00:00.000Z',
      '2026-01-01T17:00:00.000Z',
    ];
    const gaps = gapsFromSampleTimeline(samples, windowStart, windowEnd, DEFAULT_MIN_GAP_MS);
    const mid = gaps.find(
      (g) => g.startAt === '2026-01-01T12:00:00.000Z' && g.endAt === '2026-01-01T15:00:00.000Z'
    );
    assert.ok(mid, 'expected 12:00–15:00 gap between samples');
    assert.equal(mid.durationMinutes, 180);
  });

  it('merges consecutive incomplete hourly buckets', () => {
    const gaps = gapsFromIncompleteHourlyBuckets([
      { hourStart: '2026-01-01T15:00:00.000Z', hourEnd: '2026-01-01T16:00:00.000Z', movementStatus: 'incomplete' },
      { hourStart: '2026-01-01T16:00:00.000Z', hourEnd: '2026-01-01T17:00:00.000Z', movementStatus: 'incomplete' },
      { hourStart: '2026-01-01T14:00:00.000Z', hourEnd: '2026-01-01T15:00:00.000Z', movementStatus: 'active' },
    ]);
    assert.equal(gaps.length, 1);
    assert.equal(gaps[0].startAt, '2026-01-01T15:00:00.000Z');
    assert.equal(gaps[0].endAt, '2026-01-01T17:00:00.000Z');
  });

  it('rollups operation gaps with gapKey', () => {
    const r = rollupOperationGaps([
      {
        loadLineId: 10,
        commodity: 'CPO',
        gaps: [{ startAt: '2026-01-01T15:00:00.000Z', endAt: '2026-01-01T17:00:00.000Z', durationMinutes: 120 }],
      },
    ]);
    assert.equal(r.segmentCountWithGaps, 1);
    assert.equal(r.longestGapMinutes, 120);
    assert.equal(r.gaps[0].gapKey.includes('10|'), true);
  });

  it('rollupLineGaps unions per-tank gaps', () => {
    const line = rollupLineGaps([
      [{ startAt: '2026-01-01T15:00:00.000Z', endAt: '2026-01-01T16:00:00.000Z' }],
      [{ startAt: '2026-01-01T15:30:00.000Z', endAt: '2026-01-01T17:00:00.000Z' }],
    ]);
    assert.equal(line.length, 1);
  });

  it('deriveGapCheckStatus unhealthy when live recent gap', () => {
    const now = new Date('2026-01-01T17:30:00.000Z').getTime();
    const s = deriveGapCheckStatus(
      [
        {
          atBerth: true,
          unionGaps: [{ startAt: '2026-01-01T15:00:00.000Z', endAt: '2026-01-01T17:00:00.000Z' }],
        },
      ],
      DEFAULT_MIN_GAP_MS,
      now
    );
    assert.equal(s.status, 'unhealthy');
  });
});
