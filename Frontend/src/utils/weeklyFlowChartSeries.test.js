import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  rankFlowCommodities,
  buildFlowChartEntries,
  flowSeriesEntries,
  pruneFlowCommoditySelection,
  flowColorIndexForEntry,
} from './weeklyFlowChartSeries.js'

const weeks = [
  {
    flowRateByCommodity: [
      { commodityId: 1, code: 'A', qtyMt: 100, mtPerHourMa: 10 },
      { commodityId: 2, code: 'B', qtyMt: 50, mtPerHourMa: 5 },
    ],
  },
  {
    flowRateByCommodity: [
      { commodityId: 1, code: 'A', qtyMt: 200, mtPerHourMa: 12 },
      { commodityId: 3, code: 'C', qtyMt: 10, mtPerHourMa: 1 },
    ],
  },
]

describe('rankFlowCommodities', () => {
  it('sums qtyMt and sorts by tonnage desc', () => {
    const ranked = rankFlowCommodities(weeks)
    assert.equal(ranked[0].commodityId, 1)
    assert.equal(ranked[0].qtyMt, 300)
    assert.equal(ranked[1].commodityId, 2)
    assert.equal(ranked[2].commodityId, 3)
  })

  it('returns empty for empty weeks', () => {
    assert.deepEqual(rankFlowCommodities([]), [])
    assert.deepEqual(rankFlowCommodities(null), [])
  })
})

describe('buildFlowChartEntries', () => {
  it('uses top 7 + Others when more than 8 products and no selection', () => {
    const ranked = Array.from({ length: 10 }, (_, i) => ({
      commodityId: i + 1,
      code: `P${i + 1}`,
      qtyMt: 100 - i,
    }))
    const entries = flowSeriesEntries(ranked, 'Others')
    assert.equal(entries.length, 8)
    assert.equal(entries[7].others, true)
    assert.equal(entries[7].restIds.length, 3)
  })

  it('default mode via buildFlowChartEntries with empty selection', () => {
    const manyWeeks = [
      {
        flowRateByCommodity: Array.from({ length: 10 }, (_, i) => ({
          commodityId: i + 1,
          code: `X${i}`,
          qtyMt: 10,
          mtPerHourMa: 1,
        })),
      },
    ]
    const entries = buildFlowChartEntries(manyWeeks, { selectedCommodityIds: [], othersLabel: 'Others' })
    assert.equal(entries.length, 8)
    assert.equal(entries[7].code, 'Others')
  })

  it('custom subset in ranked order without Others', () => {
    const entries = buildFlowChartEntries(weeks, {
      selectedCommodityIds: ['3', '1'],
      othersLabel: 'Others',
    })
    assert.equal(entries.length, 2)
    assert.equal(entries[0].commodityId, 1)
    assert.equal(entries[1].commodityId, 3)
    assert.equal(entries.every((e) => !e.others), true)
  })

  it('skips invalid selected ids', () => {
    const entries = buildFlowChartEntries(weeks, {
      selectedCommodityIds: ['999', '2'],
      othersLabel: 'Others',
    })
    assert.equal(entries.length, 1)
    assert.equal(entries[0].commodityId, 2)
  })
})

describe('pruneFlowCommoditySelection', () => {
  it('drops ids not in ranked list', () => {
    const ranked = rankFlowCommodities(weeks)
    assert.deepEqual(pruneFlowCommoditySelection(['1', '99', '3'], ranked), ['1', '3'])
  })
})

describe('flowColorIndexForEntry', () => {
  it('uses ranked index for stable colors', () => {
    const ranked = rankFlowCommodities(weeks)
    assert.equal(flowColorIndexForEntry(ranked, { commodityId: 3, others: false }), 2)
    assert.equal(flowColorIndexForEntry(ranked, { commodityId: -1, others: true }), 7)
  })
})
