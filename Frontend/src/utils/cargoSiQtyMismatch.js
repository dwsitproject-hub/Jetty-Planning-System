const QTY_EPSILON = 1e-6

function parseLineQty(qty) {
  const n = Number(qty)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function lineHasEnd(line) {
  const end = line.endAt ?? line.end ?? line.endIso ?? line.endedAt
  return end != null && String(end).trim() !== ''
}

function normalizeDraftLine(draft) {
  return {
    qty: draft.qty,
    endAt: draft.end ?? draft.endAt ?? null,
  }
}

function linesFromActivity(activity) {
  const cargoLines = activity?.cargoLoadLines
  if (Array.isArray(cargoLines) && cargoLines.length) {
    return cargoLines.map((l) => ({
      qty: l.qty,
      endAt: l.endAt ?? l.endedAt ?? null,
    }))
  }
  const legacyQty = activity?.cargoMovedQty
  if (Number.isFinite(Number(legacyQty)) && Number(legacyQty) > 0) {
    return [{ qty: legacyQty, endAt: activity.endTime ?? activity.endAt ?? null }]
  }
  return []
}

/**
 * Flatten cargo load lines from saved activities and optional draft rows for the entry being edited.
 */
export function collectCargoLoadLines(activities, { excludeEntryId, draftLines } = {}) {
  const out = []
  for (const activity of activities || []) {
    if (excludeEntryId && String(activity.id) === String(excludeEntryId)) continue
    out.push(...linesFromActivity(activity))
  }
  if (Array.isArray(draftLines)) {
    for (const draft of draftLines) {
      out.push(normalizeDraftLine(draft))
    }
  }
  return out
}

/**
 * Replace load lines for one activity id with pending lines (operator stop / edit flows).
 */
export function collectCargoLoadLinesWithPending(
  activities,
  { pendingEntryId, pendingLines, excludeEntryId, draftLines } = {}
) {
  const out = []
  for (const activity of activities || []) {
    if (excludeEntryId && String(activity.id) === String(excludeEntryId)) continue
    if (pendingEntryId && String(activity.id) === String(pendingEntryId)) {
      if (Array.isArray(pendingLines)) {
        for (const line of pendingLines) {
          out.push({
            qty: line.qty,
            endAt: line.endAt ?? line.end ?? null,
          })
        }
      }
      continue
    }
    out.push(...linesFromActivity(activity))
  }
  if (Array.isArray(draftLines)) {
    for (const draft of draftLines) {
      out.push(normalizeDraftLine(draft))
    }
  }
  return out
}

function sumLineQty(lines) {
  return (lines || []).reduce((s, l) => s + parseLineQty(l.qty), 0)
}

function allLinesClosed(lines) {
  if (!lines?.length) return false
  return lines.every(lineHasEnd)
}

/**
 * Detect mismatch between cumulative cargo qty and SI qty.
 * @returns {{ kind: 'over'|'under', siQty: number, total: number, delta: number } | null}
 */
export function detectCargoSiQtyMismatch({ siQty, lines }) {
  const si = Number(siQty)
  if (!Number.isFinite(si) || si <= 0) return null

  const total = sumLineQty(lines)
  const diff = total - si
  if (Math.abs(diff) <= QTY_EPSILON) return null

  if (diff > QTY_EPSILON) {
    return { kind: 'over', siQty: si, total, delta: diff }
  }

  if (diff < -QTY_EPSILON && allLinesClosed(lines)) {
    return { kind: 'under', siQty: si, total, delta: -diff }
  }

  return null
}

function formatQty(n) {
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 6 })
}

export function formatCargoSiQtyMismatchConfirm(mismatch, t) {
  if (!mismatch) return ''
  const params = {
    siQty: formatQty(mismatch.siQty),
    total: formatQty(mismatch.total),
    delta: formatQty(mismatch.delta),
  }
  if (mismatch.kind === 'over') {
    return t('cargoOpsQtyOverSiConfirm', params)
  }
  return t('cargoOpsQtyUnderSiConfirm', params)
}

export function formatCargoSiQtyMismatchBanner(mismatch, t, unit = '') {
  if (!mismatch) return ''
  const params = {
    siQty: formatQty(mismatch.siQty),
    total: formatQty(mismatch.total),
    delta: formatQty(mismatch.delta),
    unit: unit ? ` ${unit}` : '',
  }
  if (mismatch.kind === 'over') {
    return t('cargoOpsQtyOverSiBanner', params)
  }
  return t('cargoOpsQtyUnderSiBanner', params)
}
