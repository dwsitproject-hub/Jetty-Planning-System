import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeLoadLineCommodityId } from './si-commodity-options.js'

describe('normalizeLoadLineCommodityId', () => {
  const multi = [{ commodityId: 1 }, { commodityId: 18 }]

  it('auto-fills when single option', () => {
    const r = normalizeLoadLineCommodityId(null, [{ commodityId: 5 }], { lineIndex: 0 })
    assert.equal(r.commodityId, 5)
    assert.equal(r.error, undefined)
  })

  it('requires id when multi', () => {
    const r = normalizeLoadLineCommodityId(null, multi, { lineIndex: 2 })
    assert.ok(r.error)
    assert.match(r.error.error, /commodityId is required/)
  })

  it('accepts valid multi id', () => {
    const r = normalizeLoadLineCommodityId('18', multi, { lineIndex: 0 })
    assert.equal(r.commodityId, 18)
  })
})
