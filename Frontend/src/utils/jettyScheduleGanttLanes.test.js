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
