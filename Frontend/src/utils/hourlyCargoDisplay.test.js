import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyCargoMovementSign,
  expandHourlyBucketsForDisplay,
  formatSignedCargoQty,
  normalizeTankDetail,
} from './hourlyCargoDisplay.js'

describe('normalizeTankDetail', () => {
  it('accepts array or legacy tanks wrapper', () => {
    assert.equal(normalizeTankDetail([{ code: '5102' }]).length, 1)
    assert.equal(normalizeTankDetail({ tanks: [{ code: '5103' }] }).length, 1)
    assert.equal(normalizeTankDetail(null).length, 0)
  })
})

describe('applyCargoMovementSign', () => {
  it('returns positive for Unloading and negative for Loading', () => {
    assert.equal(applyCargoMovementSign(86.69, 'Unloading'), 86.69)
    assert.equal(applyCargoMovementSign(50, 'Loading'), -50)
  })
})

describe('formatSignedCargoQty', () => {
  it('formats with explicit plus for unloading', () => {
    assert.equal(formatSignedCargoQty(86.69, 'Unloading', 'MT'), '+86.69 MT')
    assert.equal(formatSignedCargoQty(50, 'Loading', 'MT'), '-50 MT')
  })
})

describe('expandHourlyBucketsForDisplay', () => {
  it('creates one row per tank when tankDetail present', () => {
    const rows = expandHourlyBucketsForDisplay([
      {
        hourStart: '2026-08-28T14:00:00.000Z',
        hourEnd: '2026-08-28T15:00:00.000Z',
        hourLabelLocal: '28/08 21:00–22:00 GMT+8',
        qtyMoved: 99,
        rateTph: 99,
        movementStatus: 'active',
        source: 'atg',
        tankDetail: [
          { tankId: '1', code: '5102', qtyMoved: 86.69 },
          { tankId: '2', code: '5103', qtyMoved: 12.4 },
        ],
      },
    ])
    assert.equal(rows.length, 2)
    assert.equal(rows[0].tankCode, '5102')
    assert.equal(rows[0].tankQtyMoved, 86.69)
    assert.equal(rows[1].tankCode, '5103')
  })

  it('falls back to single row without tank detail', () => {
    const rows = expandHourlyBucketsForDisplay([
      {
        hourStart: '2026-08-28T14:00:00.000Z',
        hourEnd: '2026-08-28T15:00:00.000Z',
        qtyMoved: 50,
        rateTph: 50,
        movementStatus: 'active',
        source: 'manual',
      },
    ])
    assert.equal(rows.length, 1)
    assert.equal(rows[0].tankCode, '—')
    assert.equal(rows[0].tankQtyMoved, 50)
  })
})
