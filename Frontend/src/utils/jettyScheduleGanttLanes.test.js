import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildScheduleSegments, assignBankLanesByVessel } from './jettyScheduleGanttLanes.js'

const JUN_10 = new Date('2026-06-10T08:00:00').toISOString()
const JUN_20 = new Date('2026-06-20T18:00:00').toISOString()
const JUN_21 = new Date('2026-06-21T06:00:00').toISOString()
const JUN_24 = new Date('2026-06-24T12:00:00').getTime()
const WINDOW_START = new Date('2026-06-01T00:00:00').getTime()
const WINDOW_END = new Date('2026-07-01T00:00:00').getTime()

function row(overrides) {
  return {
    jetty: '1B',
    vesselId: 'op-1',
    vesselName: 'Vessel A',
    sequence: 1,
    ...overrides,
  }
}

describe('buildScheduleSegments planned dedup', () => {
  it('emits one planned segment per jetty+plan when multiple SIs share shipmentPlanId', () => {
    const plan = [
      row({
        shipmentPlanId: 14,
        vesselId: 'op-100',
        vesselName: 'BG As Warrior 2',
        plannedEtbDateTime: JUN_21,
        etbDateTime: JUN_21,
        operationId: 100,
      }),
      row({
        shipmentPlanId: 14,
        vesselId: 'op-101',
        vesselName: 'BG As Warrior 2 SI-2',
        plannedEtbDateTime: JUN_21,
        etbDateTime: JUN_21,
        operationId: 101,
      }),
    ]
    const segs = buildScheduleSegments(plan, WINDOW_START, WINDOW_END, JUN_24)
    const planned = segs.filter((s) => s.layer === 'planned' && s.jettyId === '1B')
    assert.equal(planned.length, 1)
    assert.equal(planned[0].bankLaneKey, 'plan-14')
    assert.equal(planned[0].estimateOnly, true)
  })

  it('suppresses the planned (estimate) segment once the vessel has actual milestones', () => {
    const plan = [
      row({
        shipmentPlanId: 14,
        vesselId: 'op-100',
        plannedEtbDateTime: JUN_21,
        etbDateTime: JUN_21,
        tbDateTime: JUN_21,
        operationId: 100,
      }),
    ]
    const segs = buildScheduleSegments(plan, WINDOW_START, WINDOW_END, JUN_24)
    assert.equal(segs.filter((s) => s.layer === 'planned').length, 0, 'no planned bar')
    const actual = segs.filter((s) => s.layer === 'actual' && s.phase === 'ops')
    assert.equal(actual.length, 1, 'actual bar still emitted')
    assert.equal(actual[0].plannedEtbMs, new Date(JUN_21).getTime(), 'actual bar carries ETB')
  })

  it('suppresses the planned segment when TA exists even without TB (transit)', () => {
    const plan = [
      row({
        shipmentPlanId: 14,
        vesselId: 'op-100',
        etaDateTime: JUN_10,
        taDateTime: JUN_20,
        operationId: 100,
      }),
    ]
    const segs = buildScheduleSegments(plan, WINDOW_START, WINDOW_END, JUN_24)
    assert.equal(segs.filter((s) => s.layer === 'planned').length, 0)
    const transit = segs.filter((s) => s.layer === 'actual' && s.phase === 'transit')
    assert.equal(transit.length, 1)
    assert.equal(transit[0].etaMs, new Date(JUN_10).getTime(), 'transit bar carries ETA')
  })
})

describe('buildScheduleSegments actual ops dedup', () => {
  const TB_OLD = new Date('2026-06-01T08:00:00').toISOString()  // old SAILED docking_start_time
  const TB_NEW = new Date('2026-06-19T16:40:00').toISOString()  // real current TB

  it('emits only the non-sailed bar when a SAILED and a DOCKED row share the same bankLaneKey', () => {
    const plan = [
      row({
        shipmentPlanId: 14,
        vesselId: 'op-8',
        vesselName: 'BG As Warrior 2',
        status: 'SAILED',
        tbDateTime: TB_OLD,
        operationId: 8,
        sequence: 1,
      }),
      row({
        shipmentPlanId: 14,
        vesselId: 'op-9',
        vesselName: 'BG As Warrior 2',
        status: 'DOCKED',
        tbDateTime: TB_NEW,
        operationId: 9,
        sequence: 1,
      }),
    ]
    const segs = buildScheduleSegments(plan, WINDOW_START, WINDOW_END, JUN_24)
    const actualOps = segs.filter((s) => s.layer === 'actual' && s.phase === 'ops')
    assert.equal(actualOps.length, 1, 'only one actual ops segment emitted')
    assert.equal(actualOps[0].startMs, new Date(TB_NEW).getTime(), 'segment uses the current (non-sailed) TB')
  })

  it('among two SAILED rows for the same plan, picks the latest TB', () => {
    const plan = [
      row({
        shipmentPlanId: 14,
        vesselId: 'op-8',
        status: 'SAILED',
        tbDateTime: TB_OLD,
        operationId: 8,
        castOffDateTime: JUN_20,
        actualCompletionDateTime: JUN_20,
      }),
      row({
        shipmentPlanId: 14,
        vesselId: 'op-9',
        status: 'SAILED',
        tbDateTime: TB_NEW,
        operationId: 9,
        castOffDateTime: JUN_21,
        actualCompletionDateTime: JUN_21,
      }),
    ]
    const segs = buildScheduleSegments(plan, WINDOW_START, WINDOW_END, JUN_24)
    const actualOps = segs.filter((s) => s.layer === 'actual' && s.phase === 'ops')
    assert.equal(actualOps.length, 1)
    assert.equal(actualOps[0].startMs, new Date(TB_NEW).getTime(), 'latest TB wins among sailed rows')
  })
})

