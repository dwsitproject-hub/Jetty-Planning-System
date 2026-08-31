import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildHourlyTransferRatesExportRows,
  formatHourlySourceLabel,
  formatHourlyStatusLabel,
} from './hourlyTransferRatesExcel.js'

describe('hourlyTransferRatesExcel', () => {
  it('buildHourlyTransferRatesExportRows expands tank rows with requested columns', () => {
    const rows = buildHourlyTransferRatesExportRows({
      jettyName: '01',
      vesselName: 'BG MEL 02',
      purpose: 'Unloading',
      unit: 'MT',
      hourlyBuckets: [
        {
          hourStart: '2026-08-28T00:00:00.000Z',
          hourLabelLocal: '28/08 00:00–01:00 GMT+8',
          movementStatus: 'active',
          source: 'atg',
          tankDetail: [
            {
              code: '5102',
              qtyMoved: 57.82,
              displayQtyMoved: 57.82,
            },
          ],
          rateTph: 57.8,
        },
      ],
    })

    assert.equal(rows.length, 1)
    assert.equal(rows[0].jetty, '01')
    assert.equal(rows[0].vesselName, 'BG MEL 02')
    assert.equal(rows[0].clockHour, '28/08 00:00–01:00 GMT+8')
    assert.equal(rows[0].tank, '5102')
    assert.equal(rows[0].moved, '+57.82 MT')
    assert.equal(rows[0].rate, '57.8 MT/h')
    assert.equal(rows[0].status, 'Active')
    assert.equal(rows[0].source, 'ATG')
  })

  it('formatHourlyStatusLabel maps movement statuses', () => {
    assert.equal(formatHourlyStatusLabel('flat_movement'), 'Flat Movement')
    assert.equal(formatHourlyStatusLabel('direction_mismatch'), 'Reverse movement')
  })

  it('formatHourlySourceLabel maps source values', () => {
    assert.equal(formatHourlySourceLabel('manual'), 'Manual')
    assert.equal(formatHourlySourceLabel('hybrid'), 'HYBRID')
  })
})
