import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { downsampleTankGaugingSamples } from './tank-gauging-samples.js';

function makeSeries(count, startMs, stepMs) {
  return Array.from({ length: count }, (_, i) => ({
    sampledAt: new Date(startMs + i * stepMs).toISOString(),
    totalMass: 100 + i,
  }));
}

describe('downsampleTankGaugingSamples', () => {
  it('returns input unchanged when under maxPoints', () => {
    const samples = makeSeries(10, Date.parse('2026-08-01T00:00:00.000Z'), 60_000);
    assert.deepEqual(downsampleTankGaugingSamples(samples, 500), samples);
  });

  it('preserves the first and last timestamps across the window', () => {
    const samples = makeSeries(20_000, Date.parse('2026-08-01T00:00:00.000Z'), 60_000);
    const out = downsampleTankGaugingSamples(samples, 500);

    assert.equal(out.length, 500);
    assert.equal(out[0].sampledAt, samples[0].sampledAt);
    assert.equal(out[out.length - 1].sampledAt, samples[samples.length - 1].sampledAt);
    assert.ok(Date.parse(out[0].sampledAt) < Date.parse('2026-08-05T00:00:00.000Z'));
  });
});
