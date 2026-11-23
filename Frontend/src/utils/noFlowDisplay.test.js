import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildStripSegments, formatStopDuration, mergeStops, reasonName, stopPhase } from './noFlowDisplay.js'

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
  const open = buildStripSegments({
    window: summary.window,
    events: [{ id: '9', startedAt: '2026-10-19T08:00:00Z', endedAt: null, minutes: 120 }],
  })
  assert.deepEqual(open.map((s) => [s.kind, Math.round(s.widthPct)]), [['flow', 80], ['event', 20]])
})

test('stopPhase places stops before, during or after the cargo window', () => {
  const w = summary.window
  assert.equal(stopPhase({ startedAt: '2026-10-18T20:00:00Z', endedAt: '2026-10-18T23:00:00Z' }, w), 'before')
  assert.equal(stopPhase({ startedAt: '2026-10-18T23:00:00Z', endedAt: '2026-10-19T01:00:00Z' }, w), 'during')
  assert.equal(stopPhase({ startedAt: '2026-10-19T11:00:00Z', endedAt: null }, w), 'after')
  assert.equal(stopPhase({ startedAt: '2026-10-19T11:00:00Z', endedAt: null }, { ...w, isOpen: true }), 'during')
  assert.equal(stopPhase({ startedAt: '2026-10-19T11:00:00Z', endedAt: null }, null), 'before')
  assert.deepEqual(mergeStops(summary).map((s) => s.phase), ['during', 'during'])
})