describe('assignBankLanesByVessel', () => {
  const rowDefs = [
    { jettyId: '1B', laneIndex: 0, rowKey: '1B__0', label: '1B-01', capacity: 2 },
    { jettyId: '1B', laneIndex: 1, rowKey: '1B__1', label: '1B-02', capacity: 2 },
  ]

  it('assigns active alongside vessels to schematic lanes; sailed prefers high free lane', () => {
    const listRows = [
      row({
        shipmentPlanId: 1,
        vesselId: 'op-sailed',
        vesselName: 'Sailed Vessel',
        status: 'SAILED',
        tbDateTime: JUN_10,
        castOffDateTime: JUN_20,
        actualCompletionDateTime: JUN_20,
        operationId: 1,
      }),
      row({
        shipmentPlanId: 14,
        vesselId: 'op-warrior',
        vesselName: 'BG As Warrior 2',
        status: 'DOCKED',
        tbDateTime: JUN_21,
        operationId: 14,
      }),
      row({
        shipmentPlanId: 19,
        vesselId: 'op-berlian',
        vesselName: 'BG Berlian Pacific III',
        status: 'DOCKED',
        tbDateTime: JUN_21,
        operationId: 19,
      }),
    ]

    const baseSegments = buildScheduleSegments(listRows, WINDOW_START, WINDOW_END, JUN_24)
    const assigned = assignBankLanesByVessel(baseSegments, rowDefs, listRows, JUN_24)

    const warriorActual = assigned.find(
      (s) => s.bankLaneKey === 'plan-14' && s.layer === 'actual' && s.phase === 'ops'
    )
    const berlianActual = assigned.find(
      (s) => s.bankLaneKey === 'plan-19' && s.layer === 'actual' && s.phase === 'ops'
    )
    const sailedActual = assigned.find(
      (s) => s.bankLaneKey === 'plan-1' && s.layer === 'actual' && s.phase === 'ops'
    )

    assert.ok(warriorActual, 'warrior segment exists')
    assert.ok(berlianActual, 'berlian segment exists')
    assert.equal(warriorActual.rowKey, '1B__0', 'active warrior on 1B-01')
    assert.equal(berlianActual.rowKey, '1B__1', 'active berlian on 1B-02')
    assert.equal(sailedActual?.rowKey, '1B__1', 'sailed vessel prefers free high lane over active 01 row')
  })

  it('packs a future vessel onto the lane of the vessel it follows in time', () => {
    // Jetty 1B full: two vessels currently alongside (lane 0 ends earlier, lane 1 ends later).
    // A third vessel scheduled AFTER lane 1's occupant must land on lane 1, not fall back to lane 0.
    const TB_LANE0 = new Date('2026-06-10T08:00:00').toISOString()
    const ETC_LANE0 = new Date('2026-06-22T08:00:00').toISOString()
    const TB_LANE1 = new Date('2026-06-11T08:00:00').toISOString()
    const ETC_LANE1 = new Date('2026-06-27T20:00:00').toISOString()
    const TB_FUTURE = new Date('2026-06-28T06:00:00').toISOString()
    const listRows = [
      row({
        shipmentPlanId: 1,
        vesselId: 'op-first',
        status: 'DOCKED',
        tbDateTime: TB_LANE0,
        estimatedCompletionDateTime: ETC_LANE0,
        operationId: 1,
      }),
      row({
        shipmentPlanId: 2,
        vesselId: 'op-second',
        status: 'DOCKED',
        tbDateTime: TB_LANE1,
        estimatedCompletionDateTime: ETC_LANE1,
        operationId: 2,
      }),
      row({
        shipmentPlanId: 3,
        vesselId: 'op-future',
        status: 'BERTHING_APPROVED',
        tbDateTime: TB_FUTURE,
        operationId: 3,
      }),
    ]
    const baseSegments = buildScheduleSegments(listRows, WINDOW_START, new Date('2026-08-01T00:00:00').getTime(), JUN_24)
    const assigned = assignBankLanesByVessel(baseSegments, rowDefs, listRows, JUN_24)

    const first = assigned.find((s) => s.bankLaneKey === 'plan-1')
    const second = assigned.find((s) => s.bankLaneKey === 'plan-2')
    const future = assigned.find((s) => s.bankLaneKey === 'plan-3')
    assert.ok(first && second && future)
    assert.notEqual(first.laneIndex, second.laneIndex, 'active vessels occupy different lanes')
    assert.equal(
      future.rowKey,
      `1B__${second.laneIndex}`,
      'future vessel follows the later-ending occupant on its lane'
    )
  })

  it('actual ops segment starts at tbDateTime (not an earlier docking placeholder)', () => {
    const TB = new Date('2026-06-19T09:40:00').toISOString()
    const listRows = [
      row({
        shipmentPlanId: 14,
        vesselId: 'op-warrior',
        vesselName: 'BG As Warrior 2',
        status: 'DOCKED',
        tbDateTime: TB,
        operationId: 9,
      }),
    ]
    const segs = buildScheduleSegments(listRows, WINDOW_START, WINDOW_END, JUN_24)
    const actual = segs.find((s) => s.layer === 'actual' && s.phase === 'ops')
    assert.ok(actual)
    assert.equal(actual.startMs, new Date(TB).getTime())
    assert.equal(actual.startSource, 'TB')
  })
})
