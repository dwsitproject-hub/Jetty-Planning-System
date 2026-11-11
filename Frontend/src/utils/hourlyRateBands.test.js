import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  bandPieGradient,
  commodityFilterOptions,
  fastShare,
  filterVoyagesByCommodity,
  lineScaleMax,
  noFlowShare,
  profileTotalHours,
} from './hourlyRateBands.js'

const profile = { bands: { gt100: 4, '75_100': 2, '50_75': 1, '25_50': 1, '0_25': 0, zero: 2 } }

const voyage = (id, products) => ({
  id,
  cargoBreakdownSummary: [{ products: products.map((p) => ({ commodityGroup: p, qty: 100 })) }],
})

describe('hourly rate band shares', () => {
  it('totals band hours and computes fast / no-flow shares', () => {
    assert.equal(profileTotalHours(profile), 10)
    assert.equal(fastShare(profile), 0.6)
    assert.equal(noFlowShare(profile), 0.2)
  })

  it('returns null shares without hourly data', () => {
    assert.equal(fastShare(null), null)
    assert.equal(noFlowShare({ bands: {} }), null)
    assert.equal(bandPieGradient(null), 'none')
  })

  it('builds a pie gradient that ends at 100%', () => {
    assert.match(bandPieGradient(profile), /100\.00%\)$/)
  })
})

describe('lineScaleMax', () => {
  it('rounds the 95th percentile up to 50 with a floor of 100', () => {
    assert.equal(lineScaleMax([]), 100)
    const rows = [{ hourlyProfile: { series: [{ r: 40 }, { r: 210 }, { r: 0 }, { r: null }] } }]
    assert.equal(lineScaleMax(rows), 250)
  })
})

describe('commodity filter', () => {
  const rows = [voyage(1, ['CPO']), voyage(2, ['CPO', 'POME']), voyage(3, ['FAME'])]

  it('counts each voyage once per commodity, most voyages first', () => {
    assert.deepEqual(commodityFilterOptions(rows), [
      { label: 'CPO', count: 2 },
      { label: 'FAME', count: 1 },
      { label: 'POME', count: 1 },
    ])
  })

  it('keeps multi-commodity voyages when any product matches', () => {
    assert.deepEqual(filterVoyagesByCommodity(rows, new Set(['POME'])).map((r) => r.id), [2])
    assert.equal(filterVoyagesByCommodity(rows, new Set()).length, 3)
  })
})
