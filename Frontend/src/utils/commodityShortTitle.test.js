import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  commodityDropdownLabel,
  commodityDropdownOptions,
  commodityPickerOptions,
} from './commodityShortTitle.js'

describe('commodity dropdown label', () => {
  it('shows material code and short name', () => {
    assert.equal(
      commodityDropdownLabel({ materialCode: '8010-10.11101', shortName: 'CPO', name: 'CRUDE PALM OIL' }),
      '8010-10.11101 - CPO'
    )
  })

  it('falls back to the long name when the short name is empty', () => {
    assert.equal(
      commodityDropdownLabel({ materialCode: '8010-10.11102', shortName: '', name: 'CRUDE PALM OIL FFA 3.5-5' }),
      '8010-10.11102 - CRUDE PALM OIL FFA 3.5-5'
    )
  })

  it('shows the short name when material code is empty', () => {
    assert.equal(commodityDropdownLabel({ materialCode: '', shortName: 'CPO', name: 'CRUDE PALM OIL' }), 'CPO')
  })

  it('shows the long name when material code and short name are empty', () => {
    assert.equal(commodityDropdownLabel({ materialCode: '', shortName: '', name: 'CRUDE PALM OIL' }), 'CRUDE PALM OIL')
  })

  it('keeps a saved inactive commodity and hides other inactive rows', () => {
    const options = commodityDropdownOptions(
      [
        { id: 1, name: 'CRUDE PALM OIL', shortName: 'CPO', materialCode: '8010-10.11101', isActive: true },
        { id: 2, name: 'Old Product', shortName: 'OLD', materialCode: '999', isActive: false },
      ],
      { commodityId: '3', commodityShortName: 'RET', commodityName: 'Retired Oil', materialCode: '300' }
    )
    assert.deepEqual(
      options.map((c) => c.id),
      [1, '3']
    )
    assert.equal(commodityDropdownLabel(options[1]), '300 - RET')
  })

  it('search keywords include the long name when the label uses the short name', () => {
    const [option] = commodityPickerOptions(
      [{ id: 1, name: 'CRUDE PALM OIL', shortName: 'CPO', materialCode: '8010-10.11101', isActive: true }],
      null
    )
    assert.equal(option.label, '8010-10.11101 - CPO')
    assert.match(option.keywords, /CRUDE PALM OIL/)
    assert.match(option.keywords, /CPO/)
  })
})
