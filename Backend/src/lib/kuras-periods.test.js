import test from 'node:test';
import assert from 'node:assert/strict';
import { parseKurasPeriods } from './kuras-periods.js';

const toIso = (s) => (s ? new Date(s).toISOString() : null);
const ctx = { lineIndex: 0, toIso, startIso: '2026-11-23T05:00:00Z', endIso: '2026-11-23T06:00:00Z', qty: 256.9 };

test('no periods is fine', () => {
  assert.deepEqual(parseKurasPeriods(undefined, ctx), { ok: true, value: [] });
  assert.deepEqual(parseKurasPeriods([], ctx), { ok: true, value: [] });
});

test('a valid period is normalised (upper-case palka, empty until = still going)', () => {
  const r = parseKurasPeriods([{ palka: '1b', from: '2026-11-23T05:20:00Z', until: '', qty: '38' }], ctx);
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, [{ palka: '1B', startedAt: '2026-11-23T05:20:00.000Z', endedAt: null, qty: 38 }]);
});

test('palka is required and at most 3 characters', () => {
  assert.equal(parseKurasPeriods([{ palka: '', from: '2026-11-23T05:20:00Z' }], ctx).ok, false);
  assert.equal(parseKurasPeriods([{ palka: '1BCD', from: '2026-11-23T05:20:00Z' }], ctx).ok, false);
});

test('from cannot be before the entry start', () => {
  const r = parseKurasPeriods([{ palka: '1B', from: '2026-11-23T04:40:00Z' }], ctx);
  assert.equal(r.ok, false);
  assert.match(r.error, /before the entry start/);
});

test('until must be after from, and not after the entry end', () => {
  assert.match(parseKurasPeriods([{ palka: '1B', from: '2026-11-23T05:20:00Z', until: '2026-11-23T05:10:00Z' }], ctx).error, /after from/);
  assert.match(parseKurasPeriods([{ palka: '1B', from: '2026-11-23T05:20:00Z', until: '2026-11-23T06:10:00Z' }], ctx).error, /after the entry end/);
});

test('an open entry has no upper bound', () => {
  const open = { ...ctx, endIso: null };
  assert.equal(parseKurasPeriods([{ palka: '1B', from: '2026-11-23T05:20:00Z', until: '2026-11-24T09:00:00Z' }], open).ok, true);
});

test('quantity must be above 0 and not more than the entry quantity', () => {
  assert.equal(parseKurasPeriods([{ palka: '1B', from: '2026-11-23T05:20:00Z', qty: 0 }], ctx).ok, false);
  assert.equal(parseKurasPeriods([{ palka: '1B', from: '2026-11-23T05:20:00Z', qty: 300 }], ctx).ok, false);
});

test('the same palka cannot overlap itself, different palkas can run together', () => {
  const same = parseKurasPeriods([
    { palka: '1B', from: '2026-11-23T05:10:00Z', until: '2026-11-23T05:40:00Z' },
    { palka: '1B', from: '2026-11-23T05:30:00Z', until: '2026-11-23T05:50:00Z' },
  ], ctx);
  assert.equal(same.ok, false);
  const diff = parseKurasPeriods([
    { palka: '1B', from: '2026-11-23T05:10:00Z', until: '2026-11-23T05:40:00Z' },
    { palka: '2A', from: '2026-11-23T05:30:00Z', until: '2026-11-23T05:50:00Z' },
  ], ctx);
  assert.equal(diff.ok, true);
});
