import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  SOURCE_ALL,
  SOURCE_INTERNAL,
  buildSourceChips,
  filterRowsBySource,
  partnerSourceKey,
  planSourceOf,
  planSourceSortValue,
} from './planSource.js'

const rows = [
  { id: 1, partnerName: 'Beta' },
  { id: 2, partnerName: null },
  { id: 3, partnerName: 'Alpha' },
  { id: 4 },
  { id: 5, partnerName: 'Beta' },
]

describe('planSource', () => {
  it('classifies rows as partner or internal', () => {
    assert.deepEqual(planSourceOf(rows[0]), { kind: 'partner', name: 'Beta' })
    assert.deepEqual(planSourceOf(rows[1]), { kind: 'internal' })
    assert.deepEqual(planSourceOf({ partnerName: '   ' }), { kind: 'internal' })
  })

  it('sorts internal first, then partners alphabetically', () => {
    const sorted = [...rows].sort((a, b) => planSourceSortValue(a).localeCompare(planSourceSortValue(b)))
    assert.deepEqual(sorted.map((r) => r.id).slice(0, 2).sort(), [2, 4])
    assert.deepEqual(sorted.slice(2).map((r) => r.partnerName), ['Alpha', 'Beta', 'Beta'])
  })

  it('builds chips with counts: All, Internal, then partners alphabetically', () => {
    const chips = buildSourceChips(rows, SOURCE_ALL)
    assert.deepEqual(
      chips.map((c) => [c.key, c.count]),
      [
        [SOURCE_ALL, 5],
        [SOURCE_INTERNAL, 2],
        [partnerSourceKey('Alpha'), 1],
        [partnerSourceKey('Beta'), 2],
      ]
    )
  })

  it('shows no chips when the list has no partner plans', () => {
    assert.deepEqual(buildSourceChips([{ id: 1 }, { id: 2 }], SOURCE_ALL), [])
    assert.deepEqual(buildSourceChips([], SOURCE_ALL), [])
  })

  it('keeps a selected partner chip at 0 when it has no rows', () => {
    const chips = buildSourceChips([{ id: 1 }], partnerSourceKey('Gamma'))
    assert.deepEqual(chips.map((c) => [c.key, c.count]), [
      [SOURCE_ALL, 1],
      [SOURCE_INTERNAL, 1],
      [partnerSourceKey('Gamma'), 0],
    ])
  })

  it('filters rows by selection', () => {
    assert.equal(filterRowsBySource(rows, SOURCE_ALL), rows)
    assert.deepEqual(filterRowsBySource(rows, SOURCE_INTERNAL).map((r) => r.id), [2, 4])
    assert.deepEqual(filterRowsBySource(rows, partnerSourceKey('Beta')).map((r) => r.id), [1, 5])
    assert.deepEqual(filterRowsBySource(rows, partnerSourceKey('Missing')), [])
  })

  it('does not confuse a partner named like a reserved key with All or Internal', () => {
    const named = [{ id: 1, partnerName: 'internal' }, { id: 2 }]
    assert.deepEqual(filterRowsBySource(named, SOURCE_INTERNAL).map((r) => r.id), [2])
    assert.deepEqual(filterRowsBySource(named, partnerSourceKey('internal')).map((r) => r.id), [1])
  })
})
