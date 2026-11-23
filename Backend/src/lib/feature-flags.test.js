import test from 'node:test';
import assert from 'node:assert/strict';
import { featureFlags, isFeatureOn, requireFeature } from './feature-flags.js';

test('flags are off unless the env var is exactly true', () => {
  assert.deepEqual(featureFlags({}), { netRate: false, noFlowReport: false, ganttStops: false });
  assert.equal(isFeatureOn('netRate', { FEATURE_NET_RATE: 'TRUE' }), false);
  assert.equal(isFeatureOn('netRate', { FEATURE_NET_RATE: '1' }), false);
  assert.equal(isFeatureOn('netRate', { FEATURE_NET_RATE: 'true' }), true);
  assert.equal(isFeatureOn('unknown', { FEATURE_NET_RATE: 'true' }), false);
});

test('requireFeature answers 404 while off and passes through while on', () => {
  const prev = process.env.FEATURE_GANTT_STOPS;
  const res = { code: null, status(c) { this.code = c; return this; }, json() { return this; } };
  let passed = false;
  try {
    delete process.env.FEATURE_GANTT_STOPS;
    requireFeature('ganttStops')({}, res, () => { passed = true; });
    assert.equal(res.code, 404);
    assert.equal(passed, false);
    process.env.FEATURE_GANTT_STOPS = 'true';
    requireFeature('ganttStops')({}, res, () => { passed = true; });
    assert.equal(passed, true);
  } finally {
    if (prev === undefined) delete process.env.FEATURE_GANTT_STOPS;
    else process.env.FEATURE_GANTT_STOPS = prev;
  }
});
