import ExcelJS from 'exceljs'
import { buildVesselReasonMatrix, reportReasonLabel } from '../utils/noFlowReportView.js'

const PHASE_LABEL = { before: 'Before cargo', during: 'During cargo', after: 'After cargo', mixed: 'Several phases' }
const CATEGORY_LABEL = { terminal: 'Terminal', vessel: 'Vessel', kuras_crew: 'Kuras crew', external: 'External', other: 'Other', unexplained: 'No reason yet' }

const bold = { bold: true }

/**
 * Two sheets: vessel by reason hours (fleet table) and every stop of the period.
 * @param {object} report API result of /no-flow-report
 * @param {{ language?: string, purpose?: string|null }} meta
 */
export function buildNoFlowReportWorkbook(report, meta = {}) {
  const language = meta.language || 'en'
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Jetty Planning System'

  const m = buildVesselReasonMatrix(report, language)
  const fleet = wb.addWorksheet('Vessel by reason')
  fleet.getCell(1, 1).value = 'Stops and delays by vessel (hours)'
  fleet.getCell(1, 1).font = { bold: true, size: 14 }
  const period = `${report.range.from.slice(0, 10)} to ${report.range.to.slice(0, 10)}`
  fleet.getCell(2, 1).value = [period, meta.purpose ? `Purpose: ${meta.purpose}` : null].filter(Boolean).join(' · ')
  fleet.getCell(2, 1).font = { italic: true }
  const head = ['No', 'Vessel', 'Jetty', ...m.columns.map((c) => c.label), 'Total (H)']
  head.forEach((h, i) => {
    const cell = fleet.getCell(4, i + 1)
    cell.value = h
    cell.font = bold
  })
  m.rows.forEach((r, i) => {
    const values = [i + 1, r.vessel || '', r.jetty || '', ...m.columns.map((c) => r.cells[c.code] ?? null), r.total]
    values.forEach((v, j) => { fleet.getCell(5 + i, j + 1).value = v })
  })
  const totalRow = 5 + m.rows.length
  const totals = ['', 'TOTAL', '', ...m.columns.map((c) => c.total), m.grandTotal]
  totals.forEach((v, j) => {
    const cell = fleet.getCell(totalRow, j + 1)
    cell.value = v
    cell.font = bold
  })

  const list = wb.addWorksheet('All stops')
  const cols = ['Vessel', 'Jetty', 'Start', 'End', 'Hours', 'When', 'Who caused it', 'Reason', 'Note', 'Found by']
  cols.forEach((h, i) => {
    const cell = list.getCell(1, i + 1)
    cell.value = h
    cell.font = bold
  })
  report.stops.forEach((s, i) => {
    const values = [
      s.vessel || '', s.jetty || '', s.startedAt.slice(0, 16).replace('T', ' '), s.endedAt ? s.endedAt.slice(0, 16).replace('T', ' ') : 'in progress',
      s.hours, PHASE_LABEL[s.phase] || s.phase, CATEGORY_LABEL[s.category] || s.category, reportReasonLabel(s, language), s.note || '', s.source,
    ]
    values.forEach((v, j) => { list.getCell(2 + i, j + 1).value = v })
  })
  return wb
}

export async function downloadNoFlowReportExcel(report, meta = {}) {
  const wb = buildNoFlowReportWorkbook(report, meta)
  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `StopsAndDelays_${report.range.from.slice(0, 10)}_${report.range.to.slice(0, 10)}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}
