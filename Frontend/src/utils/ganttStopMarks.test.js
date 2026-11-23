import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildStopMarks, stopMarkTitle } from './ganttStopMarks.js'

const H = 3600000
const t0 = Date.parse('2026-11-14T00:00:00Z')
const at = (h) => new Date(t0 + h * H).toISOString()
const stop = (id, s, e, extra = {}) => ({ id, startedAt: at(s), endedAt: e == null ? null : at(e), reasonCode: 'OVT', reasonNameEn: 'Over tank', reasonNameId: 'Overtank', category: 'terminal', note: null, ...extra })

test('places stops as percentages of the bar and clips them to it', () => {
  const marks = buildStopMarks([stop('a', 2, 4), stop('b', -5, 1), stop('c', 9, 20), stop('d', 20, 22)], t0, t0 + 10 * H, t0 + 100 * H)
  assert.deepEqual(marks.map((m) => [m.key, m.leftPct, m.widthPct]), [['a', 20, 20], ['b', 0, 10], ['c', 90, 10]])
  assert.equal(marks[1].hours, 6)
})

test('an open stop runs until now and nothing is drawn for empty input', () => {
  const marks = buildStopMarks([stop('o', 6, null)], t0, t0 + 10 * H, t0 + 8 * H)
  assert.equal(marks[0].leftPct, 60)
  assert.equal(marks[0].widthPct, 20)
  assert.deepEqual(buildStopMarks(undefined, t0, t0 + H), [])
  assert.deepEqual(buildStopMarks([stop('a', 1, 2)], t0, t0), [])
  assert.deepEqual(buildStopMarks([{ id: 'x', startedAt: 'bad', endedAt: null }], t0, t0 + H), [])
})

test('hover text names the reason, who caused it, length and note', () => {
  const [m] = buildStopMarks([stop('a', 2, 4, { note: 'tank 5004 full' })], t0, t0 + 10 * H)
  const fmt = (v) => `@${v.slice(11, 16)}`
  assert.equal(stopMarkTitle(m, 'en', fmt), 'Over tank · Terminal\n@02:00 – @04:00 · 2.0 h\ntank 5004 full')
  assert.match(stopMarkTitle(m, 'id', fmt), /^Overtank · Terminal/)
  const [open] = buildStopMarks([stop('o', 6, null)], t0, t0 + 10 * H, t0 + 8 * H)
  assert.match(stopMarkTitle(open, 'en', fmt), /in progress/)
})
