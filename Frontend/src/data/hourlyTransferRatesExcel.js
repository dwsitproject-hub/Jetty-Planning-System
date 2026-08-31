import ExcelJS from 'exceljs'
import { expandHourlyBucketsForDisplay, formatDisplayCargoQty } from '../utils/hourlyCargoDisplay.js'

export const HOURLY_TRANSFER_RATES_COLUMNS = [
  { key: 'jetty', label: 'Jetty' },
  { key: 'vesselName', label: 'Vessel name' },
  { key: 'clockHour', label: 'Clock hour' },
  { key: 'tank', label: 'Tank' },
  { key: 'moved', label: 'Moved' },
  { key: 'rate', label: 'Rate' },
  { key: 'status', label: 'Status' },
  { key: 'source', label: 'Source' },
]

const DEFAULT_STATUS_LABELS = {
  direction_mismatch: 'Reverse movement',
  flat_movement: 'Flat Movement',
  incomplete: 'Incomplete',
  active: 'Active',
}

const DEFAULT_SOURCE_LABELS = {
  atg: 'ATG',
  manual: 'Manual',
  hybrid: 'HYBRID',
}

function formatRateForExport(n, unit = 'MT') {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  return `${Number(n).toLocaleString('en-US', { maximumFractionDigits: 1 })} ${unit}/h`
}

export function formatHourlyStatusLabel(status, t) {
  if (status === 'direction_mismatch') {
    return t?.('cargoHourlyReverseMovement') ?? DEFAULT_STATUS_LABELS.direction_mismatch
  }
  if (status === 'flat_movement') {
    return t?.('cargoHourlyFlatMovement') ?? DEFAULT_STATUS_LABELS.flat_movement
  }
  if (status === 'incomplete') {
    return t?.('cargoHourlyIncomplete') ?? DEFAULT_STATUS_LABELS.incomplete
  }
  return t?.('cargoHourlyActive') ?? DEFAULT_STATUS_LABELS.active
}

export function formatHourlySourceLabel(source, t) {
  if (source === 'manual') {
    return t?.('cargoHourlySourceManual') ?? DEFAULT_SOURCE_LABELS.manual
  }
  if (source === 'atg') {
    return DEFAULT_SOURCE_LABELS.atg
  }
  if (source === 'hybrid') {
    return DEFAULT_SOURCE_LABELS.hybrid
  }
  return source ? String(source).toUpperCase() : '—'
}

/**
 * @param {object} opts
 * @param {string} [opts.jettyName]
 * @param {string} [opts.vesselName]
 * @param {Array<object>} [opts.hourlyBuckets]
 * @param {'Loading'|'Unloading'|string|null} [opts.purpose]
 * @param {string} [opts.unit]
 * @param {(key: string) => string} [opts.t]
 */
export function buildHourlyTransferRatesExportRows({
  jettyName = '',
  vesselName = '',
  hourlyBuckets = [],
  purpose = null,
  unit = 'MT',
  t,
}) {
  const jetty = String(jettyName || '').trim() || '—'
  const vessel = String(vesselName || '').trim() || '—'
  const rows = expandHourlyBucketsForDisplay(hourlyBuckets, purpose)
  return rows.map((row) => ({
    jetty,
    vesselName: vessel,
    clockHour: row.hourLabelLocal || row.hourStart || '—',
    tank: row.tankCode || '—',
    moved: formatDisplayCargoQty(row.tankDisplayQtyMoved, unit),
    rate: formatRateForExport(row.rateTph, unit),
    status: formatHourlyStatusLabel(row.movementStatus, t),
    source: formatHourlySourceLabel(row.source, t),
  }))
}

function sanitizeFilenamePart(value) {
  return String(value || 'export')
    .trim()
    .replace(/[^\w\s-]+/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 60) || 'export'
}

export function buildHourlyTransferRatesWorkbook(exportRows, meta = {}) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Jetty Planning System'
  const sheet = workbook.addWorksheet('Hourly transfer rates', { views: [{ showGridLines: true }] })

  let row = 1
  sheet.getCell(row, 1).value = 'Hourly transfer rates'
  sheet.getCell(row, 1).font = { bold: true, size: 14 }
  row += 1

  const metaParts = [
    meta.jettyName ? `Jetty: ${meta.jettyName}` : null,
    meta.vesselName ? `Vessel: ${meta.vesselName}` : null,
  ].filter(Boolean)
  if (metaParts.length) {
    sheet.getCell(row, 1).value = metaParts.join(' · ')
    sheet.getCell(row, 1).font = { italic: true }
    row += 1
  }
  row += 1

  const headerRow = row
  HOURLY_TRANSFER_RATES_COLUMNS.forEach((col, i) => {
    sheet.getCell(headerRow, i + 1).value = col.label
    sheet.getCell(headerRow, i + 1).font = { bold: true }
  })
  row += 1

  for (const dataRow of exportRows) {
    HOURLY_TRANSFER_RATES_COLUMNS.forEach((col, i) => {
      sheet.getCell(row, i + 1).value = dataRow[col.key] ?? '—'
    })
    row += 1
  }

  HOURLY_TRANSFER_RATES_COLUMNS.forEach((col, i) => {
    sheet.getColumn(i + 1).width = Math.min(32, Math.max(12, col.label.length + 4))
  })

  return workbook
}

/**
 * @param {object} opts - same as buildHourlyTransferRatesExportRows plus optional filenameParts
 */
export async function downloadHourlyTransferRatesExcel(opts) {
  const exportRows = buildHourlyTransferRatesExportRows(opts)
  if (!exportRows.length) {
    throw new Error('No hourly transfer rate rows to export')
  }

  const workbook = buildHourlyTransferRatesWorkbook(exportRows, {
    jettyName: opts.jettyName,
    vesselName: opts.vesselName,
  })
  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })

  const vesselPart = sanitizeFilenamePart(opts.vesselName)
  const datePart = new Date().toISOString().slice(0, 10)
  const filename = `HourlyTransferRates_${vesselPart}_${datePart}.xlsx`

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
