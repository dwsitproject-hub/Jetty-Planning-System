import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyMovementCellStyle, movementKindOfLabel } from './movementExcelStyle.js'

test('the label decides the kind, and Mixed may list its palkas', () => {
  assert.equal(movementKindOfLabel('Normal'), 'normal')
  assert.equal(movementKindOfLabel('Kuras'), 'kuras')
  assert.equal(movementKindOfLabel('Mixed (1B, 2A)'), 'mixed')
  assert.equal(movementKindOfLabel('Campuran'), 'mixed')
  assert.equal(movementKindOfLabel('—'), null)
})

test('a movement cell gets a fill and font; other cells are left alone', () => {
  const cell = {}
  applyMovementCellStyle(cell, 'Mixed (1B)')
  assert.equal(cell.fill.fgColor.argb, 'FFFFEDD5')
  assert.equal(cell.font.bold, true)
  const other = {}
  applyMovementCellStyle(other, '—')
  assert.deepEqual(other, {})
})
