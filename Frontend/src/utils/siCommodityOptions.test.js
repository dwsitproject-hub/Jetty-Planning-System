import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  commodityDraftFromPersistedLoadLine,
  defaultCommodityIdForNewLine,
  requiresCommodityPicker,
  singleCommodityBannerText,
} from './siCommodityOptions.js'

describe('siCommodityOptions', () => {
  const multi = [
    { commodityId: '1', shortName: 'CPO', plannedQty: 100, metricCode: 'MT' },
    { commodityId: '2', shortName: 'POME', plannedQty: 50, metricCode: 'MT' },
  ]

  it('requires picker when multiple', () => {
    assert.equal(requiresCommodityPicker(multi), true)
    assert.equal(requiresCommodityPicker([multi[0]]), false)
  })

  it('defaults to previous line commodity', () => {
    assert.equal(defaultCommodityIdForNewLine(multi, '2'), '2')
  })

  it('persisted load line without commodity stays empty', () => {
    const d = commodityDraftFromPersistedLoadLine({ commodityId: null })
    assert.equal(d.commodityId, '')
    assert.equal(d.persistedCommodityId, null)
  })

  it('persisted load line with commodity preserves id', () => {
    const d = commodityDraftFromPersistedLoadLine({ commodity_id: 42 })
    assert.equal(d.commodityId, '42')
    assert.equal(d.persistedCommodityId, '42')
  })

  it('single commodity banner', () => {
    const t = singleCommodityBannerText([multi[0]])
    assert.match(t, /CPO/)
    assert.match(t, /Plan/)
  })
})
