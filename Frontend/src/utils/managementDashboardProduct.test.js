import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  aggregateByProduct,
  expandVoyageToProductSlices,
  parseProductQtyMap,
  productKeyFromCommodity,
  voyageMovedQtyLines,
  voyageMovedQtySortValue,
  voyagesForProduct,
} from './managementDashboardProduct.js'

function row(overrides) {
  return {
    vessel: 'V1',
    tb: '2026-06-01T00:00:00Z',
    status: 'SAILED',
    castOff: '2026-06-02T00:00:00Z',
    purpose: 'Loading',
    commodity: 'FAME',
    qty: 1000,
    wait: 10,
    pre: 4,
    opsH: 10,
    cargoDoneToSailH: 8,
    ...overrides,
  }
}

describe('productKeyFromCommodity', () => {
  it('buckets empty as Unknown and normalizes case', () => {
    assert.equal(productKeyFromCommodity(''), 'Unknown')
    assert.equal(productKeyFromCommodity('  cpo  '), 'CPO')
    assert.equal(productKeyFromCommodity('Cpo'), 'CPO')
  })
})

describe('parseProductQtyMap', () => {
  it('reads per-product qty from multi-line totalQtyDisplay', () => {
    const map = parseProductQtyMap('CPO 4.000 MT\nCPKO 1.000 MT')
    assert.equal(map.get('CPO'), 4000)
    assert.equal(map.get('CPKO'), 1000)
  })
})

describe('voyageMovedQtyLines', () => {
  it('uses one commodity’s logged movement, not the shipment-plan qty', () => {
    const lines = voyageMovedQtyLines(row({
      qty: 5000,
      totalQtyDisplay: 'FAME 5.000 MT',
      productRatesByKey: { FAME: { movedQty: 14000 } },
    }))
    assert.deepEqual(lines, [{ label: 'FAME', qty: 14000 }])
  })

  it('lists each commodity’s movement and does not invent a split from the plan total', () => {
    const lines = voyageMovedQtyLines(row({
      commodity: 'CPO · CPKO',
      qty: 4700,
      totalQtyDisplay: 'CPO 4.000 MT\nCPKO 700 MT',
      productRatesByKey: { CPO: { movedQty: 4000 } },
    }))
    assert.deepEqual(lines, [
      { label: 'CPO', qty: 4000 },
      { label: 'CPKO', qty: null },
    ])
    assert.equal(voyageMovedQtySortValue(row({
      commodity: 'CPO · CPKO',
      productRatesByKey: { CPO: { movedQty: 4000 }, CPKO: { movedQty: 700 } },
    })), 4700)
    assert.equal(voyageMovedQtySortValue(row({
      commodity: 'CPO · CPKO',
      qty: 4700,
    })), null)
  })
})

describe('expandVoyageToProductSlices', () => {
  it('splits combined commodity label into separate slices', () => {
    const slices = expandVoyageToProductSlices(
      row({
        purpose: 'Unloading',
        commodity: 'CPO · CPKO',
        totalQtyDisplay: 'CPO 4.000 MT\nCPKO 1.000 MT',
        qty: 5000,
        opsH: 10,
      })
    )
    assert.equal(slices.length, 2)
    assert.deepEqual(
      slices.map((s) => [s.productLabel, s.qty]),
      [
        ['CPO', 4000],
        ['CPKO', 1000],
      ]
    )
  })
})

