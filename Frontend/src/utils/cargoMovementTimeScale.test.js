import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assignSegmentLanes,
  createCargoMovementTimeScale,
  splitSampleRuns,
} from './cargoMovementTimeScale.js';

describe('createCargoMovementTimeScale', () => {
  it('maps timestamps to pixel positions', () => {
    const scale = createCargoMovementTimeScale(
      '2026-08-01T00:00:00.000Z',
      '2026-08-08T00:00:00.000Z',
      700
    );
    assert.equal(scale.toX(Date.parse('2026-08-01T00:00:00.000Z')), 0);
    assert.equal(scale.toX(Date.parse('2026-08-08T00:00:00.000Z')), 700);
    assert.ok(scale.toX(Date.parse('2026-08-04T12:00:00.000Z')) > 300);
  });
});

describe('assignSegmentLanes', () => {
  it('assigns second lane when segments overlap', () => {
    const lanes = assignSegmentLanes(
      [
        { loadLineId: '1', startAt: '2026-08-01T08:00:00.000Z', endAt: '2026-08-01T18:00:00.000Z' },
        { loadLineId: '2', startAt: '2026-08-01T12:00:00.000Z', endAt: '2026-08-01T20:00:00.000Z' },
      ],
      Date.parse('2026-08-02T00:00:00.000Z')
    );
    assert.equal(lanes.get('1'), 0);
    assert.equal(lanes.get('2'), 1);
  });
});

describe('splitSampleRuns', () => {
  it('splits on large gaps', () => {
    const runs = splitSampleRuns(
      [
        { sampledAt: '2026-08-01T08:00:00.000Z', totalMass: 100 },
        { sampledAt: '2026-08-01T08:01:00.000Z', totalMass: 101 },
        { sampledAt: '2026-08-01T10:00:00.000Z', totalMass: 120 },
      ],
      120_000
    );
    assert.equal(runs.length, 2);
    assert.equal(runs[0].length, 2);
    assert.equal(runs[1].length, 1);
  });
});
