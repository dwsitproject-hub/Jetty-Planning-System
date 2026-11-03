import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { cargoMovementEntriesForSlice } from './cargoMovementEntries.js'

const events = [
  {
    milestoneKey: 'nor',
    cargoLoadLines: [{ id: 'x', commodityShortName: 'CPO', qty: 1, startedAt: '2026-06-01T00:00:00Z', endedAt: '2026-06-01T01:00:00Z' }],
  },
  {
    milestoneKey: 'cargo_operations',
    cargoLoadLines: [
      {
        id: 'late',
        commodityShortName: 'CPO',
        qty: 200,
        startedAt: '2026-06-02T12:00:00Z',
        endedAt: '2026-06-02T16:00:00Z',
        tanks: [{ code: '5201' }],
      },
      {
        id: 'early',
        commodityShortName: 'cpo',
        qty: 100,
        startedAt: '2026-06-02T00:00:00Z',
        endedAt: '2026-06-02T10:00:00Z',
        tanks: [{ code: '3502' }],
      },
      {
        id: 'other',
        commodityShortName: 'CPKO',
        qty: 40,
        startedAt: '2026-06-02T01:00:00Z',
        endedAt: '2026-06-02T05:00:00Z',
        tanks: [{ code: '3503' }],
      },
      {
        id: 'open',
        commodityShortName: 'CPO',
        qty: 15,
        startedAt: '2026-06-02T18:00:00Z',
        tanks: [{ code: '3504' }],
      },
      {
        id: 'untagged',
        qty: 9,
        startedAt: '2026-06-02T02:00:00Z',
        endedAt: '2026-06-02T03:00:00Z',
      },
    ],
  },
]

describe('cargoMovementEntriesForSlice', () => {
  it('keeps only the matching commodity on a multi-commodity call, in start order', () => {
    const entries = cargoMovementEntriesForSlice(events, {
      productKey: 'CPO',
      commodity: 'CPO · CPKO',
    })
    assert.deepEqual(entries.map((e) => e.key), ['early', 'late', 'open'])
    assert.equal(entries[0].tank, '3502')
    assert.equal(entries[0].qty, 100)
    assert.equal(entries[0].rate, 10)
    assert.equal(entries[2].inProgress, true)
    assert.equal(entries[2].rate, null)
    assert.equal(entries[2].entry, 3)
  })

  it('matches load lines by commodity group on a single-group call', () => {
    const groupedEvents = [
      {
        milestoneKey: 'cargo_operations',
        cargoLoadLines: [
          { id: 'low', commodityShortName: 'CPO-LOW', commodityGroup: 'CPO', qty: 10, startedAt: '2026-06-02T00:00:00Z', endedAt: '2026-06-02T01:00:00Z' },
          { id: 'high', commodityShortName: 'CPO-HIGH', commodityGroup: 'CPO', qty: 20, startedAt: '2026-06-02T02:00:00Z', endedAt: '2026-06-02T04:00:00Z' },
          { id: 'other', commodityShortName: 'PKO', commodityGroup: 'PKO', qty: 5, startedAt: '2026-06-02T01:00:00Z', endedAt: '2026-06-02T02:00:00Z' },
          { id: 'untagged', qty: 9, startedAt: '2026-06-02T03:00:00Z', endedAt: '2026-06-02T04:00:00Z' },
        ],
      },
    ]
    const entries = cargoMovementEntriesForSlice(groupedEvents, {
      productKey: 'CPO',
      commodity: 'CPO-LOW · CPO-HIGH',
      cargoBreakdownSummary: [{
        products: [
          { shortName: 'CPO-LOW', commodityGroup: 'CPO', qty: 10 },
          { shortName: 'CPO-HIGH', commodityGroup: 'CPO', qty: 20 },
        ],
      }],
    })
    assert.deepEqual(entries.map((e) => e.key), ['low', 'high', 'untagged'])
  })

  it('includes an untagged line when the call has one commodity', () => {
    const entries = cargoMovementEntriesForSlice(events, {
      productKey: 'FAME',
      commodity: 'FAME',
    })
    assert.deepEqual(entries.map((e) => e.key), ['untagged'])
    assert.equal(entries[0].qty, 9)
    assert.equal(entries[0].rate, 9)
  })
})
