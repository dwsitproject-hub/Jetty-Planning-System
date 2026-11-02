/**
 * Cargo movement lines for one commodity shipment on the throughput modal.
 * Untagged lines count only when the call carries a single commodity.
 */
import { formatCargoLineTanksLabel } from './cargoProgressResolvers.js'
import { productKeyFromCommodity, productShortNamesFromVoyageRow } from './managementDashboardProduct.js'

function lineProductKey(line) {
  const label = String(line?.commodityShortName || line?.commodityName || '').trim()
  if (!label) return ''
  return productKeyFromCommodity(label)
}

function lineStart(line) {
  return line?.startedAt || line?.startAt || null
}

function lineEnd(line) {
  return line?.endedAt || line?.endAt || null
}

/**
 * @param {Array<object> | null | undefined} events activity-timeline events
 * @param {object} row commodity slice
 */
export function cargoMovementEntriesForSlice(events, row) {
  const want = productKeyFromCommodity(row?.productKey || row?.productLabel || '')
  const single = productShortNamesFromVoyageRow(row).length <= 1
  const lines = []
  for (const ev of Array.isArray(events) ? events : []) {
    if (ev?.milestoneKey !== 'cargo_operations') continue
    for (const line of ev.cargoLoadLines || []) {
      const key = lineProductKey(line)
      if (key) {
        if (key !== want) continue
      } else if (!single) {
        continue
      }
      lines.push(line)
    }
  }
  lines.sort((a, b) => String(lineStart(a) || '').localeCompare(String(lineStart(b) || '')))
  return lines.map((line, i) => {
    const startAt = lineStart(line)
    const endAt = lineEnd(line)
    const qtyNum = Number(line.qty)
    const qty = Number.isFinite(qtyNum) ? qtyNum : null
    let rate = null
    if (qty != null && startAt && endAt) {
      const hours = (new Date(endAt).getTime() - new Date(startAt).getTime()) / 3600000
      if (hours > 1e-9) rate = qty / hours
    }
    return {
      key: line.id != null ? String(line.id) : `entry-${i + 1}`,
      entry: i + 1,
      tank: formatCargoLineTanksLabel(line),
      startAt,
      endAt,
      inProgress: Boolean(startAt) && !endAt,
      qty,
      rate,
    }
  })
}
