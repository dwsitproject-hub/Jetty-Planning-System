import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateBreakdownByCommodity,
  normalizeLoadLineCommodityId,
} from './si-commodity-options.js';

describe('aggregateBreakdownByCommodity', () => {
  it('sums qty for same commodity_id', () => {
    const out = aggregateBreakdownByCommodity([
      { commodityId: 1, commodityShortName: 'CPO', metricCode: 'MT', qty: 100, lineOrder: 1 },
      { commodityId: 1, commodityShortName: 'CPO', metricCode: 'MT', qty: 200, lineOrder: 2 },
      { commodityId: 2, commodityShortName: 'POME', metricCode: 'MT', qty: 50, lineOrder: 3 },
    ]);
    assert.equal(out.length, 2);
    const cpo = out.find((o) => o.commodityId === 1);
    assert.equal(cpo.plannedQty, 300);
    assert.equal(cpo.shortName, 'CPO');
    const pome = out.find((o) => o.commodityId === 2);
    assert.equal(pome.plannedQty, 50);
  });

  it('flags metricMixed when same commodity uses multiple metrics', () => {
    const out = aggregateBreakdownByCommodity([
      { commodityId: 1, commodityShortName: 'CPO', metricCode: 'MT', qty: 1, lineOrder: 1 },
      { commodityId: 1, commodityShortName: 'CPO', metricCode: 'KL', qty: 2, lineOrder: 2 },
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].metricMixed, true);
  });
});

describe('normalizeLoadLineCommodityId', () => {
  const multi = [
    { commodityId: 10, shortName: 'CPO', plannedQty: 100, metricCode: 'MT' },
    { commodityId: 20, shortName: 'POME', plannedQty: 50, metricCode: 'MT' },
  ];
  const single = [{ commodityId: 10, shortName: 'CPO', plannedQty: 100, metricCode: 'MT' }];

  it('auto-fills when single commodity and id omitted', () => {
    const r = normalizeLoadLineCommodityId(undefined, single, { lineIndex: 0 });
    assert.deepEqual(r, { commodityId: 10 });
  });

  it('requires id when multiple commodities', () => {
    const r = normalizeLoadLineCommodityId(undefined, multi, { lineIndex: 1 });
    assert.ok(r.error);
    assert.match(r.error.error, /required/);
  });

  it('rejects foreign commodity id', () => {
    const r = normalizeLoadLineCommodityId(999, multi, { lineIndex: 0 });
    assert.ok(r.error);
    assert.match(r.error.error, /not on this shipping instruction/);
  });
});
