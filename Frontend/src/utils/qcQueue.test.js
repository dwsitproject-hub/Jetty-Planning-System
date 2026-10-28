import test from 'node:test'
import assert from 'node:assert/strict'
import { filterQcGroups, groupQcQueue, sortQcGroups } from './qcQueue.js'

const row = (operationId, shipmentPlanId, vesselName, status, extra = {}) => ({
  operationId,
  shipmentPlanId,
  vesselName,
  jetty: '1A',
  shippingInstruction: `SI-${operationId}`,
  tbDateTime: '2026-10-01T00:00:00Z',
  sampling: { status },
  ...extra,
})

test('groupQcQueue merges SIs of one plan and aggregates status', () => {
  const groups = groupQcQueue([
    row(2, 7, 'MT A', 'done'),
    row(1, 7, 'MT A', 'not_started'),
    row(3, 8, 'MT B', 'not_started'),
  ])
  assert.equal(groups.length, 2)
  const a = groups.find((g) => g.vesselName === 'MT A')
  assert.deepEqual(a.children.map((c) => c.operationId), [1, 2])
  assert.equal(a.sampledCount, 1)
  assert.equal(a.status, 'draft')
  assert.equal(groups.find((g) => g.vesselName === 'MT B').status, 'not_started')
})

test('filterQcGroups hides finished vessels on "needs" and search matches SI refs', () => {
  const groups = groupQcQueue([
    row(1, 1, 'MT A', 'done'),
    row(2, 2, 'MT B', 'draft'),
    row(3, 3, 'MT C', 'not_started'),
  ])
  assert.deepEqual(filterQcGroups(groups, 'needs', '').map((g) => g.vesselName).sort(), ['MT B', 'MT C'])
  assert.deepEqual(filterQcGroups(groups, 'done', '').map((g) => g.vesselName), ['MT A'])
  assert.equal(filterQcGroups(groups, 'all', '').length, 3)
  assert.deepEqual(filterQcGroups(groups, 'all', 'si-3').map((g) => g.vesselName), ['MT C'])
})

test('sortQcGroups defaults to earliest TB and sinks vessels without TB', () => {
  const groups = groupQcQueue([
    row(1, 1, 'MT Late', 'draft', { tbDateTime: '2026-10-03T00:00:00Z' }),
    row(2, 2, 'MT Early', 'draft', { tbDateTime: '2026-10-01T00:00:00Z' }),
    row(3, 3, 'MT NoTb', 'draft', { tbDateTime: null }),
  ])
  assert.deepEqual(sortQcGroups(groups, 'tb').map((g) => g.vesselName), ['MT Early', 'MT Late', 'MT NoTb'])
  assert.deepEqual(sortQcGroups(groups, 'vesselName').map((g) => g.vesselName), ['MT Early', 'MT Late', 'MT NoTb'])
})
