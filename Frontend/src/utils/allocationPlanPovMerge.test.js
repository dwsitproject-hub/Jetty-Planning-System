import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mergeQueueRowsForPlanPov } from './allocationPlanPovMerge.js'

const DOCKING_EARLY = new Date('2026-06-01T08:00:00').toISOString()
const TB_ACTUAL = new Date('2026-06-19T09:40:00').toISOString()

describe('mergeQueueRowsForPlanPov tbDateTime', () => {
  it('uses representative operation TB, not min across stale sibling rows', () => {
    const { mergedRows } = mergeQueueRowsForPlanPov([
      {
        shipmentPlanId: 14,
        vesselId: 'op-9',
        vesselName: 'BG As Warrior 2',
        jetty: '1B',
        status: 'DOCKED',
        tbDateTime: TB_ACTUAL,
        operationId: 9,
        sequence: 1,
      },
      {
        shipmentPlanId: 14,
        vesselId: 'si-999',
        vesselName: 'BG As Warrior 2',
        jetty: '1B',
        status: 'ALLOCATED',
        tbDateTime: DOCKING_EARLY,
        source: 'incoming-si',
        sequence: 1,
      },
    ])
    assert.equal(mergedRows.length, 1)
    assert.equal(mergedRows[0].tbDateTime, TB_ACTUAL)
  })
})
