import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildCargoRateResult,
  computeCargoRateFromContext,
  lineMatchesProductKey,
  linesForProductRate,
  productKeyFromCommodityLabel,
} from './management-dashboard-cargo-rate.js';
import { computeAvgRateTph } from './operational-progress.js';
import { DEFAULT_OPERATIONAL_DAY_START } from './operational-day.js';

function mockDbForCargoSummary({ atgTankIds = new Set() } = {}) {
  return {
    query: async (sql, params) => {
      if (sql.includes('tank_gauging_tank_map')) {
        const tankId = Number(params[0]);
        return { rows: atgTankIds.has(tankId) ? [{ 1: 1 }] : [] };
      }
      return { rows: [] };
    },
  };
}

const baseCtx = {
  timezone: 'Asia/Jakarta',
  dayStartTime: DEFAULT_OPERATIONAL_DAY_START,
  commodityType: 'Liquid',
  siQty: 5000,
  lines: [],
};

describe('productKeyFromCommodityLabel', () => {
  it('normalizes like frontend', () => {
    assert.equal(productKeyFromCommodityLabel('  cpo  '), 'CPO');
    assert.equal(productKeyFromCommodityLabel(''), 'Unknown');
  });
});

describe('lineMatchesProductKey', () => {
  it('requires commodity_id for per-product match', () => {
    assert.equal(
      lineMatchesProductKey(
        { commodityId: 1, commodityShortName: 'CPKO' },
        'CPKO'
      ),
      true
    );
    assert.equal(
      lineMatchesProductKey({ commodityId: null, commodityShortName: 'CPKO' }, 'CPKO'),
      false
    );
    assert.equal(
      lineMatchesProductKey({ commodityId: 1, commodityShortName: 'CPO' }, 'CPKO'),
      false
    );
  });
});

describe('buildCargoRateResult', () => {
  const windowLines = [
    {
      startedAt: '2026-08-04T08:00:00+07:00',
      endedAt: '2026-08-04T16:00:00+07:00',
    },
  ];

  it('returns null rate when no moved qty', () => {
    const r = buildCargoRateResult(null, windowLines);
    assert.equal(r.rateMtH, null);
  });

  it('computes rate from moved and line window', () => {
    const summary = { movedQty: 800, source: 'atg', isLive: false, hasActiveCargo: false };
    const r = buildCargoRateResult(summary, windowLines);
    assert.equal(r.movedQty, 800);
    assert.equal(r.source, 'atg');
    assert.ok(r.loggedHours > 0);
    const expected = computeAvgRateTph(
      800,
      '2026-08-04T08:00:00+07:00',
      '2026-08-04T16:00:00+07:00'
    );
    assert.equal(r.rateMtH, +expected.toFixed(2));
  });

  it('uses hybrid source metadata', () => {
    const summary = {
      movedQty: 700,
      source: 'hybrid',
      isLive: false,
      hasActiveCargo: false,
    };
    const r = buildCargoRateResult(summary, windowLines);
    assert.equal(r.source, 'hybrid');
    assert.ok(r.rateMtH > 0);
  });
});

describe('computeCargoRateFromContext', () => {
  it('manual closed segment', async () => {
    const db = mockDbForCargoSummary({});
    const ctx = {
      ...baseCtx,
      lines: [
        {
          id: 1,
          qty: 1530,
          manualQty: 1530,
          atgQtyMode: 'auto',
          startedAt: '2026-08-04T08:00:00+07:00',
          endedAt: '2026-08-04T16:00:00+07:00',
          tankIds: [99],
          commodityId: 10,
          commodityShortName: 'CPO',
        },
      ],
    };
    const r = await computeCargoRateFromContext(db, ctx);
    assert.ok(r);
    assert.equal(r.source, 'manual');
    assert.equal(r.movedQty, 1530);
    assert.ok(r.rateMtH > 0);
  });

  it('ATG closed segment uses saved line qty', async () => {
    const db = mockDbForCargoSummary({ atgTankIds: new Set([42]) });
    const ctx = {
      ...baseCtx,
      lines: [
        {
          id: 1,
          qty: 890,
          atgQtyMode: 'auto',
          startedAt: '2026-08-04T08:00:00+07:00',
          endedAt: '2026-08-04T16:00:00+07:00',
          tankIds: [42],
          commodityId: 10,
          commodityShortName: 'CPO',
        },
      ],
    };
    const r = await computeCargoRateFromContext(db, ctx);
    assert.equal(r.source, 'atg');
    assert.equal(r.movedQty, 890);
  });

  it('solid commodity uses manual mode', async () => {
    const db = mockDbForCargoSummary({});
    const ctx = {
      ...baseCtx,
      commodityType: 'Solid',
      lines: [
        {
          id: 1,
          qty: 400,
          startedAt: '2026-08-04T08:00:00+07:00',
          endedAt: '2026-08-04T12:00:00+07:00',
          tankIds: [1],
          atgQtyMode: 'auto',
          commodityId: 11,
          commodityShortName: 'PKC',
        },
      ],
    };
    const r = await computeCargoRateFromContext(db, ctx);
    assert.equal(r.source, 'manual');
    assert.equal(r.movedQty, 400);
  });

  it('per-product filter excludes other commodities', async () => {
    const db = mockDbForCargoSummary({ atgTankIds: new Set([42]) });
    const cpkoLine = {
      id: 2,
      qty: 300,
      atgQtyMode: 'auto',
      startedAt: '2026-08-04T13:00:00+07:00',
      endedAt: '2026-08-04T16:00:00+07:00',
      tankIds: [42],
      commodityId: 20,
      commodityShortName: 'CPKO',
    };
    const ctx = {
      ...baseCtx,
      lines: [
        {
          id: 1,
          qty: 500,
          atgQtyMode: 'auto',
          startedAt: '2026-08-04T08:00:00+07:00',
          endedAt: '2026-08-04T12:00:00+07:00',
          tankIds: [42],
          commodityId: 10,
          commodityShortName: 'CPO',
        },
        cpkoLine,
      ],
    };
    const cpkoOnly = { ...ctx, lines: [cpkoLine] };
    const r = await computeCargoRateFromContext(db, cpkoOnly);
    assert.equal(r.movedQty, 300);
    assert.notEqual(r.rateMtH, null);
  });

  it('untagged line counts for single-product SI only', async () => {
    const db = mockDbForCargoSummary({});
    const ctx = {
      ...baseCtx,
      siProductKeys: ['CPO'],
      lines: [
        {
          id: 1,
          qty: 500,
          startedAt: '2026-08-04T08:00:00+07:00',
          endedAt: '2026-08-04T12:00:00+07:00',
          tankIds: [99],
          commodityId: null,
          commodityShortName: null,
        },
      ],
    };
    const filtered = linesForProductRate(ctx, 'CPO');
    const scoped = { ...ctx, lines: filtered };
    const r = await computeCargoRateFromContext(db, scoped);
    assert.ok(r);
    assert.equal(r.movedQty, 500);
  });

  it('untagged line excluded on multi-product SI', async () => {
    const db = mockDbForCargoSummary({});
    const ctx = {
      ...baseCtx,
      siProductKeys: ['CPO', 'CPKO'],
      lines: [
        {
          id: 1,
          qty: 500,
          startedAt: '2026-08-04T08:00:00+07:00',
          endedAt: '2026-08-04T12:00:00+07:00',
          tankIds: [99],
          commodityId: null,
        },
      ],
    };
    assert.equal(linesForProductRate(ctx, 'CPKO').length, 0);
  });
});
