import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { filterRows, rowMatchesColumnFilter, emptyFiltersForColumns, uniqueSortedOptions } from './sortableFilterableTable.js'
import { localYmd } from './clearanceSailedLookback.js'

describe('rowMatchesColumnFilter', () => {
  it('keeps text substring matching', () => {
    const col = { key: 'vessel', getFilterValue: (r) => r.vessel }
    assert.equal(rowMatchesColumnFilter({ vessel: 'BG AS MARINA' }, col, 'marina'), true)
    assert.equal(rowMatchesColumnFilter({ vessel: 'BG AS MARINA' }, col, 'CPO'), false)
    assert.equal(rowMatchesColumnFilter({ vessel: 'BG AS MARINA' }, col, ''), true)
  })

  it('uses exact matchesFilter for select columns', () => {
    const col = {
      key: 'commodityQty',
      filterType: 'select',
      matchesFilter: (r, selected) => String(r.short || '') === selected,
    }
    assert.equal(rowMatchesColumnFilter({ short: 'CPO' }, col, 'CPO'), true)
    assert.equal(rowMatchesColumnFilter({ short: 'CPO' }, col, 'PKM'), false)
    assert.equal(rowMatchesColumnFilter({ short: 'CPO' }, col, ''), true)
  })

  it('filters dateRange on local calendar days and excludes missing timestamps', () => {
    const col = {
      key: 'eta',
      filterType: 'dateRange',
      getDateIso: (r) => r.eta,
    }
    const row = { eta: '2026-09-11T12:00:00.000Z' }
    const ymd = localYmd(new Date(row.eta))
    assert.equal(rowMatchesColumnFilter(row, col, { from: ymd, to: ymd }), true)
    assert.equal(rowMatchesColumnFilter(row, col, { from: '2099-01-01', to: '' }), false)
    assert.equal(rowMatchesColumnFilter(row, col, { from: '', to: '' }), true)
    assert.equal(rowMatchesColumnFilter(row, col, ''), true)
    assert.equal(rowMatchesColumnFilter({ eta: null }, col, { from: ymd, to: ymd }), false)
  })
})

describe('emptyFiltersForColumns', () => {
  it('initializes dateRange columns as from/to objects', () => {
    assert.deepEqual(
      emptyFiltersForColumns([
        { key: 'vessel' },
        { key: 'eta', filterType: 'dateRange' },
      ]),
      { vessel: '', eta: { from: '', to: '' } },
    )
  })
})

describe('uniqueSortedOptions', () => {
  it('dedupes, prefers a given order, then sorts the rest', () => {
    assert.deepEqual(
      uniqueSortedOptions(['Operational', 'Pre-Checking', 'Operational', 'Signed off'], [
        'Pre-Checking',
        'Operational',
        'Post-Checking',
        'Ready to Sail',
        'Signed off',
      ]),
      ['Pre-Checking', 'Operational', 'Signed off'],
    )
  })
})

describe('filterRows select columns', () => {
  const columns = [
    { key: 'vessel', getFilterValue: (r) => r.vessel, getSortValue: (r) => r.vessel },
    {
      key: 'purpose',
      filterType: 'select',
      matchesFilter: (r, selected) => r.purpose === selected,
      getSortValue: (r) => r.purpose,
    },
  ]
  const rows = [
    { vessel: 'A', purpose: 'Loading' },
    { vessel: 'B', purpose: 'Unloading' },
  ]

  it('filters by purpose select without changing other columns', () => {
    assert.deepEqual(
      filterRows(rows, columns, { vessel: '', purpose: 'Loading' }).map((r) => r.vessel),
      ['A'],
    )
  })

  it('leaves master-style text filters unchanged when select is All', () => {
    assert.equal(filterRows(rows, columns, { vessel: 'b', purpose: '' }).length, 1)
    assert.equal(filterRows(rows, columns, { vessel: 'b', purpose: '' })[0].vessel, 'B')
  })
})
