import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProductCargoProgress } from './cargo-product-progress.js';

const siProducts = [
  { commodityId: 11, shortName: 'RG', name: 'REFINED GLYCERINE', plannedQty: 2000 },
  { commodityId: 10, shortName: 'CG', name: 'CRUDE GLYCERINE', plannedQty: 5000 },
];

test('returns nothing for a single product', () => {
  const rows = buildProductCargoProgress({
    siProducts: [siProducts[0]],
    lineMoved: [{ commodityId: 11, shortName: 'RG', movedQty: 500, isOpen: true }],
    canonicalMovedQty: 500,
  });
  assert.deepEqual(rows, []);
});

test('splits a finished product from the product still loading', () => {
  const rows = buildProductCargoProgress({
    siProducts,
    lineMoved: [
      { commodityId: 11, shortName: 'RG', movedQty: 1750, isOpen: false },
      { commodityId: 11, shortName: 'RG', movedQty: 250, isOpen: false },
      { commodityId: 10, shortName: 'CG', movedQty: 3376, isOpen: true },
    ],
    canonicalMovedQty: 5376,
  });
  assert.deepEqual(
    rows.map((row) => ({ shortName: row.shortName, movedQty: row.movedQty, plannedQty: row.plannedQty, isLive: row.isLive })),
    [
      { shortName: 'RG', movedQty: 2000, plannedQty: 2000, isLive: false },
      { shortName: 'CG', movedQty: 3376, plannedQty: 5000, isLive: true },
    ]
  );
});

test('uses the on-screen total for the open product when it differs from the segment reading', () => {
  const rows = buildProductCargoProgress({
    siProducts,
    lineMoved: [
      { commodityId: 11, shortName: 'RG', movedQty: 2000, isOpen: false },
      { commodityId: 10, shortName: 'CG', movedQty: 3300, isOpen: true },
    ],
    canonicalMovedQty: 5376,
  });
  assert.equal(rows[1].movedQty, 3376);
  assert.equal(rows[0].movedQty + rows[1].movedQty, 5376);
});

test('shows a product that has not started once another product is moving', () => {
  const rows = buildProductCargoProgress({
    siProducts,
    lineMoved: [{ commodityId: 11, shortName: 'RG', movedQty: 400, isOpen: true }],
    canonicalMovedQty: 400,
  });
  assert.equal(rows[0].movedQty, 400);
  assert.equal(rows[1].movedQty, 0);
  assert.equal(rows[1].plannedQty, 5000);
});

test('rates each product from its own start and end', () => {
  const rows = buildProductCargoProgress({
    siProducts: [
      { commodityId: 1, shortName: 'RPOME', plannedQty: 3 },
      { commodityId: 2, shortName: 'POME', plannedQty: 2 },
    ],
    lineMoved: [
      {
        commodityId: 1,
        shortName: 'RPOME',
        movedQty: 3,
        isOpen: false,
        startedAt: '2026-09-28T03:01:00.000Z',
        endedAt: '2026-09-30T05:41:00.000Z',
      },
      {
        commodityId: 2,
        shortName: 'POME',
        movedQty: 2,
        isOpen: false,
        startedAt: '2026-10-01T05:41:00.000Z',
        endedAt: '2026-10-07T05:41:00.000Z',
      },
    ],
    canonicalMovedQty: 5,
  });
  assert.equal(rows[0].avgRateTph, 0.06);
  assert.equal(rows[1].avgRateTph, 0.01);
});

test('returns nothing before any cargo has moved', () => {
  assert.deepEqual(buildProductCargoProgress({ siProducts, lineMoved: [], canonicalMovedQty: 0 }), []);
});
