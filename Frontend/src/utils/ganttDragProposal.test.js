import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  snapDeltaMs,
  jettyIdFromRowKey,
  rowSupportsActualDates,
  buildGanttDragProposal,
  buildArrivalPayloadFromProposal,
  GANTT_DRAG_SNAP_MS,
} from './ganttDragProposal.js'

const H = 60 * 60 * 1000
const ETA = new Date('2026-07-01T06:00:00Z').getTime()
const ETB = new Date('2026-07-01T10:00:00Z').getTime()
const TA = new Date('2026-07-01T07:00:00Z').getTime()
const TB = new Date('2026-07-01T11:30:00Z').getTime()
const ETC = new Date('2026-07-03T11:30:00Z').getTime()

function seg(overrides) {
  return {
    layer: 'actual',
    phase: 'ops',
    jettyId: '1A',
    etaMs: ETA,
    plannedEtbMs: ETB,
    taMs: TA,
    tbMs: TB,
    estCompMs: ETC,
    startMs: TB,
    endMs: ETC,
    ...overrides,
  }
}

const opRow = { operationId: 9, shippingInstructionId: 4, shipmentPlanId: 14 }
const planOnlyRow = { operationId: null, shippingInstructionId: null, shipmentPlanId: 14 }

describe('snapDeltaMs', () => {
  it('snaps to 30-minute steps', () => {
    assert.equal(snapDeltaMs(0), 0)
    assert.equal(snapDeltaMs(14 * 60 * 1000), 0)
    assert.equal(snapDeltaMs(16 * 60 * 1000), GANTT_DRAG_SNAP_MS)
    assert.equal(snapDeltaMs(-100 * 60 * 1000), -3 * GANTT_DRAG_SNAP_MS)
  })
})

describe('jettyIdFromRowKey', () => {
  it('parses jetty id from row keys, including ids with underscores', () => {
    assert.equal(jettyIdFromRowKey('1A__0'), '1A')
    assert.equal(jettyIdFromRowKey('JET_X__2'), 'JET_X')
    assert.equal(jettyIdFromRowKey(null), null)
  })
})

describe('rowSupportsActualDates', () => {
  it('requires an operation or shipping instruction', () => {
    assert.equal(rowSupportsActualDates(opRow), true)
    assert.equal(rowSupportsActualDates({ operationId: 3 }), true)
    assert.equal(rowSupportsActualDates(planOnlyRow), false)
    assert.equal(rowSupportsActualDates(null), false)
  })
})

describe('buildGanttDragProposal — move', () => {
  it('shifts ETA/ETB (estimation) and TA/TB (actual) by the delta', () => {
    const p = buildGanttDragProposal({
      kind: 'move',
      deltaMs: 2 * H,
      seg: seg(),
      row: opRow,
      targetJettyId: '1A',
    })
    assert.ok(p)
    assert.equal(p.jettyChange, null)
    assert.deepEqual(
      p.estimation.map((c) => [c.field, c.toMs]),
      [
        ['etaDateTime', ETA + 2 * H],
        ['etbDateTime', ETB + 2 * H],
      ]
    )
    assert.deepEqual(
      p.actual.map((c) => [c.field, c.toMs]),
      [
        ['taDateTime', TA + 2 * H],
        ['tbDateTime', TB + 2 * H],
      ]
    )
    assert.equal(p.needsChoice, true)
  })

  it('records a jetty change when dropped on another row', () => {
    const p = buildGanttDragProposal({
      kind: 'move',
      deltaMs: 0,
      seg: seg(),
      row: opRow,
      targetJettyId: '2B',
    })
    assert.deepEqual(p.jettyChange, { from: '1A', to: '2B' })
    assert.equal(p.needsChoice, false)
    assert.equal(p.estimation.length, 0)
  })

  it('returns null when nothing changes', () => {
    const p = buildGanttDragProposal({
      kind: 'move',
      deltaMs: 0,
      seg: seg(),
      row: opRow,
      targetJettyId: '1A',
    })
    assert.equal(p, null)
  })

  it('disables the actual choice for plan-only rows', () => {
    const p = buildGanttDragProposal({
      kind: 'move',
      deltaMs: H,
      seg: seg({ taMs: null, tbMs: null }),
      row: planOnlyRow,
      targetJettyId: null,
    })
    assert.equal(p.canActual, false)
    assert.equal(p.canEstimation, true)
    assert.equal(p.needsChoice, false)
  })
})

