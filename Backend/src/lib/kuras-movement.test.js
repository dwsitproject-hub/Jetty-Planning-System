import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyKurasSegments,
  evaluateKurasSegment,
  parseMovementTypeInput,
  pickKurasRule,
} from './kuras-movement.js';

const DEFAULT = { id: 1, isDefault: true, isActive: true, remainingPctBelow: 20, rateMtPerHourBelow: 30, matchMode: 'and' };
const CPO = {
  id: 2,
  isDefault: false,
  isActive: true,
  remainingPctBelow: 15,
  rateMtPerHourBelow: 25,
  matchMode: 'and',
  commodityIds: [7],
  commodityLabels: ['CPO'],
};

test('parseMovementTypeInput keeps stored tag when missing and rejects junk', () => {
  assert.deepEqual(parseMovementTypeInput(undefined, 0), { ok: true, value: undefined });
  assert.deepEqual(parseMovementTypeInput('Kuras', 0), { ok: true, value: 'kuras' });
  assert.deepEqual(parseMovementTypeInput('auto', 0), { ok: true, value: 'auto' });
  assert.equal(parseMovementTypeInput('drain', 2).ok, false);
});

test('pickKurasRule prefers the commodity rule, then the default', () => {
  assert.equal(pickKurasRule([DEFAULT, CPO], 7).id, 2);
  assert.equal(pickKurasRule([DEFAULT, CPO], 9).id, 1);
  assert.equal(pickKurasRule([CPO], 9), null);
});

test('evaluateKurasSegment AND needs both limits; OR needs one', () => {
  assert.equal(evaluateKurasSegment({ remainingPct: 12, rateMtPerHour: 24.6, isOpen: false, rule: DEFAULT }).movementType, 'kuras');
  assert.equal(evaluateKurasSegment({ remainingPct: 12, rateMtPerHour: 225, isOpen: false, rule: DEFAULT }).movementType, 'normal');
  const or = { ...DEFAULT, matchMode: 'or' };
  assert.equal(evaluateKurasSegment({ remainingPct: 12, rateMtPerHour: 225, isOpen: false, rule: or }).movementType, 'kuras');
});

test('evaluateKurasSegment explains undecided cases', () => {
  assert.deepEqual(evaluateKurasSegment({ remainingPct: 5, rateMtPerHour: 5, isOpen: true, rule: DEFAULT }), {
    movementType: null,
    reason: { code: 'open' },
  });
  assert.equal(evaluateKurasSegment({ remainingPct: 5, rateMtPerHour: 5, isOpen: false, rule: null }).reason.code, 'noRule');
  assert.equal(
    evaluateKurasSegment({ remainingPct: 5, rateMtPerHour: 5, isOpen: false, rule: { ...DEFAULT, isActive: false } }).reason.code,
    'noRule'
  );
  assert.equal(evaluateKurasSegment({ remainingPct: null, rateMtPerHour: 5, isOpen: false, rule: DEFAULT }).reason.code, 'noPlan');
  assert.equal(evaluateKurasSegment({ remainingPct: 5, rateMtPerHour: null, isOpen: false, rule: DEFAULT }).reason.code, 'noMtRate');
});

test('classifyKurasSegments measures remaining per product before each segment', () => {
  const lines = [
    { id: 11, qty: 3760, startedAt: '2026-10-18T05:18:00Z', endedAt: '2026-10-18T22:00:00Z', commodityId: 7 },
    { id: 12, qty: 196.8, startedAt: '2026-10-18T22:00:00Z', endedAt: '2026-10-19T06:00:00Z', commodityId: 7 },
    { id: 13, qty: 50, startedAt: '2026-10-19T06:00:00Z', endedAt: null, commodityId: 7 },
  ];
  const res = classifyKurasSegments({
    lines,
    siQty: 4000,
    siProducts: [{ commodityId: 7, plannedQty: 4000 }],
    rules: [DEFAULT],
    mtFactorFor: () => 1,
  });
  assert.equal(res.get(11).movementType, 'normal');
  assert.equal(res.get(11).reason.remainingPct, 100);
  assert.equal(res.get(12).movementType, 'kuras');
  assert.equal(res.get(12).reason.remainingPct, 6);
  assert.equal(res.get(12).reason.rateMtPerHour, 24.6);
  assert.equal(res.get(13).reason.code, 'open');
});

test('classifyKurasSegments converts KL rates with the commodity factor', () => {
  const res = classifyKurasSegments({
    lines: [{ id: 1, qty: 30, startedAt: '2026-10-19T00:00:00Z', endedAt: '2026-10-19T01:00:00Z', commodityId: 7 }],
    siQty: 1000,
    siProducts: [{ commodityId: 7, plannedQty: 100 }],
    rules: [{ ...DEFAULT, matchMode: 'or' }],
    mtFactorFor: () => 0.9,
  });
  assert.equal(res.get(1).reason.rateMtPerHour, 27);
  assert.equal(res.get(1).movementType, 'kuras');
});
