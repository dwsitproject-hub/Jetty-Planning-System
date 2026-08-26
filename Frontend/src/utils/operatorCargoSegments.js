import { milestoneKeyToLabel } from '../data/operationalMilestones'
import { formatQtyNumber } from './cargoQtyDisplay'

/**
 * Flatten cargo_operations activity entries into operator-facing segment rows.
 * @param {Array} activities
 * @param {'Loading'|'Unloading'} purpose
 */
export function buildOperatorCargoSegments(activities, purpose) {
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
      const qty = Number(line.qty)
      segments.push({
        segmentNum,
        entryId: entry.id,
        lineIndex,
        startAt: line.startAt,
        endAt: line.endAt || null,
        isOpen: Boolean(line.startAt && !line.endAt),
        tankCodes,
        qtyLabel: Number.isFinite(qty) && qty > 0 ? `${formatQtyNumber(qty)} MT` : null,
      })
    })
  }

  return segments
}
