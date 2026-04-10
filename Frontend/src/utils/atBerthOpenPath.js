/**
 * At-Berth "Open" → Loading / Unloading deep link.
 *
 * Rule (first incomplete phase, fixed order Pre-Checking → Operational → Post-Checking):
 * We approximate without fetching sub-processes per row:
 * - DOCKED / ALLOCATED / PENDING / other non-terminal → pre-checking
 * - IN_PROGRESS and completion < 100 → loading (operational)
 * - IN_PROGRESS and completion >= 100 → post-checking (cargo done, final checks)
 * - POST_OPS / SIGNOFF_REQUESTED / SIGNOFF_APPROVED → post-checking
 *
 * Matches `Loading.jsx` route segments: pre-checking | loading | post-checking
 */

export function getAtBerthDefaultSection(row) {
  const st = String(row?.status || '').toUpperCase()
  const pctRaw = Number(row?.completionPercent)
  const pct = Number.isFinite(pctRaw) ? pctRaw : 0

  if (st === 'POST_OPS' || st === 'SIGNOFF_REQUESTED' || st === 'SIGNOFF_APPROVED') {
    return 'post-checking'
  }
  if (st === 'IN_PROGRESS') {
    return pct >= 100 ? 'post-checking' : 'loading'
  }
  return 'pre-checking'
}

/** Full path e.g. /loading/op-12/pre-checking */
export function atBerthExecutionOpenPath(row) {
  const purpose = row?.purpose === 'Unloading' ? 'unloading' : 'loading'
  const opId = row?.operationId ?? row?.id ?? null
  const rawVesselId = row?.vesselId ?? (opId != null ? `op-${opId}` : null)
  if (!rawVesselId) return '#'
  const vesselId = encodeURIComponent(rawVesselId)
  const section = getAtBerthDefaultSection(row)
  return `/${purpose}/${vesselId}/${section}`
}
