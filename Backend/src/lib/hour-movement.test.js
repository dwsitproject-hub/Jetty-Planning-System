import test from 'node:test';
import assert from 'node:assert/strict';
import { movementOfHour, strongerMovement, tagBucketsWithMovement } from './hour-movement.js';

const h = (n) => `2026-11-23T${String(n).padStart(2, '0')}:00:00.000Z`;

test('a Kuras entry is Kuras in every hour', () => {
  assert.equal(movementOfHour({ movementType: 'kuras' }, h(5), h(6)).movementType, 'kuras');
});

test('hours after the kuras start are Kuras, earlier ones Normal', () => {
  const line = { movementType: 'normal', kurasStartedAt: h(7) };
  assert.equal(movementOfHour(line, h(6), h(7)).movementType, 'normal');
  assert.equal(movementOfHour(line, h(7), h(8)).movementType, 'kuras');
});

test('a Mixed entry is Mixed only in hours that overlap a palka period, and lists the palkas', () => {
  const line = { movementType: 'mixed', kurasPeriods: [{ palka: '1B', startAt: h(5) + '', endAt: '2026-11-23T05:30:00.000Z' }, { palka: '2A', startAt: '2026-11-23T05:20:00.000Z', endAt: null }], endedAt: h(9) };
  const first = movementOfHour(line, h(5), h(6));
  assert.equal(first.movementType, 'mixed');
  assert.deepEqual(first.kurasPalkas, ['1B', '2A']);
  assert.equal(movementOfHour(line, h(4), h(5)).movementType, 'normal');
  assert.deepEqual(movementOfHour(line, h(8), h(9)).kurasPalkas, ['2A']);
});

test('no movement type means Normal (not yet classified)', () => {
  assert.equal(movementOfHour({ movementType: null }, h(5), h(6)).movementType, 'normal');
});

test('shared hours take the stronger label', () => {
  assert.equal(strongerMovement('normal', 'kuras'), 'kuras');
  assert.equal(strongerMovement('mixed', 'normal'), 'mixed');
});

test('buckets are tagged without losing their fields', () => {
  const tagged = tagBucketsWithMovement([{ hourStart: h(5), hourEnd: h(6), qtyMoved: 10 }], { movementType: 'kuras' });
  assert.equal(tagged[0].qtyMoved, 10);
  assert.equal(tagged[0].movementType, 'kuras');
});
