import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyFlatRun } from './no-flow-detect.js';

const M = 60000;
const w = (endMin, qty) => ({ startMs: (endMin - 15) * M, endMs: endMin * M, qty });

test('flowing now when the newest window moves enough', () => {
  assert.deepEqual(classifyFlatRun([w(60, 50)], 10), { known: true, flowingNow: true, flatSinceMs: null });
});

test('flat run goes back until a flowing window', () => {
  const run = classifyFlatRun([w(60, 0.5), w(45, 1), w(30, 0), w(15, 40)], 10);
  assert.equal(run.flowingNow, false);
  assert.equal(run.flatSinceMs, 15 * M);
});

test('missing ATG data stops the walk; unknown newest window means no verdict', () => {
  assert.equal(classifyFlatRun([w(60, 0), w(45, null), w(30, 0)], 10).flatSinceMs, 45 * M);
  assert.equal(classifyFlatRun([w(60, null)], 10).known, false);
  assert.equal(classifyFlatRun([], 10).known, false);
});

test('loading direction (negative delta) counts as flow', () => {
  assert.equal(classifyFlatRun([w(60, -50)], 10).flowingNow, true);
});
