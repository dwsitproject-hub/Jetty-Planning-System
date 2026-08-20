import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isAtgResolvable, resolveCargoLineQty } from './cargo-line-qty.js';

const ATG_OK = { ok: true, incomplete: false, sumDeltaMass: 906.709 };
const ATG_NO_SAMPLES = { ok: false, incomplete: true, sumDeltaMass: null, error: 'no_samples' };
const ATG_PARTIAL = { ok: true, incomplete: true, sumDeltaMass: 400, error: 'partial_samples' };

function allAtgLine(overrides = {}) {
  return {
    commodityType: 'Liquid',
    atgTankIds: [42],
    manualTankIds: [],
    atgQtyMode: 'auto',
    hasEnd: true,
    submittedQty: null,
    manualQty: null,
    atg: ATG_OK,
    ...overrides,
  };
}

describe('isAtgResolvable', () => {
  it('accepts a complete positive delta', () => {
    assert.equal(isAtgResolvable(ATG_OK), true);
  });

  it('rejects missing, partial and non-positive deltas', () => {
    assert.equal(isAtgResolvable(null), false);
    assert.equal(isAtgResolvable(ATG_NO_SAMPLES), false);
    assert.equal(isAtgResolvable(ATG_PARTIAL), false);
    assert.equal(isAtgResolvable({ ok: true, incomplete: false, sumDeltaMass: 0 }), false);
  });
});

describe('resolveCargoLineQty — ATG available', () => {
  it('uses the ATG delta and ignores the submitted quantity', () => {
    const r = resolveCargoLineQty(allAtgLine({ submittedQty: 1100 }));
    assert.equal(r.error, null);
    assert.equal(r.qty, 906.709);
    assert.equal(r.atgQtyMode, 'auto');
    assert.equal(r.coerced, 'qty_from_atg');
  });

  it('fills the quantity when the client sends none', () => {
    const r = resolveCargoLineQty(allAtgLine());
    assert.equal(r.qty, 906.709);
    assert.equal(r.coerced, null);
  });

  it('rejects a new manual override', () => {
    const r = resolveCargoLineQty(allAtgLine({ atgQtyMode: 'manual', submittedQty: 1100 }));
    assert.match(r.error, /manual quantity override is not allowed/);
    assert.equal(r.qty, null);
  });

  it('keeps a grandfathered manual override on the same window', () => {
    const r = resolveCargoLineQty(
      allAtgLine({ atgQtyMode: 'manual', submittedQty: 1100, grandfatheredManual: true })
    );
    assert.equal(r.error, null);
    assert.equal(r.qty, 1100);
    assert.equal(r.atgQtyMode, 'manual');
  });

  it('derives a mixed-line total from ATG plus the manual portion', () => {
    const r = resolveCargoLineQty(
      allAtgLine({ manualTankIds: [7], manualQty: 93.291, submittedQty: 5 })
    );
    assert.equal(r.error, null);
    assert.equal(r.qty, 1000);
    assert.equal(r.atgQtyMode, 'auto');
  });

  it('requires the manual portion on a mixed line', () => {
    const r = resolveCargoLineQty(allAtgLine({ manualTankIds: [7] }));
    assert.match(r.error, /manualQty is required/);
  });
});

describe('resolveCargoLineQty — ATG unavailable', () => {
  it('records an auto line with a submitted quantity as a manual override', () => {
    const r = resolveCargoLineQty(allAtgLine({ atg: ATG_NO_SAMPLES, submittedQty: 692.869 }));
    assert.equal(r.error, null);
    assert.equal(r.qty, 692.869);
    assert.equal(r.atgQtyMode, 'manual');
    assert.equal(r.coerced, 'manual_no_atg');
  });

  it('rejects an auto line with no quantity to fall back on', () => {
    const r = resolveCargoLineQty(allAtgLine({ atg: ATG_PARTIAL }));
    assert.match(r.error, /mark "ATG not available"/);
  });

  it('accepts an explicit manual override', () => {
    const r = resolveCargoLineQty(
      allAtgLine({ atg: ATG_NO_SAMPLES, atgQtyMode: 'manual', submittedQty: 692.869 })
    );
    assert.equal(r.error, null);
    assert.equal(r.qty, 692.869);
    assert.equal(r.atgQtyMode, 'manual');
  });

  it('requires a quantity on a manual override', () => {
    const r = resolveCargoLineQty(allAtgLine({ atg: ATG_NO_SAMPLES, atgQtyMode: 'manual' }));
    assert.match(r.error, /qty is required/);
  });
});

describe('resolveCargoLineQty — segments without an ATG quantity', () => {
  it('stores no quantity while a segment is in progress', () => {
    const r = resolveCargoLineQty(allAtgLine({ hasEnd: false, submittedQty: 500 }));
    assert.equal(r.error, null);
    assert.equal(r.qty, null);
  });

  it('keeps the submitted quantity for solid cargo', () => {
    const r = resolveCargoLineQty({
      commodityType: 'Solid',
      atgTankIds: [],
      manualTankIds: [],
      atgQtyMode: 'auto',
      hasEnd: true,
      submittedQty: 250,
      manualQty: null,
      atg: null,
    });
    assert.equal(r.error, null);
    assert.equal(r.qty, 250);
  });

  it('keeps the submitted quantity for liquid tanks without ATG', () => {
    const r = resolveCargoLineQty(allAtgLine({ atgTankIds: [], manualTankIds: [7], submittedQty: 250, atg: null }));
    assert.equal(r.error, null);
    assert.equal(r.qty, 250);
  });

  it('requires a quantity for a closed non-ATG segment', () => {
    const r = resolveCargoLineQty(allAtgLine({ atgTankIds: [], manualTankIds: [7], atg: null }));
    assert.match(r.error, /qty is required when endAt is set/);
  });
});
