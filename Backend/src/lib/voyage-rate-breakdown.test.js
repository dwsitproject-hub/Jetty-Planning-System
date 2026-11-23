import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRateBreakdown } from './voyage-rate-breakdown.js';

const iso = (h) => new Date(Date.parse('2026-11-14T00:00:00Z') + h * 3600000).toISOString();
const line = (id, s, e, qty, extra = {}) => ({ id, startedAt: iso(s), endedAt: e == null ? null : iso(e), qty, ...extra });
const base = { firstLoggedAt: iso(0), lastLoggedAt: iso(10), nowMs: Date.parse(iso(20)) };

test('net rate leaves out stops during cargo; gross stays over the whole window', () => {
  const r = buildRateBreakdown({
    ...base,
    movedQty: 800,
    lines: [line(1, 0, 10, 800)],
    events: [{ startedAt: iso(3), endedAt: iso(5), reasonCode: 'OVT', category: 'terminal' }],
  });
  assert.equal(r.stopHours.during, 2);
  assert.equal(r.pumpingHours, 8);
  assert.equal(r.netRateMtH, 100);
  assert.equal(r.normal.rateMtH, 100);
  assert.equal(r.kuras.rateMtH, null);
  assert.equal(r.kuras.startedAt, null);
});

test('stops before and after the cargo window are counted apart and do not change net rate', () => {
  const r = buildRateBreakdown({
    ...base,
    movedQty: 500,
    lines: [line(1, 0, 10, 500)],
    events: [
      { startedAt: iso(-4), endedAt: iso(-1), reasonCode: 'HOA', category: 'external' },
      { startedAt: iso(11), endedAt: iso(12), reasonCode: 'CHL', category: 'terminal' },
    ],
  });
  assert.deepEqual(r.stopHours, { before: 3, during: 0, after: 1, total: 4 });
  assert.equal(r.netRateMtH, 50);
});

test('a kuras start splits one entry into normal and kuras rates (hourly qty)', () => {
  const hourly = Array.from({ length: 10 }, (_, i) => ({
    hourStart: iso(i), hourEnd: iso(i + 1), qtyMoved: i < 6 ? 100 : 20,
  }));
  const r = buildRateBreakdown({
    ...base,
    movedQty: 680,
    lines: [line(1, 0, 10, 680, { kurasStartedAt: iso(6), movementType: 'normal' })],
    hoursByLine: new Map([[1, hourly]]),
    events: [],
  });
  assert.equal(r.kuras.startedAt, iso(6));
  assert.equal(r.kuras.hours, 4);
  assert.equal(r.kuras.qty, 80);
  assert.equal(r.kuras.rateMtH, 20);
  assert.equal(r.normal.hours, 6);
  assert.equal(r.normal.qty, 600);
  assert.equal(r.normal.rateMtH, 100);
});

test('without hourly data the kuras share follows time share; stops inside kuras are left out', () => {
  const r = buildRateBreakdown({
    ...base,
    movedQty: 1000,
    lines: [line(1, 0, 10, 1000, { kurasStartedAt: iso(5) })],
    events: [{ startedAt: iso(6), endedAt: iso(7), reasonCode: 'CCB', category: 'kuras_crew' }],
  });
  assert.equal(r.kuras.qty, 500);
  assert.equal(r.kuras.hours, 4);
  assert.equal(r.kuras.rateMtH, 125);
});

test('a whole entry tagged Kuras is all kuras', () => {
  const r = buildRateBreakdown({
    ...base,
    movedQty: 1000,
    lines: [line(1, 0, 6, 700), line(2, 6, 10, 300, { movementType: 'kuras' })],
    events: [],
  });
  assert.equal(r.kuras.startedAt, iso(6));
  assert.equal(r.kuras.qty, 300);
  assert.equal(r.kuras.hours, 4);
  assert.equal(r.normal.hours, 6);
});

test('no moved qty or window gives empty rates', () => {
  const r = buildRateBreakdown({ movedQty: null, firstLoggedAt: null, lastLoggedAt: null, lines: [], events: [] });
  assert.equal(r.netRateMtH, null);
  assert.equal(r.pumpingHours, null);
  assert.equal(r.stopHours.total, 0);
});
