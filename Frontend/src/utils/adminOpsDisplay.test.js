import test from 'node:test'
import assert from 'node:assert/strict'
import {
  countChecksByStatus,
  isNeedsAttention,
  shortBatchId,
  sortChecksBySeverity,
} from './adminOpsDisplay.js'

test('sortChecksBySeverity orders unhealthy first', () => {
  const checks = [
    { id: 'a', status: 'healthy' },
    { id: 'b', status: 'unhealthy' },
    { id: 'c', status: 'degraded' },
  ]
  assert.deepEqual(
    sortChecksBySeverity(checks).map((c) => c.id),
    ['b', 'c', 'a']
  )
})

test('countChecksByStatus tallies statuses', () => {
  const counts = countChecksByStatus([
    { status: 'unhealthy' },
    { status: 'unhealthy' },
    { status: 'healthy' },
  ])
  assert.equal(counts.unhealthy, 2)
  assert.equal(counts.healthy, 1)
})

test('isNeedsAttention includes unknown and excludes disabled', () => {
  assert.equal(isNeedsAttention('unknown'), true)
  assert.equal(isNeedsAttention('disabled'), false)
  assert.equal(isNeedsAttention('healthy'), false)
})

test('shortBatchId truncates long UUIDs', () => {
  assert.equal(shortBatchId('abd57508-9bd7-49b5-8c03-12cfef5f767f'), 'abd57508…')
})
