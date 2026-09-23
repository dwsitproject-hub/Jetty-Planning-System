import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { summarizeSailedSince, sailedOffTime, SAILED_LOOKBACK_MS } from './dashboardSailed.js'

function parseIso(iso) {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

const NOW = new Date('2026-09-11T02:00:00.000Z').getTime()
const SINCE = NOW - SAILED_LOOKBACK_MS

describe('summarizeSailedSince', () => {
  it('counts unique voyages that cast off within the lookback', () => {
    const summary = summarizeSailedSince([
      { id: 1, status: 'SAILED', shipmentPlanId: 10, vesselName: 'A', castOffAt: '2026-09-10T10:00:00.000Z' },
      { id: 2, status: 'SAILED', shipmentPlanId: 10, vesselName: 'A', castOffAt: '2026-09-10T10:00:00.000Z' },
      { id: 3, status: 'SAILED', shipmentPlanId: 11, vesselName: 'B', castOffAt: '2026-09-08T01:00:00.000Z' },
    ], SINCE, parseIso)
    assert.equal(summary.count, 1)
    assert.equal(summary.vessels[0].vesselName, 'A')
    assert.equal(summary.vessels[0].operationCode, null)
  })

  it('keeps jetty and operation code for the tooltip', () => {
    const summary = summarizeSailedSince([
      {
        id: 8,
        status: 'SAILED',
        vesselName: 'MT DEMO',
        jettyName: 'Jetty 1A',
        jettyOperationCode: 'UN-26-09-0001',
        castOffAt: '2026-09-10T10:00:00.000Z',
      },
    ], SINCE, parseIso)
    assert.equal(summary.vessels[0].jettyName, 'Jetty 1A')
    assert.equal(summary.vessels[0].operationCode, 'UN-26-09-0001')
  })

  it('falls back to actualCompletionTime then sailedAt', () => {
    assert.equal(
      sailedOffTime({ actualCompletionTime: '2026-09-10T12:00:00.000Z' }, parseIso)?.toISOString(),
      '2026-09-10T12:00:00.000Z',
    )
    const summary = summarizeSailedSince([
      { id: 4, status: 'SAILED', vesselName: 'C', sailedAt: '2026-09-10T20:00:00.000Z' },
    ], SINCE, parseIso)
    assert.equal(summary.count, 1)
  })

  it('skips non-sailed, missing timestamps, and rejected plans', () => {
    const summary = summarizeSailedSince([
      { id: 5, status: 'SIGNOFF_APPROVED', castOffAt: '2026-09-10T10:00:00.000Z' },
      { id: 6, status: 'SAILED', vesselName: 'No time' },
      { id: 7, status: 'SAILED', shipmentPlanId: 99, vesselName: 'Rejected', castOffAt: '2026-09-10T10:00:00.000Z' },
    ], SINCE, parseIso, new Set([99]))
    assert.equal(summary.count, 0)
  })
})
