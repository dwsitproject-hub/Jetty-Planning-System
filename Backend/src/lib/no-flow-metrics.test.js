import test from 'node:test';
import assert from 'node:assert/strict';
import { pumpingHours, summarizeStops } from './no-flow-metrics.js';

const cargoWindow = { startedAt: '2026-11-11T08:00:00Z', endedAt: '2026-11-14T12:00:00Z' };

test('splits a stop into before / during / after the cargo window', () => {
  const r = summarizeStops({
    cargoWindow,
    events: [
      { startedAt: '2026-11-11T02:00:00Z', endedAt: '2026-11-11T06:00:00Z', reasonCode: 'HOA', category: 'external' },
      { startedAt: '2026-11-11T07:00:00Z', endedAt: '2026-11-11T09:00:00Z', reasonCode: 'FWT', category: 'external' },
      { startedAt: '2026-11-12T12:20:00Z', endedAt: '2026-11-13T09:15:00Z', reasonCode: 'OVT', category: 'terminal' },
      { startedAt: '2026-11-14T11:00:00Z', endedAt: '2026-11-14T13:00:00Z', reasonCode: 'CHL', category: 'terminal' },
    ],
  });
  assert.equal(r.byPhase.before, 5);
  assert.equal(Math.round(r.byPhase.during * 100) / 100, 1 + 20.92 + 1);
  assert.equal(r.byPhase.after, 1);
  assert.equal(r.byReason.HOA, 4);
  assert.equal(r.byCategory.external, 6);
  assert.equal(r.stops[1].phaseHours.before, 1);
  assert.equal(r.stops[1].phaseHours.during, 1);
});

test('cuts stops at the range edges (month-end split)', () => {
  const r = summarizeStops({
    cargoWindow,
    range: { from: '2026-11-12T00:00:00Z', to: '2026-11-13T00:00:00Z' },
    events: [{ startedAt: '2026-11-11T20:00:00Z', endedAt: '2026-11-13T04:00:00Z', reasonCode: 'OVT' }],
  });
  assert.equal(r.totalHours, 24);
  assert.equal(r.byPhase.during, 24);
});

test('open stop runs until now; no cargo yet counts as before', () => {
  const nowMs = new Date('2026-11-11T05:00:00Z').getTime();
  const r = summarizeStops({
    nowMs,
    events: [{ startedAt: '2026-11-11T02:00:00Z', endedAt: null, reasonCode: 'HOA' }],
  });
  assert.equal(r.totalHours, 3);
  assert.equal(r.byPhase.before, 3);
});

test('skips stops outside the range and bad dates', () => {
  const r = summarizeStops({
    range: { from: '2026-12-01T00:00:00Z' },
    events: [
      { startedAt: '2026-11-11T02:00:00Z', endedAt: '2026-11-11T04:00:00Z' },
      { startedAt: 'not a date', endedAt: null },
    ],
  });
  assert.equal(r.totalHours, 0);
  assert.equal(r.stops.length, 0);
});

test('pumping hours never go below zero', () => {
  assert.equal(pumpingHours(76.8, 27.3), 76.8 - 27.3);
  assert.equal(pumpingHours(10, 12), 0);
  assert.equal(pumpingHours(0, 1), null);
  assert.equal(pumpingHours(null, 1), null);
});
