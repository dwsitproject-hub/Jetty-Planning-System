import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildStripSegments, formatStopDuration, mergeStops, reasonName } from './noFlowDisplay.js'

const summary = {
  window: { startedAt: '2026-10-19T00:00:00Z', endedAt: '2026-10-19T10:00:00Z' },
  events: [{ id: '1', startedAt: '2026-10-19T01:00:00Z', endedAt: '2026-10-19T02:00:00Z', minutes: 60 }],
  unexplained: [{ startedAt: '2026-10-19T05:00:00Z', endedAt: '2026-10-19T07:00:00Z', minutes: 120 }],
}

test('formatStopDuration', () => {
  assert.equal(formatStopDuration(45), '45m')
  assert.equal(formatStopDuration(125), '2h 05m')
})

test('reasonName follows the app language', () => {
  const r = { nameEn: 'Tank switch', nameId: 'Pindah tangki' }
  assert.equal(reasonName(r, 'id'), 'Pindah tangki')
  assert.equal(reasonName(r, 'en'), 'Tank switch')
  assert.equal(reasonName({ reasonNameEn: 'Tank switch', reasonNameId: 'Pindah tangki' }, 'id'), 'Pindah tangki')
})

test('mergeStops orders recorded and unexplained stops by time', () => {
  assert.deepEqual(mergeStops(summary).map((s) => s.kind), ['event', 'unexplained'])
})

test('buildStripSegments fills flow between stops', () => {
  const segs = buildStripSegments(summary).map((s) => [s.kind, Math.round(s.leftPct), Math.round(s.widthPct)])
  assert.deepEqual(segs, [
    ['flow', 0, 10],
    ['event', 10, 10],
    ['flow', 20, 30],
    ['unexplained', 50, 20],
    ['flow', 70, 30],
  ])
  assert.deepEqual(buildStripSegments({ window: null }), [])
})
