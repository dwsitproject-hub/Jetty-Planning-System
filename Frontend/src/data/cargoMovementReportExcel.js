import ExcelJS from 'exceljs'
import { CARGO_MOVEMENT_HEADER_FIELDS, CARGO_MOVEMENT_HOURLY_COLUMNS } from './cargoMovementReportFromApi.js'
import { buildHourlyTransferRatesExportRows } from './hourlyTransferRatesExcel.js'

function sanitizeFilenamePart(value) {
  return (
    String(value || 'export')
      .trim()
      .replace(/[^\w\s-]+/g, '')
      .replace(/\s+/g, '_')
      .slice(0, 60) || 'export'
  )
}

/**
 * One sheet, stacked blocks: vessel title, header pairs, hourly table.
 */
export function buildCargoMovementReportWorkbook(blocks, meta = {}) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Jetty Planning System'
  const sheet = workbook.addWorksheet('Cargo Movement Report', { views: [{ showGridLines: true }] })

  let row = 1
  sheet.getCell(row, 1).value = 'Cargo Movement Report'
  sheet.getCell(row, 1).font = { bold: true, size: 14 }
  row += 1

  const metaParts = [
    meta.lookup ? `Lookup: ${meta.lookup}` : null,
    meta.startDate && meta.endDate ? `Date range: ${meta.startDate} to ${meta.endDate}` : null,
  ].filter(Boolean)
  if (metaParts.length) {
    sheet.getCell(row, 1).value = metaParts.join(' · ')
    sheet.getCell(row, 1).font = { italic: true }
    row += 1
  }
  row += 1

  for (const block of Array.isArray(blocks) ? blocks : []) {
    sheet.getCell(row, 1).value = block.vesselName || '—'
    sheet.getCell(row, 1).font = { bold: true, size: 12 }
    row += 1

    sheet.getCell(row, 1).value = 'Header'
    sheet.getCell(row, 1).font = { bold: true }
    row += 1

    for (const field of CARGO_MOVEMENT_HEADER_FIELDS) {
      sheet.getCell(row, 1).value = field.label
      sheet.getCell(row, 2).value = block.header?.[field.key] ?? '—'
      row += 1
    }
    row += 1

    sheet.getCell(row, 1).value = 'Hourly transfer rates'
    sheet.getCell(row, 1).font = { bold: true }
    row += 1

    const hourlyRows = buildHourlyTransferRatesExportRows({
      vesselName: block.vesselName,
      hourlyBuckets: block.hourlyBuckets || [],
      purpose: block.purpose,
      unit: block.unit || 'MT',
      t: meta.t,
    })

    CARGO_MOVEMENT_HOURLY_COLUMNS.forEach((col, i) => {
      sheet.getCell(row, i + 1).value = col.label
      sheet.getCell(row, i + 1).font = { bold: true }
    })
    row += 1

    if (hourlyRows.length === 0) {
      sheet.getCell(row, 1).value = 'No hourly transfer rate rows for this operation.'
      row += 1
    } else {
      for (const dataRow of hourlyRows) {
        CARGO_MOVEMENT_HOURLY_COLUMNS.forEach((col, i) => {
          sheet.getCell(row, i + 1).value = dataRow[col.key] ?? '—'
        })
        row += 1
      }
    }
    row += 1
  }

  sheet.getColumn(1).width = 28
  sheet.getColumn(2).width = 28
  sheet.getColumn(3).width = 16
  sheet.getColumn(4).width = 16
  sheet.getColumn(5).width = 18
  sheet.getColumn(6).width = 14

  return workbook
}

export async function downloadCargoMovementReportExcel(blocks, meta = {}) {
  const workbook = buildCargoMovementReportWorkbook(blocks, meta)
  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const lookupPart = sanitizeFilenamePart(meta.lookup)
  const datePart = new Date().toISOString().slice(0, 10)
  const filename = `CargoMovementReport_${lookupPart}_${datePart}.xlsx`
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
