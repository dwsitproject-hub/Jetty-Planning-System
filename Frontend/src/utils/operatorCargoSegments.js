import { milestoneKeyToLabel } from '../data/operationalMilestones'
import { formatQtyNumber } from './cargoQtyDisplay'

function resolveSegmentTankIds(line, entry) {
  if (Array.isArray(line.tankIds) && line.tankIds.length) {
    return line.tankIds.map(String).filter(Boolean)
  }
  if (Array.isArray(line.tanks) && line.tanks.length) {
    return line.tanks.map((t) => String(t.id)).filter(Boolean)
  }
  const lineCount = (entry.cargoLoadLines || []).length
  if (lineCount === 1) {
    const entryTankIds = entry.tankIds || (entry.tanks || []).map((t) => t.id)
    if (Array.isArray(entryTankIds) && entryTankIds.length) {
      return entryTankIds.map(String).filter(Boolean)
    }
  }
  return []
}

function segmentShowsHourly({ tankIds, atgQtyMode, commodityType, tankOptions }) {
  if (commodityType !== 'Liquid') return false
  if (!tankIds?.length) return false
  if (atgQtyMode === 'manual') return false
  const meta = new Map((tankOptions || []).map((t) => [String(t.id), t]))
  return tankIds.some((id) => meta.get(String(id))?.hasAtg)
}

/**
 * Flatten cargo_operations activity entries into operator-facing segment rows.
 * @param {Array} activities
 * @param {'Loading'|'Unloading'} purpose
 * @param {{ commodityType?: string, tankOptions?: Array<{ id: string, hasAtg?: boolean }> }} [opts]
 */
export function buildOperatorCargoSegments(activities, purpose, opts = {}) {
  const { commodityType = 'Liquid', tankOptions = [] } = opts
  const label = milestoneKeyToLabel('cargo_operations', purpose)
  const rows = (activities || []).filter((a) => a.category === label)
  const segments = []
  let segmentNum = 0

  for (const entry of rows) {
    const lines = entry.cargoLoadLines || []
    lines.forEach((line, lineIndex) => {
      if (!line.startAt) return
      segmentNum += 1
      const tankCodes = (line.tanks || []).map((t) => t.code || t.name).filter(Boolean)
      const tankIds = resolveSegmentTankIds(line, entry)
      const atgQtyMode = line.atgQtyMode === 'manual' ? 'manual' : 'auto'
      const loadLineId = line.id != null && String(line.id) !== '' ? String(line.id) : null
      const clientKey = loadLineId ?? `${entry.id}-${lineIndex}`
      const qty = Number(line.qty)
      segments.push({
        segmentNum,
        entryId: entry.id,
        lineIndex,
        clientKey,
        loadLineId,
        startAt: line.startAt,
        endAt: line.endAt || null,
        isOpen: Boolean(line.startAt && !line.endAt),
        tankCodes,
        tankIds,
        atgQtyMode,
        showHourly: segmentShowsHourly({ tankIds, atgQtyMode, commodityType, tankOptions }),
        qtyLabel: Number.isFinite(qty) && qty > 0 ? `${formatQtyNumber(qty)} MT` : null,
      })
    })
  }

  return segments
}
