import test from 'node:test'
import assert from 'node:assert/strict'
import {
  cardsToSaveBody,
  carryVisitOntoSingleCard,
  collapsedAttention,
  commodityDecisionsFromRow,
  decisionSummaryText,
  seedCommodityCards,
} from './samplingCommodity.js'
import { buildSamplingPayload } from './qcSampling.js'

test('a visit with no sampling row still gets one card per commodity', () => {
  const cards = seedCommodityCards([], [{ commodityId: '4', shortName: 'CPO', name: 'Crude palm oil' }])
  assert.equal(cards.length, 1)
  assert.equal(cards[0].commodityId, 4)
  assert.equal(cards[0].decision, null)
  assert.equal(cards[0].remark, '')
  assert.deepEqual(seedCommodityCards([{ commodityId: 4, decision: 'hold' }], [{ commodityId: 9 }]), [
    { commodityId: 4, decision: 'hold' },
  ])
})

test('a single card keeps its own figure and fills only the blank ones from the visit', () => {
  const [card] = carryVisitOntoSingleCard(
    [{ commodityId: 3, shortName: 'CPO', ffaAverage: '', records: [{ id: 'p1', noPalka: '2' }], documents: [] }],
    { ffaAverage: '4.90', moistureAverage: '0.27', records: [{ id: 'old' }], documents: [{ id: 8 }] }
  )
  assert.equal(card.ffaAverage, '4.90')
  assert.equal(card.moistureAverage, '0.27')
  assert.equal(card.records[0].id, 'p1')
  assert.equal(card.documents[0].id, 8)
})

test('one commodity keeps the visit quality until its own card is saved', () => {
  const [card] = carryVisitOntoSingleCard(seedCommodityCards([], [{ commodityId: 21, shortName: 'ROL' }]), {
    ffaAverage: '3.1',
    records: [{ id: 'p1', noPalka: '1' }],
    documents: [{ id: 9, name: 'report.pdf' }],
  })
  assert.equal(card.shortName, 'ROL')
  assert.equal(card.ffaAverage, '3.1')
  assert.equal(card.records[0].noPalka, '1')
  assert.equal(card.documents[0].id, 9)
  const two = carryVisitOntoSingleCard(
    [{ commodityId: 1, records: [] }, { commodityId: 2, records: [] }],
    { ffaAverage: '3.1', records: [{ id: 'p1' }] }
  )
  assert.equal(two[0].ffaAverage, undefined)
  assert.equal(two[0].records.length, 0)
})

test('cards keep an empty remark and do not invent a spec for Hold', () => {
  const body = cardsToSaveBody([{ commodityId: 4, decision: 'hold', remark: '', records: [] }])
  assert.equal(body[0].decision, 'hold')
  assert.equal(body[0].remark, '')
})

test('a sampling save with cards does not send the shared palka list', () => {
  const out = buildSamplingPayload(
    {
      startTime: '2026-11-04T08:00',
      records: [{ id: 'old', noPalka: '1' }],
      commodities: [
        { commodityId: 4, decision: 'approve_out', remark: '', records: [{ id: 'a', noPalka: '2' }] },
      ],
    },
    'draft'
  )
  assert.equal('payload' in out, false)
  assert.equal(out.commodities[0].records[0].noPalka, '2')
  assert.equal(out.commodities[0].decision, 'approve_out')
})

test('omitting cards keeps the shared payload', () => {
  const out = buildSamplingPayload({ records: [{ id: 'a' }] }, 'final', { includeRecords: true })
  assert.equal('commodities' in out, false)
  assert.equal(out.payload.records.length, 1)
})

test('a checklist tooltip lists each decided commodity', () => {
  const text = decisionSummaryText(
    [
      { shortName: 'ROL', decision: 'approve_in' },
      { shortName: 'PKO', decision: null },
      { shortName: 'CPO', decision: 'hold' },
    ],
    (code) => code
  )
  assert.equal(text, 'ROL approve_in, CPO hold')
})

test('a collapsed multi-instruction vessel flags Reject ahead of Out Spec', () => {
  assert.equal(collapsedAttention([{ decision: 'approve_in' }, { decision: 'approve_out' }]), 'out')
  assert.equal(collapsedAttention([{ decision: 'approve_out' }, { decision: 'reject_in' }]), 'reject')
  assert.equal(collapsedAttention([{ decision: null }]), null)
})

test('at-berth lines keep the remark for the matching commodity only', () => {
  const lines = commodityDecisionsFromRow({
    cargoBreakdownSummary: [{ products: [{ commodityId: 1, shortName: 'CPO' }, { commodityId: 2, shortName: 'PKO' }] }],
    qcDecisions: [{ commodityId: 2, decision: 'hold', remark: 'wait' }],
  })
  assert.deepEqual(lines, [{ commodityId: 2, shortName: 'PKO', name: undefined, decision: 'hold', remark: 'wait' }])
})
