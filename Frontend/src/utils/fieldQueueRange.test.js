import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultSailedRange, fieldQueueQuery, sailedRangeError, sailedRangeParams } from './fieldQueueRange.js'

test('defaultSailedRange covers today and the 30 days before it', () => {
  assert.deepEqual(defaultSailedRange(new Date(2026, 10, 19, 15, 30)), { from: '2026-10-20', to: '2026-11-19' })
})

test('sailedRangeError flags missing, reversed and over-long ranges', () => {
  assert.equal(sailedRangeError({ from: '2026-11-01', to: '2026-11-19' }), null)
  assert.equal(sailedRangeError({ from: '2026-11-19', to: '2026-11-19' }), null)
  assert.equal(sailedRangeError({ from: '', to: '2026-11-19' }), 'required')
  assert.equal(sailedRangeError({ from: '2026-11-20', to: '2026-11-19' }), 'order')
  assert.equal(sailedRangeError({ from: '2025-11-01', to: '2026-11-19' }), 'tooLong')
})

test('sailedRangeParams sends whole local days with the end day included', () => {
  const params = sailedRangeParams({ from: '2026-11-01', to: '2026-11-19' })
  assert.equal(params.scope, 'sailed')
  assert.equal(params.from, new Date(2026, 10, 1).toISOString())
  assert.equal(params.to, new Date(2026, 10, 20).toISOString())
})

test('fieldQueueQuery is empty for the berthed queue and encodes the sailed range', () => {
  assert.equal(fieldQueueQuery(undefined), '')
  assert.equal(fieldQueueQuery({}), '')
  const q = fieldQueueQuery({ scope: 'sailed', from: '2026-11-01T00:00:00.000Z', to: '2026-11-20T00:00:00.000Z' })
  assert.equal(q, '?scope=sailed&from=2026-11-01T00%3A00%3A00.000Z&to=2026-11-20T00%3A00%3A00.000Z')
})
