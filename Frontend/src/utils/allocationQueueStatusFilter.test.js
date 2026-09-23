import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  QUEUE_STATUS_BERTHED,
  QUEUE_STATUS_ETC_BREACHED,
  QUEUE_STATUS_INCOMING,
  QUEUE_STATUS_WAITING_TO_BERTH,
  isAllocationQueueWaitingToBerth,
  rowPassesAllocationStatusFilter,
} from './allocationQueueStatusFilter.js'

const NOW = new Date('2026-09-10T12:00:00.000Z').getTime()

function passes(row, rowStatus, stage) {
  return rowPassesAllocationStatusFilter(row, rowStatus, stage, { breachNowMs: NOW })
}

describe('isAllocationQueueWaitingToBerth', () => {
  it('is true when incoming row has TA and is not sailed', () => {
    assert.equal(
      isAllocationQueueWaitingToBerth({ taDateTime: '2026-09-09T11:00:00.000Z' }, 'incoming'),
      true,
    )
  })

  it('is false when incoming row has no TA', () => {
    assert.equal(isAllocationQueueWaitingToBerth({ etaDateTime: '2026-09-12T11:00:00.000Z' }, 'incoming'), false)
  })

  it('is false when row is berthed', () => {
    assert.equal(
      isAllocationQueueWaitingToBerth(
        { taDateTime: '2026-09-09T11:00:00.000Z', tbDateTime: '2026-09-10T01:00:00.000Z' },
        'berthed',
      ),
      false,
    )
  })

  it('is false when sailed even if TA is set', () => {
    assert.equal(
      isAllocationQueueWaitingToBerth(
        { taDateTime: '2026-09-09T11:00:00.000Z', status: 'SAILED' },
        'incoming',
      ),
      false,
    )
  })
})

describe('rowPassesAllocationStatusFilter exclusive stages', () => {
  const incomingNoTa = { vesselName: 'Incoming', etaDateTime: '2026-09-12T11:00:00.000Z' }
  const waitingTa = { vesselName: 'Waiting', taDateTime: '2026-09-09T11:00:00.000Z' }
  const shiftOutWaiting = {
    vesselName: 'Shift out',
    shiftingOut: true,
    taDateTime: '2026-09-09T11:00:00.000Z',
  }
  const sailedWithTa = {
    vesselName: 'Sailed',
    taDateTime: '2026-09-09T11:00:00.000Z',
    status: 'SAILED',
  }
  const berthedOk = {
    vesselName: 'Berthed',
    tbDateTime: '2026-09-08T08:00:00.000Z',
    status: 'IN_PROGRESS',
    estimatedCompletionDateTime: '2026-09-11T12:00:00.000Z',
  }
  const berthedEtc = {
    vesselName: 'ETC overdue',
    tbDateTime: '2026-09-08T08:00:00.000Z',
    status: 'IN_PROGRESS',
    estimatedCompletionDateTime: '2026-09-09T12:00:00.000Z',
  }

  it('Incoming shows only non-TA incoming rows', () => {
    assert.equal(passes(incomingNoTa, 'incoming', QUEUE_STATUS_INCOMING), true)
    assert.equal(passes(waitingTa, 'incoming', QUEUE_STATUS_INCOMING), false)
    assert.equal(passes(berthedOk, 'berthed', QUEUE_STATUS_INCOMING), false)
  })

  it('Waiting to Berth shows incoming rows with TA', () => {
    assert.equal(passes(waitingTa, 'incoming', QUEUE_STATUS_WAITING_TO_BERTH), true)
    assert.equal(passes(incomingNoTa, 'incoming', QUEUE_STATUS_WAITING_TO_BERTH), false)
    assert.equal(passes(berthedOk, 'berthed', QUEUE_STATUS_WAITING_TO_BERTH), false)
  })

  it('shift-out with TA is Waiting to Berth', () => {
    assert.equal(passes(shiftOutWaiting, 'incoming', QUEUE_STATUS_WAITING_TO_BERTH), true)
    assert.equal(passes(shiftOutWaiting, 'incoming', QUEUE_STATUS_INCOMING), false)
  })

  it('sailed with TA is excluded from Waiting to Berth and Incoming', () => {
    assert.equal(passes(sailedWithTa, 'incoming', QUEUE_STATUS_WAITING_TO_BERTH), false)
    assert.equal(passes(sailedWithTa, 'incoming', QUEUE_STATUS_INCOMING), false)
  })

  it('Berthed includes all berthed rows including ETC breached', () => {
    assert.equal(passes(berthedOk, 'berthed', QUEUE_STATUS_BERTHED), true)
    assert.equal(passes(berthedEtc, 'berthed', QUEUE_STATUS_BERTHED), true)
    assert.equal(passes(waitingTa, 'incoming', QUEUE_STATUS_BERTHED), false)
  })

  it('ETC Breached is berthed rows whose ETC has passed', () => {
    assert.equal(passes(berthedEtc, 'berthed', QUEUE_STATUS_ETC_BREACHED), true)
    assert.equal(passes(berthedOk, 'berthed', QUEUE_STATUS_ETC_BREACHED), false)
    assert.equal(passes(waitingTa, 'incoming', QUEUE_STATUS_ETC_BREACHED), false)
  })
})
