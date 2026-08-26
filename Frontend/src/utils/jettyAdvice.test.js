import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  jettyShortName,
  computeJettyAdvice,
  computeAllocationJettyAdvice,
  validateJettyAdviceSelection,
  combinedSpanLengthM,
} from './jettyAdvice.js'

const jetties = [
  {
    id: 1,
    name: 'Jetty 2A',
    jettyLengthM: 155,
    jettyDwt: 15000,
    unloadingCommodityIds: [10],
    loadingCommodityIds: [],
    adjacentJettyIds: [],
  },
  {
    id: 2,
    name: 'Jetty 5',
    jettyLengthM: 180,
    jettyDwt: 30000,
    unloadingCommodityIds: [],
    loadingCommodityIds: [],
    adjacentJettyIds: [],
  },
]

const multiJettyJetties = [
  {
    id: 10,
    name: 'Jetty 2B',
    jettyLengthM: 155,
    jettyDwt: 10000,
    unloadingCommodityIds: [10],
    loadingCommodityIds: [],
    adjacentJettyIds: [11, 12],
  },
  {
    id: 11,
    name: 'Jetty 3B',
    jettyLengthM: 155,
    jettyDwt: 10000,
    unloadingCommodityIds: [10],
    loadingCommodityIds: [],
    adjacentJettyIds: [10],
  },
  {
    id: 12,
    name: 'Jetty 1B',
    jettyLengthM: 120,
    jettyDwt: 10000,
    unloadingCommodityIds: [10],
    loadingCommodityIds: [],
    adjacentJettyIds: [10],
  },
]

describe('jettyShortName', () => {
  it('strips Jetty prefix', () => {
    assert.equal(jettyShortName('Jetty 2B'), '2B')
    assert.equal(jettyShortName('2B'), '2B')
  })
})

describe('combinedSpanLengthM', () => {
  it('sums primary and additional jetty lengths', () => {
    const primary = multiJettyJetties[0]
    assert.equal(combinedSpanLengthM(multiJettyJetties, primary, ['3B']), 310)
  })
})

describe('computeJettyAdvice', () => {
  it('suggests jetties that fit LOA/DWT/commodity and are free at ETA', () => {
    const etaMs = new Date('2026-07-15T10:00:00').getTime()
    const advice = computeJettyAdvice({
      jetties,
      loa: 150,
      dwt: 9000,
      purposeCode: 'Unloading',
      commodityIds: [10],
      referenceTimeMs: etaMs,
      occupancyRows: [],
    })
    assert.equal(advice.adviceReady, true)
    assert.equal(advice.suggested.length, 2)
    assert.equal(advice.byShortId['2A'].fits, true)
    assert.equal(advice.byShortId['5'].fits, true)
  })

  it('excludes jetties when LOA exceeds length', () => {
    const etaMs = new Date('2026-07-15T10:00:00').getTime()
    const advice = computeJettyAdvice({
      jetties,
      loa: 170,
      dwt: 9000,
      purposeCode: 'Unloading',
      commodityIds: [10],
      referenceTimeMs: etaMs,
      occupancyRows: [],
    })
    assert.equal(advice.byShortId['2A'].fits, false)
    assert.equal(advice.byShortId['5'].fits, true)
    assert.equal(advice.suggested.length, 1)
    assert.equal(jettyShortName(advice.suggested[0].name), '5')
  })

  it('marks jetty occupied when another row overlaps ETA window', () => {
    const etaMs = new Date('2026-07-15T12:00:00').getTime()
    const advice = computeJettyAdvice({
      jetties,
      loa: 150,
      dwt: 9000,
      purposeCode: 'Unloading',
      commodityIds: [10],
      referenceTimeMs: etaMs,
      occupancyRows: [
        {
          vesselId: 'other',
          jetty: '2A',
          etaDateTime: '2026-07-15T08:00',
          estimatedCompletionDateTime: '2026-07-15T18:00',
        },
      ],
      occupancyOptions: { jettyKey: 'shortName' },
    })
    assert.equal(advice.byShortId['2A'].occupied, true)
    assert.equal(advice.suggested.some((j) => jettyShortName(j.name) === '2A'), false)
  })

  it('allows multi-jetty span when LOA exceeds primary but fits with adjacent', () => {
    const etaMs = new Date('2026-07-31T09:06:00').getTime()
    const advice = computeJettyAdvice({
      jetties: multiJettyJetties,
      loa: 220,
      dwt: 4500,
      purposeCode: 'Unloading',
      commodityIds: [10],
      referenceTimeMs: etaMs,
      occupancyRows: [],
      allowMultiJetty: true,
    })
    const twoB = advice.byShortId['2B']
    assert.equal(twoB.loaOkSingle, false)
    assert.equal(twoB.loaOkMulti, true)
    assert.equal(twoB.fits, true)
    assert.ok(twoB.spanAdjacentShortIds.includes('3B'))
    assert.ok(advice.suggested.some((j) => jettyShortName(j.name) === '2B'))
  })

  it('does not suggest multi-jetty primary when all spanning adjacents are occupied', () => {
    const etaMs = new Date('2026-07-31T09:06:00').getTime()
    const advice = computeJettyAdvice({
      jetties: multiJettyJetties,
      loa: 220,
      dwt: 4500,
      purposeCode: 'Unloading',
      commodityIds: [10],
      referenceTimeMs: etaMs,
      occupancyRows: [
        {
          vesselId: 'other-3b',
          jetty: '3B',
          etaDateTime: '2026-07-30T08:00',
          estimatedCompletionDateTime: '2026-08-05T18:00',
        },
        {
          vesselId: 'other-1b',
          jetty: '1B',
          etaDateTime: '2026-07-30T08:00',
          estimatedCompletionDateTime: '2026-08-05T18:00',
        },
      ],
      occupancyOptions: { jettyKey: 'shortName' },
      allowMultiJetty: true,
    })
    assert.equal(advice.byShortId['2B'].loaOkMulti, false)
    assert.equal(advice.suggested.some((j) => jettyShortName(j.name) === '2B'), false)
  })
})

