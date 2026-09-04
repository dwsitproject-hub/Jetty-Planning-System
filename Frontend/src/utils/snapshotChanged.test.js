import test from 'node:test'
import assert from 'node:assert/strict'
import { operationalProgressPayloadChanged } from './snapshotChanged.js'

test('operationalProgressPayloadChanged detects event count change', () => {
  const prev = [{ id: 1, timestamp: '2026-01-01T10:00:00Z' }]
  const next = [
    { id: 1, timestamp: '2026-01-01T10:00:00Z' },
    { id: 2, timestamp: '2026-01-01T11:00:00Z' },
  ]
  assert.equal(operationalProgressPayloadChanged(prev, next, null, null), true)
})

test('operationalProgressPayloadChanged ignores identical snapshots', () => {
  const events = [{ id: 1, timestamp: '2026-01-01T10:00:00Z', cargoLoadLines: [] }]
  const progress = {
    movedQty: 100,
    source: 'atg',
    hourlyBuckets: [{ hourKey: '2026-01-01T10:00:00' }],
    cumulativeSeries: [{ cumulativeQty: 100 }],
  }
  assert.equal(
    operationalProgressPayloadChanged(events, [...events], progress, { ...progress }),
    false
  )
})

test('operationalProgressPayloadChanged detects moved qty change', () => {
  const events = []
  const prev = { movedQty: 100, hourlyBuckets: [], cumulativeSeries: [] }
  const next = { movedQty: 150, hourlyBuckets: [], cumulativeSeries: [] }
  assert.equal(operationalProgressPayloadChanged(events, events, prev, next), true)
})
