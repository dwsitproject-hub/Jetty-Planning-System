import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { sortModalRows } from './widgetDetailSort.js'

const columns = [
  { key: 'vessel', sortValue: (r) => r.vessel },
  { key: 'moved', sortValue: (r) => r.moved },
]

const rows = [
  { vessel: 'B', moved: 10 },
  { vessel: 'A', moved: null },
  { vessel: 'C', moved: 30 },
]

describe('sortModalRows', () => {
  it('sorts numbers descending and keeps missing values last', () => {
    const sorted = sortModalRows(rows, columns, { key: 'moved', dir: 'desc' })
    assert.deepEqual(sorted.map((r) => r.vessel), ['C', 'B', 'A'])
  })

  it('sorts numbers ascending and still keeps missing values last', () => {
    const sorted = sortModalRows(rows, columns, { key: 'moved', dir: 'asc' })
    assert.deepEqual(sorted.map((r) => r.vessel), ['B', 'C', 'A'])
  })

  it('sorts text ascending', () => {
    const sorted = sortModalRows(rows, columns, { key: 'vessel', dir: 'asc' })
    assert.deepEqual(sorted.map((r) => r.vessel), ['A', 'B', 'C'])
  })
})
