import ExcelJS from 'exceljs'

const COLUMNS = [
  { key: 'jetty', label: 'Jetty' },
  { key: 'vessel', label: 'Vessel' },
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

function formatDateTimeForExcel(value) {
  if (!value || !String(value).trim()) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
}

export function buildJettyVesselReportWorkbook(rows, startDate, endDate) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Jetty Planning System'
  const sheet = workbook.addWorksheet('Jetty - Vessel Report', { views: [{ showGridLines: true }] })

  let row = 1
  sheet.getCell(row, 1).value = 'Jetty - Vessel Report'
  sheet.getCell(row, 1).font = { bold: true, size: 14 }
  row += 1
  if (startDate && endDate) {
    sheet.getCell(row, 1).value = `Date range: ${startDate} to ${endDate}`
    sheet.getCell(row, 1).font = { italic: true }
    row += 1
  }
  row += 1

  const headerRow = row
  COLUMNS.forEach((col, i) => {
    sheet.getCell(headerRow, i + 1).value = col.label
    sheet.getCell(headerRow, i + 1).font = { bold: true }
  })
  row += 1

  const dateKeys = ['eta', 'arrivalDateTime', 'etb', 'berthedDateTime', 'sailedOffDateTime']
  rows.forEach((r) => {
    COLUMNS.forEach((col, i) => {
      let val = r[col.key] ?? '—'
      if (dateKeys.includes(col.key) && val && val !== '—') {
        val = formatDateTimeForExcel(val)
      }
      sheet.getCell(row, i + 1).value = val
    })
    row += 1
  })

  COLUMNS.forEach((_, i) => {
    sheet.getColumn(i + 1).width = Math.min(24, Math.max(12, COLUMNS[i].label.length + 2))
  })

  return workbook
}

export async function downloadJettyVesselReportExcel(rows, startDate, endDate) {
  const workbook = buildJettyVesselReportWorkbook(rows, startDate, endDate)
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
