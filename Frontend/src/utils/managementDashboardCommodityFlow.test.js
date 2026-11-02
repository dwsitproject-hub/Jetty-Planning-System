import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { computeFlow } from './managementDashboardFlow.js'
import { computeCommodityFlow } from './managementDashboardCommodityFlow.js'

function row(overrides) {
  return {
    vessel: 'V1',
    tb: '2026-06-01T00:00:00Z',
    status: 'SAILED',
    castOff: '2026-06-02T00:00:00Z',
    purpose: 'Loading',
    qty: 1000,
    wait: 10,
    berth: 20,
    commodity: 'FAME',
    voyageRateMtH: 50,
    productRatesByKey: { FAME: { rateMtH: 50, movedQty: 1000, loggedHours: 20 } },
    ...overrides,
  }
}

function round1(n) {
  return Math.round(n * 10) / 10
}

describe('computeCommodityFlow', () => {
  it('counts each commodity on a call, repeating shared berth and wait', () => {
    const flow = computeCommodityFlow([
      row({
        vessel: 'LoadMix',
        wait: 4,
        berth: 10,
        qty: 5000,
        voyageRateMtH: 999,
        commodity: 'CPO · CPKO',
        totalQtyDisplay: 'CPO 800 MT\nCPKO 200 MT',
        productRatesByKey: {
          CPO: { rateMtH: 100, movedQty: 700, loggedHours: 7 },
          CPKO: { rateMtH: 50, movedQty: 150, loggedHours: 3 },
        },
      }),
      row({
        vessel: 'UnloadCpo',
        purpose: 'Unloading',
        wait: 12,
        berth: 20,
        qty: 600,
        commodity: 'CPO',
        voyageRateMtH: 1,
        productRatesByKey: { CPO: { rateMtH: 80, movedQty: 500, loggedHours: 6.25 } },
        tb: '2026-06-03T00:00:00Z',
      }),
    ])

    assert.equal(flow.shipments, 3)
    assert.equal(flow.slices.length, 3)
    assert.equal(flow.throughput, 1350)
    assert.equal(flow.berth, 10)
    assert.equal(round1(flow.wait), 6.7)
    assert.equal(round1(flow.rate), 76.7)

    assert.equal(flow.loading.shipments, 2)
    assert.equal(flow.loading.throughput, 850)
    assert.equal(flow.loading.berth, 10)
    assert.equal(flow.loading.wait, 4)
    assert.equal(flow.loading.rate, 75)

    assert.equal(flow.unloading.shipments, 1)
    assert.equal(flow.unloading.throughput, 500)
    assert.equal(flow.unloading.berth, 20)
    assert.equal(flow.unloading.wait, 12)
    assert.equal(flow.unloading.rate, 80)
  })

  it('uses moved tons for throughput and keeps voyage clocks for berth and wait', () => {
    const rows = [row({ qty: 5000, productRatesByKey: { FAME: { rateMtH: 50, movedQty: 1000, loggedHours: 20 } } })]
    const vessel = computeFlow(rows)
    const commodity = computeCommodityFlow(rows)
    assert.equal(vessel.throughput, 5000)
    assert.equal(commodity.shipments, vessel.voyages)
    assert.equal(commodity.throughput, 1000)
    assert.equal(commodity.loading.throughput, 1000)
    assert.equal(commodity.berth, vessel.berth)
    assert.equal(commodity.wait, vessel.wait)
    assert.equal(commodity.rate, vessel.rate)
    assert.equal(commodity.unloading.shipments, 0)
  })

  it('omits a missing product rate from the average and still counts the shipment', () => {
    const flow = computeCommodityFlow([
      row({
        vessel: 'Rated',
        qty: 100,
        wait: 2,
        berth: 4,
        commodity: 'CPO',
        voyageRateMtH: 999,
        productRatesByKey: { CPO: { rateMtH: 100, movedQty: 80, loggedHours: 0.8 } },
      }),
      row({
        vessel: 'Unrated',
        qty: 50,
        wait: 8,
        berth: 12,
        commodity: 'FAME',
        voyageRateMtH: 999,
        productRatesByKey: {},
        tb: '2026-06-04T00:00:00Z',
      }),
    ])
    assert.equal(flow.shipments, 2)
    assert.equal(flow.throughput, 80)
    assert.equal(flow.berth, 8)
    assert.equal(flow.wait, 5)
    assert.equal(flow.rate, 100)
  })

  it('skips calls that are neither loading nor unloading', () => {
    const flow = computeCommodityFlow([
      row({ purpose: 'Shifting', qty: 400, vessel: 'Shift' }),
    ])
    assert.equal(flow.shipments, 0)
    assert.equal(flow.throughput, 0)
    assert.equal(flow.berth, null)
    assert.equal(flow.wait, null)
    assert.equal(flow.rate, null)
    assert.equal(flow.slices.length, 0)
    assert.equal(flow.loading.shipments, 0)
    assert.equal(flow.unloading.shipments, 0)
  })
})
