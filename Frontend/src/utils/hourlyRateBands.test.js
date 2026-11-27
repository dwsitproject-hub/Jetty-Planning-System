import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  bandColor,
  bandPieGradient,
  commodityFilterOptions,
  fastShare,
  filterVoyagesByCommodity,
  lineScaleMax,
  noFlowShare,
  profileTotalHours,
  rateBandKey,
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

describe('rateBandKey', () => {
  it('puts a rate in the band the backend would, upper bound inclusive', () => {
    assert.equal(rateBandKey(100.1), 'gt100')
    assert.equal(rateBandKey(100), '75_100')
    assert.equal(rateBandKey(75), '50_75')
    assert.equal(rateBandKey(50.5), '50_75')
    assert.equal(rateBandKey(25.1), '25_50')
    assert.equal(rateBandKey(10), '0_25')
  })

  it('treats zero as no flow and a missing rate as excluded', () => {
    assert.equal(rateBandKey(0), 'zero')
    assert.equal(rateBandKey(null), null)
  })

  it('gives every band its own colour, and unknown keys the no-flow grey', () => {
    assert.equal(new Set(['gt100', '75_100', '50_75', '25_50', '0_25', 'zero'].map(bandColor)).size, 6)
    assert.equal(bandColor('nope'), bandColor('zero'))
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
