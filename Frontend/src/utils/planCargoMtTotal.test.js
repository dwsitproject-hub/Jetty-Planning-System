import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  sumBreakdownMtTotal,
  breakdownHasUnconvertedKl,
  getKlToMtFactorForRow,
} from './planCargoMtTotal.js'

const lookups = {
  metrics: [
    { id: 1, code: 'KL' },
    { id: 2, code: 'MT' },
  ],
  commodities: [
    { id: 10, name: 'FAME', klToMtFactor: 0.8743 },
    { id: 11, name: 'CPO', klToMtFactor: 1 },
    { id: 12, name: 'NoFactor', klToMtFactor: null },
  ],
}

function row({ commodityId, metricId, qty }) {
  return { commodityId: String(commodityId), metricId: String(metricId), qty }
}

describe('getKlToMtFactorForRow', () => {
  it('returns commodity factor when configured', () => {
    assert.equal(getKlToMtFactorForRow(row({ commodityId: 10, metricId: 1, qty: 100 }), lookups), 0.8743)
    assert.equal(getKlToMtFactorForRow(row({ commodityId: 11, metricId: 1, qty: 100 }), lookups), 1)
  })

  it('returns null when commodity has no factor', () => {
    assert.equal(getKlToMtFactorForRow(row({ commodityId: 12, metricId: 1, qty: 100 }), lookups), null)
  })
})

describe('sumBreakdownMtTotal', () => {
  it('sums MT only rows', () => {
    const total = sumBreakdownMtTotal(
      [{ breakdown: [row({ commodityId: 10, metricId: 2, qty: 2800 })] }],
      lookups
    )
    assert.equal(total, 2800)
  })

  it('converts KL using per-commodity factor', () => {
    const total = sumBreakdownMtTotal(
      [{ breakdown: [row({ commodityId: 10, metricId: 1, qty: 3700 })] }],
      lookups
    )
    assert.equal(Math.round(total * 100) / 100, 3234.91)
  })

  it('uses factor 1 when commodity configured as 1', () => {
    const total = sumBreakdownMtTotal(
      [{ breakdown: [row({ commodityId: 11, metricId: 1, qty: 500 })] }],
      lookups
    )
    assert.equal(total, 500)
  })

  it('sums mixed MT and converted KL across commodities', () => {
    const total = sumBreakdownMtTotal(
      [{
        breakdown: [
          row({ commodityId: 10, metricId: 2, qty: 100 }),
          row({ commodityId: 10, metricId: 1, qty: 500 }),
          row({ commodityId: 11, metricId: 1, qty: 200 }),
        ],
      }],
      lookups
    )
    assert.equal(Math.round(total * 100) / 100, 737.15)
  })

  it('ignores KL rows without commodity factor', () => {
    const total = sumBreakdownMtTotal(
      [{ breakdown: [row({ commodityId: 12, metricId: 1, qty: 1000 })] }],
      lookups
    )
    assert.equal(total, 0)
  })

  it('returns 0 for empty breakdown', () => {
    assert.equal(sumBreakdownMtTotal([], lookups), 0)
    assert.equal(sumBreakdownMtTotal([{ breakdown: [] }], lookups), 0)
  })
})

describe('breakdownHasUnconvertedKl', () => {
  it('is true when KL qty exists without commodity factor', () => {
    assert.equal(
      breakdownHasUnconvertedKl(
        [{ breakdown: [row({ commodityId: 12, metricId: 1, qty: 100 })] }],
        lookups
      ),
      true
    )
  })

  it('is false when KL has factor or only MT rows exist', () => {
    assert.equal(
      breakdownHasUnconvertedKl(
        [{ breakdown: [row({ commodityId: 10, metricId: 1, qty: 100 })] }],
        lookups
      ),
      false
    )
    assert.equal(
      breakdownHasUnconvertedKl(
        [{ breakdown: [row({ commodityId: 10, metricId: 2, qty: 100 })] }],
        lookups
      ),
      false
    )
  })
})
