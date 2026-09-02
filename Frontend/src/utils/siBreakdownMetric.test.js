import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  applyCommodityDefaultMetric,
  getCommodityDefaultMetric,
  metricsForBreakdownRow,
  validateBreakdownMetricRules,
} from './siBreakdownMetric.js'

const lookups = {
  metrics: [
    { id: 1, code: 'KL', label: 'Kilo litre' },
    { id: 2, code: 'MT', label: 'Metric ton' },
  ],
  commodities: [
    {
      id: 4,
      name: 'FATTY ACID METHYL ESTER',
      shortName: 'FAME',
      defaultMetricId: 1,
      defaultMetricCode: 'KL',
    },
    { id: 5, name: 'CPO', shortName: 'CPO', defaultMetricId: null },
  ],
}

describe('siBreakdownMetric', () => {
  it('returns default metric for configured commodity', () => {
    const m = getCommodityDefaultMetric(lookups.commodities[0], lookups)
    assert.equal(m?.code, 'KL')
  })

  it('auto-applies default metric when commodity changes', () => {
    const next = applyCommodityDefaultMetric({ commodityId: '', metricId: '2', qty: '' }, 4, lookups)
    assert.equal(next.metricId, '1')
  })

  it('blocks wrong unit when default configured', () => {
    const err = validateBreakdownMetricRules([{ commodityId: '4', metricId: '2', qty: 100 }], lookups)
    assert.ok(err?.includes('KL'))
  })

  it('allows MT when commodity has no default', () => {
    const err = validateBreakdownMetricRules([{ commodityId: '5', metricId: '2', qty: 100 }], lookups)
    assert.equal(err, null)
  })

  it('restricts metric dropdown when default configured', () => {
    const metrics = metricsForBreakdownRow(4, lookups)
    assert.equal(metrics.length, 1)
    assert.equal(metrics[0].code, 'KL')
  })

  it('shows all metrics when no default configured', () => {
    const metrics = metricsForBreakdownRow(5, lookups)
    assert.equal(metrics.length, 2)
  })
})
