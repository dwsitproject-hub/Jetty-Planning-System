import ExcelJS from 'exceljs'

const DETAIL_COLUMNS = [
  { key: 'jetty', label: 'Jetty' },
  { key: 'shippingInstruction', label: 'SI / Ref' },
  { key: 'vessel', label: 'Vessel' },
  { key: 'purpose', label: 'Purpose' },
  { key: 'eta', label: 'ETA' },
  { key: 'arrivalDateTime', label: 'Arrival Date Time' },
  { key: 'etb', label: 'ETB' },
  { key: 'berthedDateTime', label: 'Berthed Date Time' },
  { key: 'sailedOffDateTime', label: 'Sailed off Date Time' },
  { key: 'commodity', label: 'Commodity' },
  { key: 'quantity', label: 'Quantity' },
  { key: 'stowage', label: 'Stowage' },
  { key: 'loadPort', label: 'Load port' },
  { key: 'dischPort', label: 'Disch port' },
  { key: 'shipper', label: 'Shipper' },
  { key: 'consignee', label: 'Consignee' },
  { key: 'surveyor', label: 'Surveyor' },
  { key: 'agent', label: 'Agent' },
]

const DETAIL_COLS = DETAIL_COLUMNS

const DATE_KEYS = ['eta', 'arrivalDateTime', 'etb', 'berthedDateTime', 'sailedOffDateTime']

function formatDateTimeForExcel(value) {
  if (!value || !String(value).trim()) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
}

function writeSummarySheet(sheet, summary, startDate, endDate) {
  let row = 1
  sheet.getCell(row, 1).value = 'Jetty utilization (summary)'
  sheet.getCell(row, 1).font = { bold: true, size: 14 }
  row += 1
  if (startDate && endDate) {
    sheet.getCell(row, 1).value = `Date range: ${startDate} to ${endDate}`
    sheet.getCell(row, 1).font = { italic: true }
    row += 1
  }
  row += 1

  const headers = ['Jetty', 'Calls', 'Berth hours', 'Utilization %']
  headers.forEach((h, i) => {
    sheet.getCell(row, i + 1).value = h
    sheet.getCell(row, i + 1).font = { bold: true }
  })
  row += 1

  for (const j of summary?.byJetty || []) {
    sheet.getCell(row, 1).value = j.jettyName ?? '—'
    sheet.getCell(row, 2).value = j.calls ?? 0
    sheet.getCell(row, 3).value = j.berthHoursRounded ?? 0
    sheet.getCell(row, 4).value = j.utilizationPct ?? 0
    row += 1
  }

  sheet.getColumn(1).width = 28
  sheet.getColumn(2).width = 10
  sheet.getColumn(3).width = 22
  sheet.getColumn(4).width = 14
}

function writeDetailSheet(sheet, rows, startDate, endDate) {
  let row = 1
  sheet.getCell(row, 1).value = 'Jetty – Vessel detail'
  sheet.getCell(row, 1).font = { bold: true, size: 14 }
  row += 1
  if (startDate && endDate) {
    sheet.getCell(row, 1).value = `Date range: ${startDate} to ${endDate}`
    sheet.getCell(row, 1).font = { italic: true }
    row += 1
  }
  row += 1

  const headerRow = row
  DETAIL_COLS.forEach((col, i) => {
    sheet.getCell(headerRow, i + 1).value = col.label
    sheet.getCell(headerRow, i + 1).font = { bold: true }
  })
  row += 1

  rows.forEach((r) => {
    DETAIL_COLS.forEach((col, i) => {
      let val = r[col.key] ?? '—'
      if (DATE_KEYS.includes(col.key) && val && val !== '—') {
        val = formatDateTimeForExcel(val)
      }
      sheet.getCell(row, i + 1).value = val
    })
    row += 1
  })

  DETAIL_COLS.forEach((col, i) => {
    sheet.getColumn(i + 1).width = Math.min(26, Math.max(11, col.label.length + 2))
  })
}

/**
 * @param {object|null} summary - from computeJettyUtilizationSummary
 * @param {Array} rows - detail rows
 */
export function buildJettyVesselReportWorkbook(summary, rows, startDate, endDate) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Jetty Planning System'

  const sumSheet = workbook.addWorksheet('Summary', { views: [{ showGridLines: true }] })
  writeSummarySheet(sumSheet, summary, startDate, endDate)

  const detailSheet = workbook.addWorksheet('Detail', { views: [{ showGridLines: true }] })
  writeDetailSheet(detailSheet, rows, startDate, endDate)

  return workbook
}

export async function downloadJettyVesselReportExcel(summary, rows, startDate, endDate) {
  const workbook = buildJettyVesselReportWorkbook(summary, rows, startDate, endDate)
  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const filename = `JettyVesselReport_${startDate || 'start'}_to_${endDate || 'end'}.xlsx`
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
