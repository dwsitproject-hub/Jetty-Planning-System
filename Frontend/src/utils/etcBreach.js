function parseDateMs(val) {
  if (!val) return null
  const t = new Date(val).getTime()
  return Number.isNaN(t) ? null : t
}

function getEstimatedCompletionMs(row) {
  return parseDateMs(
    row?.estimatedCompletionDateTime ??
      row?.estimatedCompletionTime ??
      row?.estimationOfCompletion
  )
}

function hasAlongsideTime(row) {
  return Boolean(row?.tbDateTime || row?.tb || row?.tbAt || row?.dockingStartTime)
}

function hasOperationsCompleted(row) {
  return Boolean(
    row?.operationsCompletedDateTime ||
      row?.operationsCompletedAt ||
      row?.operationsCompletedTime
  )
}

function hasActualCompletion(row) {
  return Boolean(
    row?.actualCompletionDateTime ||
      row?.actualCompletionTime ||
      row?.actualCompletionAt
  )
}

function hasCastOff(row) {
  return Boolean(row?.castOffDateTime || row?.castOffAt)
}

function isOpsFinishedAtBerth(row) {
  const status = String(row?.status || '').toUpperCase()
  return (
    ['SIGNOFF_REQUESTED', 'SIGNOFF_APPROVED'].includes(status) || hasOperationsCompleted(row)
  )
}

/** Whether row can be evaluated for operational ETC breach (alongside, not departed). */
export function isEtcBreachEligible(row) {
  if (!row) return false
  const status = String(row?.status || '').toUpperCase()
  if (['SAILED', 'PENDING', 'ALLOCATED'].includes(status)) return false
  if (isOpsFinishedAtBerth(row)) return false
  if (hasActualCompletion(row)) return false
  if (hasCastOff(row)) return false
  if (!hasAlongsideTime(row)) return false
  return getEstimatedCompletionMs(row) != null
}

/**
 * Returns breach info when ETC has passed and vessel is still alongside.
 * @returns {{ etcMs: number, overMs: number, overHours: number } | null}
 */
export function getEtcBreach(row, nowMs = Date.now()) {
  const status = String(row?.status || '').toUpperCase()
  if (['SAILED', 'PENDING', 'ALLOCATED'].includes(status)) return null
  if (isOpsFinishedAtBerth(row)) return null
  if (hasActualCompletion(row)) return null
  if (hasCastOff(row)) return null
  if (!hasAlongsideTime(row)) return null

  const etcMs = getEstimatedCompletionMs(row)
  if (etcMs == null || etcMs >= nowMs) return null

  const overMs = nowMs - etcMs
  return { etcMs, overMs, overHours: overMs / 3_600_000 }
}

/** Human-readable overdue duration, e.g. "+2.5h" or "+45m". */
export function formatOverdueDuration(overMs) {
  if (overMs == null || overMs < 0) return '—'
  const hours = overMs / 3_600_000
  if (hours < 1) return `+${Math.max(1, Math.round(hours * 60))}m`
  if (hours < 24) return `+${hours < 10 ? hours.toFixed(1) : Math.round(hours)}h`
  const days = Math.floor(hours / 24)
  const remH = Math.round(hours % 24)
  return remH > 0 ? `+${days}d ${remH}h` : `+${days}d`
}

export function getEtcBreachRagStatus(row, nowMs = Date.now()) {
  return getEtcBreach(row, nowMs) ? 'red' : 'green'
}
