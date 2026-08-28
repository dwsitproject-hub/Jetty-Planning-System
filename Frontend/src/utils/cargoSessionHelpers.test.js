import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildLiveCargoProgressSnapshot,
  partitionDraftTanks,
  resolveCargoProgressTotalLoaded,
  resolveDefaultCargoOperationWindowStart,
  resolveOpenLineLiveQty,
  sumClosedPersistedLineQty,
} from './cargoProgressResolvers.js'

describe('cargoProgressResolvers', () => {
  it('resolveDefaultCargoOperationWindowStart prefers TB then prior milestones then now', () => {
    const toLocal = (iso) => (iso === '2026-08-27T09:30:00.000Z' ? '2026-08-27T16:30' : '')
    assert.equal(
      resolveDefaultCargoOperationWindowStart({
        tbIso: '2026-08-27T09:30:00.000Z',
        priorMilestoneStarts: ['2026-08-27T08:00'],
        getNowLocal: () => '2026-08-28T10:00',
        toLocal,
      }),
      '2026-08-27T16:30'
    )

    assert.equal(
      resolveDefaultCargoOperationWindowStart({
        tbIso: null,
        priorMilestoneStarts: ['2026-08-27T08:00', '2026-08-27T07:00'],
        getNowLocal: () => '2026-08-28T10:00',
        toLocal: (v) => v,
      }),
      '2026-08-27T07:00'
    )

    assert.equal(
      resolveDefaultCargoOperationWindowStart({
        tbIso: null,
        priorMilestoneStarts: [],
        getNowLocal: () => '2026-08-28T10:00',
        toLocal: (v) => v,
      }),
      '2026-08-28T10:00'
    )
  })

  it('sumClosedPersistedLineQty sums only closed lines with qty', () => {
    const rows = [
      {
        cargoLoadLines: [
          { endAt: '2026-01-01T12:00:00Z', qty: 100 },
          { startAt: '2026-01-01T12:00:00Z', endAt: null, qty: null },
        ],
      },
    ]
    assert.equal(sumClosedPersistedLineQty(rows), 100)
  })

  it('resolveOpenLineLiveQty uses API moved minus closed persisted', () => {
    const meta = new Map([['1', { hasAtg: true }]])
    const qty = resolveOpenLineLiveQty({
      openLineDraft: { tankIds: ['1'], atgQtyMode: 'auto' },
      atgRef: null,
      sessionOperationalProgress: { movedQty: 850 },
      tankMetaById: meta,
      closedPersistedSum: 100,
    })
    assert.equal(qty, 750)
  })

  it('resolveOpenLineLiveQty falls back to manual draft qty', () => {
    const meta = new Map([['2', { hasAtg: false }]])
    const qty = resolveOpenLineLiveQty({
      openLineDraft: { tankIds: ['2'], manualQty: '420', atgQtyMode: 'manual' },
      atgRef: null,
      sessionOperationalProgress: null,
      tankMetaById: meta,
      closedPersistedSum: 0,
    })
    assert.equal(qty, 420)
  })

  it('resolveCargoProgressTotalLoaded uses operation API total when session in progress', () => {
    const meta = new Map([['1', { hasAtg: true }]])
    const total = resolveCargoProgressTotalLoaded({
      loadedOther: 0,
      cargoLoadLinesDraft: [{ start: 'a', end: '', qty: '', tankIds: ['1'] }],
      sessionOperationalProgress: { movedQty: 763 },
      openLineDraft: { start: 'a', end: '', tankIds: ['1'] },
      atgRef: null,
      tankMetaById: meta,
      useCargoSessionMode: true,
      cargoSessionPhase: 'in_progress',
      commodityType: 'Liquid',
      closedPersistedSum: 0,
    })
    assert.equal(total, 763)
  })

  it('resolveCargoProgressTotalLoaded sums solid draft lines', () => {
    const total = resolveCargoProgressTotalLoaded({
      loadedOther: 0,
      cargoLoadLinesDraft: [
        { start: 'a', end: 'b', qty: '100' },
        { start: 'c', end: '', qty: '50' },
      ],
      sessionOperationalProgress: null,
      openLineDraft: null,
      atgRef: null,
      tankMetaById: new Map(),
      useCargoSessionMode: false,
      cargoSessionPhase: null,
      commodityType: 'Solid',
      closedPersistedSum: 0,
    })
    assert.equal(total, 150)
  })

  it('buildLiveCargoProgressSnapshot returns null when no open line', () => {
    assert.equal(buildLiveCargoProgressSnapshot({ openLoadLineId: null }), null)
  })

  it('partitionDraftTanks splits ATG vs manual', () => {
    const meta = new Map([
      ['1', { hasAtg: true }],
      ['2', { hasAtg: false }],
    ])
    assert.deepEqual(partitionDraftTanks(['1', '2'], meta), {
      atgTankIds: ['1'],
      manualTankIds: ['2'],
    })
  })
})
