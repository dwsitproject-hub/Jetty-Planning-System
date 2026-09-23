import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { computeFlow, mean, median, voyageFlowRate } from './managementDashboardFlow.js'

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
    opsH: 10,
    ...overrides,
  }
}

describe('mean / median', () => {
  it('computes mean wait and median berth independently', () => {
    assert.equal(mean([2, 4, 12]), 6)
    assert.equal(median([2, 4, 12]), 4)
  })
})

describe('voyageFlowRate', () => {
  it('is qty ÷ cargo-ops hours', () => {
    assert.equal(voyageFlowRate({ qty: 500, opsH: 10 }), 50)
    assert.equal(voyageFlowRate({ qty: 500, opsH: 0 }), null)
  })
})

describe('computeFlow', () => {
  it('splits Loading vs Unloading and uses average wait', () => {
    const flow = computeFlow([
      row({ vessel: 'L1', wait: 4, berth: 10, qty: 800, opsH: 8 }),
      row({ vessel: 'L2', wait: 8, berth: 30, qty: 200, opsH: 4 }),
      row({
        vessel: 'U1',
        purpose: 'Unloading',
        wait: 12,
        berth: 20,
        qty: 600,
        opsH: 6,
        tb: '2026-06-03T00:00:00Z',
      }),
    ])
    assert.equal(flow.throughput, 1600)
    assert.equal(flow.loading.throughput, 1000)
    assert.equal(flow.unloading.throughput, 600)
    assert.equal(flow.wait, 8)
    assert.equal(flow.loading.wait, 6)
    assert.equal(flow.unloading.wait, 12)
    assert.equal(flow.berth, 20)
    assert.equal(Math.round(flow.rate * 10) / 10, 83.3)
    assert.equal(flow.loading.rate, 75)
    assert.equal(flow.unloading.rate, 100)
  })
})