describe('buildGanttDragProposal — resize', () => {
  it('resize-start maps to ETB/TB for alongside bars', () => {
    const p = buildGanttDragProposal({
      kind: 'resize-start',
      deltaMs: -H,
      seg: seg(),
      row: opRow,
      targetJettyId: null,
    })
    assert.deepEqual(p.estimation.map((c) => c.field), ['etbDateTime'])
    assert.deepEqual(p.actual.map((c) => c.field), ['tbDateTime'])
    assert.equal(p.actual[0].toMs, TB - H)
  })

  it('resize-start maps to ETA/TA for transit bars', () => {
    const p = buildGanttDragProposal({
      kind: 'resize-start',
      deltaMs: H,
      seg: seg({ phase: 'transit', tbMs: null, startMs: TA, endMs: TA + 3 * H }),
      row: opRow,
      targetJettyId: null,
    })
    assert.deepEqual(p.estimation.map((c) => c.field), ['etaDateTime'])
    assert.deepEqual(p.actual.map((c) => c.field), ['taDateTime'])
  })

  it('resize-end proposes a new estimated completion from the bar end', () => {
    const p = buildGanttDragProposal({
      kind: 'resize-end',
      deltaMs: 5 * H,
      seg: seg(),
      row: opRow,
      targetJettyId: null,
    })
    assert.deepEqual(p.always.map((c) => c.field), ['estimatedCompletionDateTime'])
    assert.equal(p.always[0].toMs, ETC + 5 * H)
    assert.equal(p.needsChoice, false)
  })
})

describe('buildArrivalPayloadFromProposal', () => {
  it('builds an op-path payload with only the chosen fields', () => {
    const p = buildGanttDragProposal({
      kind: 'move',
      deltaMs: 2 * H,
      seg: seg(),
      row: opRow,
      targetJettyId: '2B',
    })
    const payload = buildArrivalPayloadFromProposal(p, 'actual', opRow, 'allocation-plan')
    assert.equal(payload.operationId, 9)
    assert.equal(payload.shippingInstructionId, 4)
    assert.equal(payload.shipmentPlanId, undefined)
    assert.equal(payload.jetty, '2B')
    assert.equal(payload.taDateTime, new Date(TA + 2 * H).toISOString())
    assert.equal(payload.tbDateTime, new Date(TB + 2 * H).toISOString())
    assert.equal('etaDateTime' in payload, false, 'estimation fields omitted for actual choice')
    assert.equal('etbDateTime' in payload, false)
  })

  it('builds a plan-only payload without berthing fields', () => {
    const p = buildGanttDragProposal({
      kind: 'move',
      deltaMs: H,
      seg: seg({ taMs: null, tbMs: null, layer: 'planned', estimateOnly: true }),
      row: planOnlyRow,
      targetJettyId: null,
    })
    const payload = buildArrivalPayloadFromProposal(p, 'estimation', planOnlyRow, 'allocation-plan')
    assert.equal(payload.shipmentPlanId, 14)
    assert.equal(payload.operationId, undefined)
    assert.equal(payload.etaDateTime, new Date(ETA + H).toISOString())
    assert.equal(payload.etbDateTime, new Date(ETB + H).toISOString())
    assert.equal('taDateTime' in payload, false)
    assert.equal('tbDateTime' in payload, false)
  })
})