describe('computeAllocationJettyAdvice', () => {
  it('uses allocation row fields and short-name occupancy', () => {
    const row = {
      vesselId: 'v1',
      vesselLoaM: 150,
      vesselDwt: 9000,
      purpose: 'Unloading',
      commodityIds: [10],
      etaDateTime: '2026-07-15T10:00',
    }
    const advice = computeAllocationJettyAdvice({
      jetties,
      row,
      referenceDateTime: row.etaDateTime,
      occupancyRows: [],
    })
    assert.equal(advice.adviceReady, true)
    assert.ok(advice.suggested.length >= 1)
  })
})

describe('validateJettyAdviceSelection', () => {
  const t = (key, opts) => {
    if (key === 'jettyReasonLoa') return `LOA ${opts.loa} exceeds ${opts.len}`
    if (key === 'formJettyUnsuitable') return `${opts.jetty}: ${opts.reason}`
    if (key === 'formJettySpanRequired') return `${opts.jetty}: span ${opts.adjacent}`
    return key
  }

  it('blocks unsuitable short-name selection', () => {
    const etaMs = new Date('2026-07-15T10:00:00').getTime()
    const jettyAdvice = computeJettyAdvice({
      jetties,
      loa: 170,
      dwt: 9000,
      purposeCode: 'Unloading',
      commodityIds: [10],
      referenceTimeMs: etaMs,
      occupancyRows: [],
    })
    const result = validateJettyAdviceSelection({
      jettyAdvice,
      selectedJettyShortId: '2A',
      jetties,
      ctx: { loa: 170, dwt: 9000 },
      t,
    })
    assert.equal(result.ok, false)
    assert.match(result.message, /2A/)
  })

  it('requires adjacent selection when multi-jetty span is needed', () => {
    const etaMs = new Date('2026-07-31T09:06:00').getTime()
    const jettyAdvice = computeJettyAdvice({
      jetties: multiJettyJetties,
      loa: 220,
      dwt: 4500,
      purposeCode: 'Unloading',
      commodityIds: [10],
      referenceTimeMs: etaMs,
      occupancyRows: [],
      allowMultiJetty: true,
    })
    const blocked = validateJettyAdviceSelection({
      jettyAdvice,
      selectedJettyShortId: '2B',
      jetties: multiJettyJetties,
      ctx: { loa: 220, dwt: 4500 },
      t,
      allowMultiJetty: true,
      additionalJetties: [],
    })
    assert.equal(blocked.ok, false)
    assert.match(blocked.message, /3B/)

    const ok = validateJettyAdviceSelection({
      jettyAdvice,
      selectedJettyShortId: '2B',
      jetties: multiJettyJetties,
      ctx: { loa: 220, dwt: 4500 },
      t,
      allowMultiJetty: true,
      additionalJetties: ['3B'],
    })
    assert.equal(ok.ok, true)
  })
})
