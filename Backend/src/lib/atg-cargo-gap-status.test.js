import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { annotateAcknowledgedGaps, deriveGapCheckStatus } from './atg-cargo-gap-status.js';

const HOUR = 60 * 60 * 1000;
const gap = (startAt, endAt, gapKey = `1|${startAt}|${endAt}`) => ({ startAt, endAt, gapKey });

describe('atg-cargo-gap-status', () => {
  const now = new Date('2026-01-01T17:30:00.000Z').getTime();

  it('unhealthy when an at-berth gap ended within the recent window', () => {
    const s = deriveGapCheckStatus(
      [{ atBerth: true, openUnionGaps: [gap('2026-01-01T13:00:00.000Z', '2026-01-01T15:00:00.000Z')] }],
      6 * HOUR,
      now
    );
    assert.equal(s.status, 'unhealthy');
    assert.equal(s.liveWithRecentGap, 1);
  });

  it('degraded when the at-berth gap is older than the recent window', () => {
    const s = deriveGapCheckStatus(
      [{ atBerth: true, openUnionGaps: [gap('2026-01-01T05:00:00.000Z', '2026-01-01T06:00:00.000Z')] }],
      6 * HOUR,
      now
    );
    assert.equal(s.status, 'degraded');
    assert.equal(s.liveWithOlderGap, 1);
  });

  it('degraded for a completed operation with open gaps', () => {
    const s = deriveGapCheckStatus(
      [{ atBerth: false, openUnionGaps: [gap('2025-12-20T05:00:00.000Z', '2025-12-20T06:00:00.000Z')] }],
      6 * HOUR,
      now
    );
    assert.equal(s.status, 'degraded');
    assert.equal(s.completedWithGaps, 1);
  });

  it('healthy when every gap is acknowledged', () => {
    const g = gap('2026-01-01T15:00:00.000Z', '2026-01-01T17:00:00.000Z');
    const op = annotateAcknowledgedGaps(
      { atBerth: true, gaps: [g] },
      new Map([[g.gapKey, { reason: 'Archive empty', acknowledgedAt: '2026-01-01T17:10:00.000Z' }]])
    );
    assert.equal(op.openGapCount, 0);
    assert.equal(op.acknowledgedGapCount, 1);
    assert.equal(deriveGapCheckStatus([op], 6 * HOUR, now).status, 'healthy');
  });

  it('keeps unacknowledged gaps open', () => {
    const a = gap('2026-01-01T10:00:00.000Z', '2026-01-01T11:00:00.000Z');
    const b = gap('2026-01-01T15:00:00.000Z', '2026-01-01T17:00:00.000Z');
    const op = annotateAcknowledgedGaps(
      { atBerth: true, gaps: [a, b] },
      new Map([[a.gapKey, { reason: 'x', acknowledgedAt: '2026-01-01T12:00:00.000Z' }]])
    );
    assert.equal(op.openGapCount, 1);
    assert.equal(op.openUnionGaps.length, 1);
    assert.equal(op.openUnionGaps[0].startAt, b.startAt);
  });
});
