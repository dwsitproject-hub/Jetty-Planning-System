import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  diffDailyRows,
  diffHourlyRows,
  splitGapOutcome,
  summarizeQuantityByCommodity,
} from './atg-recovery-diff.js';

const row = (loadLineId, hour, qtyMoved, movementStatus) => ({
  loadLineId,
  hourStart: `2026-01-01T${hour}:00:00.000Z`,
  hourEnd: `2026-01-01T${String(Number(hour) + 1).padStart(2, '0')}:00:00.000Z`,
  qtyMoved,
  movementStatus,
});

describe('atg-recovery-diff', () => {
  it('flags hours whose quantity or status changed and keeps unchanged ones', () => {
    const d = diffHourlyRows(
      [row(1, '10', 0, 'incomplete'), row(1, '11', 50, 'active')],
      [row(1, '10', 40, 'active'), row(1, '11', 50, 'active')]
    );
    assert.equal(d.length, 2);
    assert.equal(d[0].changed, true);
    assert.equal(d[0].qtyDelta, 40);
    assert.equal(d[0].statusBefore, 'incomplete');
    assert.equal(d[0].statusAfter, 'active');
    assert.equal(d[1].changed, false);
  });

  it('treats a new hour as before = 0', () => {
    const d = diffHourlyRows([], [row(2, '12', 30, 'active')]);
    assert.equal(d[0].qtyBefore, 0);
    assert.equal(d[0].qtyAfter, 30);
    assert.equal(d[0].statusBefore, null);
    assert.equal(d[0].changed, true);
  });

  it('sums quantity per commodity and in total', () => {
    const d = diffHourlyRows(
      [row(1, '10', 0, 'incomplete'), row(2, '10', 10, 'active')],
      [row(1, '10', 40, 'active'), row(2, '10', 10, 'active')]
    );
    const s = summarizeQuantityByCommodity(d, new Map([[1, 'CPO'], [2, 'RBDPO']]));
    const cpo = s.byCommodity.find((c) => c.commodity === 'CPO');
    assert.equal(cpo.qtyDelta, 40);
    assert.equal(cpo.hoursChanged, 1);
    assert.equal(s.total.qtyDelta, 40);
    assert.equal(s.total.hoursTotal, 2);
  });

  it('splits closed and still-missing gaps', () => {
    const r = splitGapOutcome(['a', 'b', 'c'], [{ gapKey: 'b' }]);
    assert.deepEqual(r.closedGapKeys, ['a', 'c']);
    assert.deepEqual(r.stillMissingKeys, ['b']);
  });

  it('counts changed daily rows and the net delta', () => {
    const r = diffDailyRows(
      [{ loadLineId: 1, progressDate: '2026-01-01', qtyMoved: 100 }],
      [
        { loadLineId: 1, progressDate: '2026-01-01', qtyMoved: 140 },
        { loadLineId: 1, progressDate: '2026-01-02', qtyMoved: 0 },
      ]
    );
    assert.equal(r.changed, 1);
    assert.equal(r.totalDelta, 40);
  });
});
