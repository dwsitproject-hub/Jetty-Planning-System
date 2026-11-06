/** Display helpers for ATG cargo gaps on System Health. */

export function formatGapDuration(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0))
  const h = Math.floor(total / 60)
  const m = total % 60
  if (!h) return `${m} min`
  return m ? `${h} h ${m} min` : `${h} h`
}

/** @returns {'success'|'warning'|'error'|'neutral'} */
export function resyncOutcomeVariant(outcome) {
  switch (outcome) {
    case 'success':
      return 'success'
    case 'partial':
    case 'no_samples':
      return 'warning'
    case 'failed':
      return 'error'
    default:
      return 'neutral'
  }
}

/**
 * Roll the per-tank dry-run preview up to one row per gap.
 * @param {Array<{ gapKey: string, tankCode: string, archivePoints: number, newPoints: number, error: string|null }>} preview
 */
export function summarizePreviewByGap(preview) {
  const byGap = new Map()
  for (const p of preview ?? []) {
    let row = byGap.get(p.gapKey)
    if (!row) {
      row = { gapKey: p.gapKey, archivePoints: 0, newPoints: 0, tanks: [], errors: [] }
      byGap.set(p.gapKey, row)
    }
    row.archivePoints += Number(p.archivePoints) || 0
    row.newPoints += Number(p.newPoints) || 0
    row.tanks.push(p.tankCode)
    if (p.error) row.errors.push(`${p.tankCode}: ${p.error}`)
  }
  return byGap
}

/** Gap keys still present after a resync, among the ones that were targeted. */
export function remainingTargetGapKeys(result) {
  const after = new Set((result?.gapsAfter ?? []).map((g) => g.gapKey))
  return (result?.targetGapKeys ?? []).filter((k) => after.has(k))
}

export function isGapOpen(gap) {
  return !gap?.acknowledgement
}
