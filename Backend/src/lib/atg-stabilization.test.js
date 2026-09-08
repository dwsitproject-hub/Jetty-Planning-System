import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  TankStabilizationTracker,
  computeWindowStats,
  meanTemperature,
  pruneSamplesByWindow,
} from './atg-stabilization.js';

describe('computeWindowStats', () => {
  it('computes variance percent for stable values', () => {
    const stats = computeWindowStats([100, 100.2, 99.8, 100.1]);
    assert.ok(stats.mean != null);
    assert.ok(stats.variancePct != null);
    assert.ok(stats.variancePct < 0.5);
  });

  it('returns high variance for oscillating values', () => {
    const stats = computeWindowStats([100, 120, 100, 120]);
    assert.ok(stats.variancePct != null);
    assert.ok(stats.variancePct > 5);
  });

  it('handles zero mean edge case', () => {
    const stats = computeWindowStats([0, 0, 0]);
    assert.equal(stats.variancePct, 0);
  });
});

describe('pruneSamplesByWindow', () => {
  it('drops samples outside window', () => {
    const now = new Date('2026-09-07T08:00:10.000Z');
    const samples = [
      { value: 1, sampledAt: '2026-09-07T07:59:50.000Z' },
      { value: 2, sampledAt: '2026-09-07T08:00:05.000Z' },
    ];
    const pruned = pruneSamplesByWindow(samples, 10, now);
    assert.equal(pruned.length, 1);
    assert.equal(pruned[0].value, 2);
  });
});

describe('meanTemperature', () => {
  it('averages temperature samples', () => {
    const avg = meanTemperature([
      { temperatureC: 30 },
      { temperatureC: 32 },
    ]);
    assert.equal(avg, 31);
  });
});

describe('TankStabilizationTracker', () => {
  const baseConfig = {
    windowSec: 30,
    stableThresholdPct: 0.5,
    stableHoldSec: 2,
    minSamples: 3,
  };

  it('starts calibrating until min samples', () => {
    const tracker = new TankStabilizationTracker(baseConfig);
    const t0 = '2026-09-07T08:00:00.000Z';
    tracker.addSample({ value: 1000, temperatureC: 32, sampledAt: t0 });
    assert.equal(tracker.getStatus().state, 'calibrating');
    tracker.addSample({ value: 1000.1, temperatureC: 32, sampledAt: '2026-09-07T08:00:01.000Z' });
    assert.equal(tracker.getStatus().state, 'calibrating');
  });

  it('transitions to stable after hold window', () => {
    const tracker = new TankStabilizationTracker(baseConfig);
    const values = [1000, 1000.1, 1000.05, 1000.02, 1000.03];
    values.forEach((v, i) => {
      tracker.addSample({
        value: v,
        temperatureC: 32,
        sampledAt: new Date(Date.parse('2026-09-07T08:00:00.000Z') + i * 1000).toISOString(),
      });
    });
    assert.equal(tracker.getStatus().state, 'stable');
    const locked = tracker.lock();
    assert.ok(locked.value != null);
    assert.equal(tracker.getStatus().state, 'locked');
  });

  it('stays fluctuating when variance is high', () => {
    const tracker = new TankStabilizationTracker(baseConfig);
    [1000, 1020, 980, 1010, 990].forEach((v, i) => {
      tracker.addSample({
        value: v,
        temperatureC: 32,
        sampledAt: new Date(Date.parse('2026-09-07T08:00:00.000Z') + i * 1000).toISOString(),
      });
    });
    assert.equal(tracker.getStatus().state, 'fluctuating');
    assert.throws(() => tracker.lock(), (err) => err.statusCode === 409);
  });

  it('supports manual lock without ATG samples', () => {
    const tracker = new TankStabilizationTracker(baseConfig);
    tracker.setManual({ massMt: 5000, temperatureC: 31.5, measurementBasis: 'mass' });
    assert.equal(tracker.getStatus().state, 'manual');
    assert.equal(tracker.getStatus().locked.massMt, 5000);
  });

  it('unlock resets to calibrating', () => {
    const tracker = new TankStabilizationTracker(baseConfig);
    tracker.setManual({ massMt: 5000, temperatureC: 31.5, measurementBasis: 'mass' });
    tracker.unlock();
    assert.equal(tracker.getStatus().state, 'calibrating');
    assert.equal(tracker.getStatus().locked, null);
  });
});