describe('aggregateByProduct', () => {
  it('splits Loading vs Unloading and computes means over logged voyages', () => {
    const agg = aggregateByProduct([
      row({
        vessel: 'L1',
        commodity: 'FAME',
        wait: 4,
        pre: 2,
        qty: 800,
        opsH: 8,
        cargoDoneToSailH: 6,
        productRatesByKey: { FAME: { rateMtH: 100, movedQty: 800, loggedHours: 8 } },
      }),
      row({
        vessel: 'L2',
        commodity: 'fame',
        wait: 8,
        pre: null,
        qty: 200,
        opsH: 4,
        cargoDoneToSailH: 10,
        productRatesByKey: { FAME: { rateMtH: 50, movedQty: 200, loggedHours: 4 } },
      }),
      row({
        vessel: 'U1',
        purpose: 'Unloading',
        commodity: 'CPO',
        wait: 12,
        pre: 6,
        qty: 600,
        opsH: 6,
        cargoDoneToSailH: 4,
        tb: '2026-06-03T00:00:00Z',
      }),
    ])

    assert.equal(agg.outgoing.length, 1)
    assert.equal(agg.outgoing[0].label, 'FAME')
    assert.equal(agg.outgoing[0].shipments, 2)
    assert.equal(agg.outgoing[0].throughputMt, 1000)
    assert.equal(agg.outgoing[0].avgWait, 6)
    assert.equal(agg.outgoing[0].avgPre, 2)
    assert.equal(agg.outgoing[0].coverage.preLogged, 1)
    assert.equal(agg.outgoing[0].avgRate, 75)
    assert.equal(agg.outgoing[0].avgCargoDoneToSail, 8)

    assert.equal(agg.incoming.length, 1)
    assert.equal(agg.incoming[0].label, 'CPO')
    assert.equal(agg.incoming[0].shipments, 1)
    assert.equal(agg.incoming[0].avgWait, 12)
  })

  it('puts multi-commodity voyage into separate product rows', () => {
    const agg = aggregateByProduct([
      row({
        purpose: 'Unloading',
        commodity: 'CPO · CPKO',
        totalQtyDisplay: 'CPO 4.000 MT\nCPKO 1.000 MT',
        qty: 5000,
        opsH: 10,
        wait: 2,
        tb: '2026-06-05T00:00:00Z',
      }),
      row({
        purpose: 'Unloading',
        commodity: 'CPO',
        qty: 100,
        tb: '2026-06-06T00:00:00Z',
      }),
    ])
    const cpo = agg.incoming.find((r) => r.label === 'CPO')
    const cpko = agg.incoming.find((r) => r.label === 'CPKO')
    assert.ok(cpo)
    assert.ok(cpko)
    assert.equal(cpo.shipments, 2)
    assert.equal(cpko.shipments, 1)
    assert.equal(cpo.throughputMt, 4100)
    assert.equal(cpko.throughputMt, 1000)
  })

  it('respects purpose filter', () => {
    const agg = aggregateByProduct(
      [
        row({ purpose: 'Loading', commodity: 'FAME' }),
        row({ purpose: 'Unloading', commodity: 'CPO', tb: '2026-06-04T00:00:00Z' }),
      ],
      { purposeFilter: 'Loading' }
    )
    assert.equal(agg.incoming.length, 0)
    assert.equal(agg.outgoing.length, 1)
  })

  it('sorts by shipments then throughput', () => {
    const agg = aggregateByProduct([
      row({ commodity: 'A', qty: 100, vessel: 'V1', tb: '2026-06-01T00:00:00Z' }),
      row({ commodity: 'B', qty: 5000, vessel: 'V2', tb: '2026-06-02T00:00:00Z' }),
      row({ commodity: 'C', qty: 100, vessel: 'V3', tb: '2026-06-03T00:00:00Z' }),
      row({ commodity: 'C', qty: 100, vessel: 'V4', tb: '2026-06-04T00:00:00Z' }),
    ])
    assert.deepEqual(
      agg.outgoing.map((r) => r.label),
      ['C', 'B', 'A']
    )
  })
})

describe('voyagesForProduct', () => {
  it('filters by normalized product key and purpose', () => {
    const rows = [
      row({ vessel: 'L1', commodity: 'cpo', purpose: 'Unloading' }),
      row({ vessel: 'L2', commodity: 'FAME' }),
    ]
    const u = voyagesForProduct(rows, 'CPO', 'Unloading')
    assert.equal(u.length, 1)
    assert.equal(u[0].vessel, 'L1')
  })

  it('includes multi-commodity voyage when either product matches', () => {
    const rows = [
      row({
        vessel: 'Mix',
        purpose: 'Unloading',
        commodity: 'CPO · CPKO',
        totalQtyDisplay: 'CPO 1 MT\nCPKO 1 MT',
      }),
    ]
    assert.equal(voyagesForProduct(rows, 'CPKO', 'Unloading').length, 1)
    assert.equal(voyagesForProduct(rows, 'CPO', 'Unloading').length, 1)
    assert.equal(voyagesForProduct(rows, 'FAME', 'Unloading').length, 0)
  })
})
