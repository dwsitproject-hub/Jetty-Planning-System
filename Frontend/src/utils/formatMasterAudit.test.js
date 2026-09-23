import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { MASTER_AUDIT_COLUMNS } from './formatMasterAudit.js'
import {
  emptyFiltersForColumns,
  rowMatchesColumnFilter,
} from './sortableFilterableTable.js'
import { localYmd } from './clearanceSailedLookback.js'

describe('MASTER_AUDIT_COLUMNS', () => {
  it('uses dateRange filters with getDateIso instead of free text', () => {
    const created = MASTER_AUDIT_COLUMNS.find((c) => c.key === 'createdAt')
    const updated = MASTER_AUDIT_COLUMNS.find((c) => c.key === 'updatedAt')
    assert.equal(created?.filterType, 'dateRange')
    assert.equal(typeof created?.getDateIso, 'function')
    assert.equal(updated?.filterType, 'dateRange')
    assert.equal(typeof updated?.getDateIso, 'function')
  })

  it('initializes Created and Last updated as from/to objects', () => {
    assert.deepEqual(emptyFiltersForColumns(MASTER_AUDIT_COLUMNS), {
      createdAt: { from: '', to: '' },
      updatedAt: { from: '', to: '' },
    })
  })

  it('matches Created and Last updated on local calendar days', () => {
    const created = MASTER_AUDIT_COLUMNS.find((c) => c.key === 'createdAt')
    const updated = MASTER_AUDIT_COLUMNS.find((c) => c.key === 'updatedAt')
    const row = {
      createdAt: '2026-09-11T12:00:00.000Z',
      updated_at: '2026-09-12T08:00:00.000Z',
    }
    const createdYmd = localYmd(new Date(row.createdAt))
    const updatedYmd = localYmd(new Date(row.updated_at))
    assert.equal(rowMatchesColumnFilter(row, created, { from: createdYmd, to: createdYmd }), true)
    assert.equal(rowMatchesColumnFilter(row, created, { from: '2099-01-01', to: '' }), false)
    assert.equal(rowMatchesColumnFilter(row, updated, { from: updatedYmd, to: updatedYmd }), true)
    assert.equal(rowMatchesColumnFilter({ createdAt: null }, created, { from: createdYmd, to: createdYmd }), false)
  })
})
