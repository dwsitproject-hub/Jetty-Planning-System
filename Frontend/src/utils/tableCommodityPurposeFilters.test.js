import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  PURPOSE_FILTER_OPTIONS,
  commodityShortNamesFromRow,
  uniqueCommodityShortOptions,
  rowMatchesCommodityShort,
  groupMatchesCommodityShort,
  rowMatchesPurpose,
  groupMatchesPurpose,
  groupMatchesExactLabel,
} from './tableCommodityPurposeFilters.js'

describe('commodity short name filters', () => {
  it('collects unique short names from display and breakdown', () => {
    const names = commodityShortNamesFromRow({
      commodityShortDisplay: 'CPO · PKM',
      cargoBreakdownSummary: [{ commodityShortName: 'FAME' }],
    })
    assert.deepEqual(names.sort(), ['CPO', 'FAME', 'PKM'])
  })

  it('matches a selected short name without dropping other qty lines', () => {
    const row = { commodityShortDisplay: 'CPO · PKM', totalQtyDisplay: 'CPO 4.000 MT\nPKM 1.000 MT' }
    assert.equal(rowMatchesCommodityShort(row, 'CPO'), true)
    assert.equal(rowMatchesCommodityShort(row, 'FAME'), false)
    assert.equal(rowMatchesCommodityShort(row, ''), true)
    assert.equal(row.totalQtyDisplay.includes('PKM'), true)
  })

  it('falls back to qty line labels when short display is missing', () => {
    const row = { totalQtyDisplay: 'CPO 4.000 MT\nPKM 1.000 MT' }
    assert.deepEqual(commodityShortNamesFromRow(row).sort(), ['CPO', 'PKM'])
    assert.equal(rowMatchesCommodityShort(row, 'PKM'), true)
  })

  it('reads nested shipping instruction qty and breakdown', () => {
    const plan = {
      shippingInstructions: [
        { commodityQtyDisplay: 'CPO 4.000 MT', breakdown: [{ commodityShortName: 'CPO' }] },
        { commodityQtyDisplay: 'PKM 1.000 MT' },
      ],
    }
    assert.deepEqual(commodityShortNamesFromRow(plan).sort(), ['CPO', 'PKM'])
    assert.equal(rowMatchesCommodityShort(plan, 'CPO'), true)
    assert.equal(rowMatchesCommodityShort(plan, 'FAME'), false)
  })

  it('reads planQueueSiEntries short display', () => {
    const row = {
      planQueueSiEntries: [
        { commodityShortDisplay: 'CPO', totalQtyDisplay: 'CPO 4.000 MT' },
        { commodityShortDisplay: 'CPKO', totalQtyDisplay: 'CPKO 500 MT' },
      ],
    }
    assert.equal(rowMatchesCommodityShort(row, 'CPO'), true)
    assert.equal(rowMatchesCommodityShort(row, 'CPKO'), true)
    assert.equal(rowMatchesCommodityShort(row, 'COAL'), false)
  })

  it('keeps a mixed group when any child matches CPO', () => {
    const children = [
      { commodityShortDisplay: 'CPO', totalQtyDisplay: 'CPO 4.195,52 MT' },
      { commodityShortDisplay: 'CPKO', totalQtyDisplay: 'CPKO 504,1 MT' },
    ]
    assert.equal(groupMatchesCommodityShort(children, 'CPO'), true)
    assert.equal(groupMatchesCommodityShort(children, 'COAL'), false)
    assert.equal(groupMatchesCommodityShort(children, ''), true)
  })

  it('sorts dropdown options from all rows', () => {
    assert.deepEqual(
      uniqueCommodityShortOptions([
        { commodityShortDisplay: 'PKM' },
        { commodityShortDisplay: 'CPO' },
        { commodityShortDisplay: 'CPO' },
      ]),
      ['CPO', 'PKM'],
    )
  })
})

describe('purpose filters', () => {
  it('exposes Loading and Unloading', () => {
    assert.deepEqual(PURPOSE_FILTER_OPTIONS, ['Loading', 'Unloading'])
  })

  it('matches purposeCode via resolvePurposeLabel', () => {
    assert.equal(rowMatchesPurpose({ purposeCode: 'Loading' }, 'Loading'), true)
    assert.equal(rowMatchesPurpose({ purposeCode: 'Unloading' }, 'Loading'), false)
    assert.equal(rowMatchesPurpose({ purpose: 'unloading' }, 'Unloading'), true)
    assert.equal(rowMatchesPurpose({ loadDischarge: 'LOAD' }, 'Loading'), true)
    assert.equal(rowMatchesPurpose({ purpose: 'Loading' }, ''), true)
  })

  it('rejects mixed-purpose groups unless All is selected', () => {
    const mixed = [{ purpose: 'Loading' }, { purpose: 'Unloading' }]
    assert.equal(groupMatchesPurpose(mixed, 'Loading'), false)
    assert.equal(groupMatchesPurpose(mixed, ''), true)
    assert.equal(groupMatchesPurpose([{ purpose: 'Loading' }, { purpose: 'Loading' }], 'Loading'), true)
  })

  it('rejects mixed exact labels unless All is selected', () => {
    const mixed = [{ status: 'DOCKED' }, { status: 'IN_PROGRESS' }]
    assert.equal(groupMatchesExactLabel(mixed, 'DOCKED', (c) => c.status), false)
    assert.equal(groupMatchesExactLabel(mixed, '', (c) => c.status), true)
    assert.equal(groupMatchesExactLabel([{ status: 'DOCKED' }, { status: 'DOCKED' }], 'DOCKED', (c) => c.status), true)
  })
})
