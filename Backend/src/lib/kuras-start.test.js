import test from 'node:test';
import assert from 'node:assert/strict';
import { findKurasStart, kurasStartInsideEntry, parseKurasStartInput, resolveKurasStartColumns } from './kuras-start.js';

const RULE = { isActive: true, isDefault: true, remainingPctBelow: 20, rateMtPerHourBelow: 50, matchMode: 'and' };

/** Hourly buckets from 00:00 with the given MT per hour. */
function hours(rates, day = '2026-11-14') {
  return rates.map((q, i) => ({
    hourStart: new Date(Date.parse(`${day}T00:00:00Z`) + i * 3600000).toISOString(),
    hourEnd: new Date(Date.parse(`${day}T00:00:00Z`) + (i + 1) * 3600000).toISOString(),
    qtyMoved: q,
    movementStatus: q > 0 ? 'active' : 'flat_movement',
  }));
}

const base = {
  lineStartedAt: '2026-11-14T00:00:00Z',
  lineEndedAt: '2026-11-14T12:00:00Z',
  plannedQty: 1000,
  movedBefore: 0,
  mtFactor: 1,
  rule: RULE,
};

test('finds the hour kuras started after fast pumping', () => {
  // 8 h at 100 MT/h = 800 of 950 moved (15.8% left), then 4 slow hours at 30 MT/h
  const r = findKurasStart({
    ...base,
    plannedQty: 950,
    hours: hours([100, 100, 100, 100, 100, 100, 100, 100, 30, 30, 30, 30]),
  });
  assert.equal(r.kurasStartedAt, '2026-11-14T08:00:00.000Z');
  assert.equal(r.reason.code, 'kurasStart');
  assert.equal(r.reason.remainingPct, 15.8);
  assert.equal(r.reason.rateMtPerHour, 30);
});

test('a short slow dip in the middle is not kuras; flat hours do not break the run', () => {
  const r = findKurasStart({
    ...base,
    plannedQty: 900,
    hours: hours([100, 100, 100, 100, 100, 100, 100, 30, 100, 0, 30, 30]),
  });
  assert.equal(r.kurasStartedAt, '2026-11-14T10:00:00.000Z');
});

test('no kuras when the last hours are still fast, or nothing pumped', () => {
  assert.equal(findKurasStart({ ...base, hours: hours([100, 100, 100]) }).reason.code, 'noKuras');
  assert.equal(findKurasStart({ ...base, hours: hours([0, 0]) }).reason.code, 'noHourly');
  assert.equal(findKurasStart({ ...base, hours: [] }).kurasStartedAt, null);
});

test('open entries and inactive rules are skipped', () => {
  assert.equal(findKurasStart({ ...base, lineEndedAt: null, hours: hours([30]) }).reason.code, 'open');
  assert.equal(findKurasStart({ ...base, rule: { ...RULE, isActive: false }, hours: hours([30]) }).reason.code, 'noRule');
});

test('first partial hour is rated over the part inside the entry and start is clamped', () => {
  const r = findKurasStart({
    ...base,
    movedBefore: 950,
    lineStartedAt: '2026-11-14T00:30:00Z',
    hours: hours([20, 30]),
  });
  // 20 MT in 30 min = 40 MT/h < 50, remaining 5% → kuras from the entry start
  assert.equal(r.kurasStartedAt, '2026-11-14T00:30:00.000Z');
});

test('parseKurasStartInput', () => {
  const toIso = (s) => (s === 'bad' ? null : new Date(`${s}:00+07:00`).toISOString());
  assert.deepEqual(parseKurasStartInput(undefined, 0, toIso), { ok: true, value: undefined });
  assert.deepEqual(parseKurasStartInput('', 0, toIso), { ok: true, value: 'auto' });
  assert.deepEqual(parseKurasStartInput('none', 0, toIso), { ok: true, value: 'none' });
  assert.deepEqual(parseKurasStartInput('2026-11-14T22:00', 0, toIso), { ok: true, value: '2026-11-14T15:00:00.000Z' });
  assert.equal(parseKurasStartInput('bad', 2, toIso).ok, false);
});

test('resolveKurasStartColumns keeps manual values across re-saves', () => {
  const prior = { kuras_started_at: '2026-11-14T09:00:00Z', kuras_start_source: 'manual', kuras_start_set_by: 3, kuras_start_set_at: 'x' };
  assert.equal(resolveKurasStartColumns(undefined, prior, 9).startedAt, prior.kuras_started_at);
  assert.equal(resolveKurasStartColumns('auto', prior, 9).source, 'auto');
  assert.equal(resolveKurasStartColumns('2026-11-14T09:00:00Z', prior, 9).setBy, 3);
  const none = resolveKurasStartColumns('none', prior, 9);
  assert.equal(none.startedAt, null);
  assert.equal(none.source, 'manual');
  assert.equal(none.setBy, 9);
});

test('kurasStartInsideEntry', () => {
  const s = '2026-11-14T00:00:00Z';
  const e = '2026-11-14T12:00:00Z';
  assert.equal(kurasStartInsideEntry('2026-11-14T09:00:00Z', s, e), true);
  assert.equal(kurasStartInsideEntry('2026-11-14T13:00:00Z', s, e), false);
  assert.equal(kurasStartInsideEntry('2026-11-13T23:00:00Z', s, e), false);
  assert.equal(kurasStartInsideEntry('2026-11-15T09:00:00Z', s, null), true);
});
