import ExcelJS from 'exceljs'
import { formatDateTimeDisplay } from '../utils/formatDateTimeDisplay.js'

const HEADER_FIELDS = [
  { key: 'jetty', label: 'Jetty' },
  { key: 'vessel', label: 'Vessel' },
  { key: 'commodity', label: 'Commodity' },
  { key: 'quantity', label: 'Quantity' },
  { key: 'stowage', label: 'Stowage' },
  { key: 'loadPort', label: 'Load port' },
  { key: 'dischPort', label: 'Disch port' },
  { key: 'shipper', label: 'Shipper' },
  { key: 'consignee', label: 'Consignee' },
  { key: 'surveyor', label: 'Surveyor' },
  { key: 'agent', label: 'Agent' },
  { key: 'demurrageLiabilityFrom', label: 'Demurrage liability from' },
  { key: 'operationStatus', label: 'Operation status' },
]

function headerCellValue(key, header) {
  const raw = header[key]
  if (key === 'demurrageLiabilityFrom') return formatDateTimeDisplay(raw)
  return raw ?? '—'
}

/**
 * Build an ExcelJS workbook for the Daily Activities Report.
 * One sheet, stacked blocks per operation: Header table, Timelog table.
 */
export function buildDailyActivitiesReportWorkbook(reportVessels, startDate, endDate) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Jetty Planning System'
  const sheet = workbook.addWorksheet('Daily Activities Report', { views: [{ showGridLines: true }] })

  let row = 1

  sheet.getCell(row, 1).value = 'Daily Activities Report'
  sheet.getCell(row, 1).font = { bold: true, size: 14 }
  row += 1

  if (startDate && endDate) {
    sheet.getCell(row, 1).value = `Date range: ${startDate} to ${endDate}`
    sheet.getCell(row, 1).font = { italic: true }
    row += 1
  }
  row += 1

  for (const { vesselName, header, timelog } of reportVessels) {
    sheet.getCell(row, 1).value = `Operation: ${vesselName}`
    sheet.getCell(row, 1).font = { bold: true }
    row += 1

    sheet.getCell(row, 1).value = 'Header'
    sheet.getCell(row, 1).font = { bold: true }
    row += 1
    HEADER_FIELDS.forEach(({ key, label }) => {
      sheet.getCell(row, 1).value = label
      sheet.getCell(row, 2).value = headerCellValue(key, header)
      row += 1
    })
    row += 1

    sheet.getCell(row, 1).value = 'Timelog'
    sheet.getCell(row, 1).font = { bold: true }
    row += 1
    sheet.getCell(row, 1).value = 'Activity Category'
    sheet.getCell(row, 2).value = 'Remark'
    sheet.getCell(row, 3).value = 'Status'
    sheet.getCell(row, 4).value = 'Date time'
    sheet.getCell(row, 5).value = 'End Date time'
    sheet.getRow(row).font = { bold: true }
    row += 1
    if (timelog.length === 0) {
      sheet.getCell(row, 1).value = 'No timelog entries.'
      row += 1
    } else {
      timelog.forEach((entry) => {
        sheet.getCell(row, 1).value = entry.category || '—'
        sheet.getCell(row, 2).value = entry.remark || '—'
        sheet.getCell(row, 3).value = entry.status || '—'
        sheet.getCell(row, 4).value = formatDateTimeDisplay(entry.dateTime)
        sheet.getCell(row, 5).value = formatDateTimeDisplay(entry.endDateTime)
        row += 1
      })
    }
    row += 1
  }

  sheet.getColumn(1).width = 28
  sheet.getColumn(2).width = 28
  sheet.getColumn(3).width = 14
  sheet.getColumn(4).width = 20
  sheet.getColumn(5).width = 20

  return workbook
}

/**
 * Generate and download the Daily Activities Report as .xlsx.
 * @param {Array} reportVessels - blocks from buildSingleOperationReportBlock (header + timelog)
 * @param {string} startDate - e.g. '2026-03-01'
 * @param {string} endDate - e.g. '2026-03-07'
 */
export async function downloadDailyActivitiesReportExcel(reportVessels, startDate, endDate) {
  const workbook = buildDailyActivitiesReportWorkbook(reportVessels, startDate, endDate)
  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const filename = `DailyActivitiesReport_${startDate || 'start'}_to_${endDate || 'end'}.xlsx`
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
