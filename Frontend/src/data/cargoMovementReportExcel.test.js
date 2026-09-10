import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildCargoMovementReportWorkbook } from './cargoMovementReportExcel.js'

describe('cargoMovementReportExcel', () => {
  it('stacks header fields and hourly rows per operation', () => {
    const workbook = buildCargoMovementReportWorkbook(
      [
        {
          vesselName: 'MT SUKSES JAYA',
          header: {
            planRef: 'SP-26-09-00021',
            shippingInstruction: 'SI-2026-0042',
            jettyOperationId: 'LD-26-09-0042',
            commodity: 'CPO',
            quantity: '5000 MT',
            purpose: 'Unloading',
          },
          purpose: 'Unloading',
          unit: 'MT',
          hourlyBuckets: [
            {
              hourStart: '2026-08-28T00:00:00.000Z',
              hourEnd: '2026-08-28T01:00:00.000Z',
              movementStatus: 'active',
              source: 'atg',
              tankDetail: [{ code: '5102', qtyMoved: 57.82, displayQtyMoved: 57.82 }],
              rateTph: 57.8,
            },
          ],
        },
        {
          vesselName: 'MT SUKSES JAYA',
          header: {
            planRef: 'SP-26-08-00010',
            shippingInstruction: 'SI-OTHER',
            jettyOperationId: 'LD-26-08-0010',
            commodity: 'CPO',
            quantity: '1000 MT',
            purpose: 'Loading',
          },
          purpose: 'Loading',
          unit: 'MT',
          hourlyBuckets: [],
        },
      ],
      { lookup: 'SUKSES' }
    )

    const sheet = workbook.getWorksheet('Cargo Movement Report')
    assert.ok(sheet)
    assert.equal(sheet.getCell(1, 1).value, 'Cargo Movement Report')
    assert.match(String(sheet.getCell(2, 1).value), /Lookup: SUKSES/)

    const values = []
    sheet.eachRow((row) => {
      values.push(String(row.getCell(1).value || ''))
    })
    assert.ok(values.includes('MT SUKSES JAYA'))
    assert.ok(values.includes('Plan Ref'))
    assert.ok(values.includes('Jetty Operation ID'))
    assert.ok(values.includes('Hourly transfer rates'))
    assert.ok(values.includes('Clock hour'))
    assert.ok(values.includes('No hourly transfer rate rows for this operation.'))

    let hourlyHeader = null
    sheet.eachRow((row) => {
      if (row.getCell(1).value === 'Clock hour') hourlyHeader = row
    })
    assert.ok(hourlyHeader)
    assert.equal(hourlyHeader.getCell(2).value, 'Tank')
    assert.equal(hourlyHeader.getCell(3).value, 'Moved')
    assert.equal(hourlyHeader.getCell(6).value, 'Source')
    assert.equal(hourlyHeader.getCell(7).value, null)
  })
})
