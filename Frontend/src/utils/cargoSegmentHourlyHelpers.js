/** Build POST /cargo-segment-hourly payloads from cargo modal draft rows. */

function parseSavedLoadLineId(key) {
  if (key == null || key === '') return null
  const n = Number(String(key))
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * @param {Array<object>} draftLines
 * @param {Map<string, { hasAtg?: boolean }>} tankMetaById
 * @param {(local: string) => string|null} normalizeStartEnd - normalizeForApi bound to tz
 */
export function buildCargoSegmentHourlyRequests(draftLines, tankMetaById, normalizeStartEnd) {
  if (!Array.isArray(draftLines) || draftLines.length === 0) return []

  const segments = []
  for (const row of draftLines) {
    const clientKey = String(row.key ?? '')
    if (!clientKey) continue

    const startLocal = row.start ? String(row.start).trim() : ''
    if (!startLocal) continue

    const tankIds = (row.tankIds || [])
      .map(String)
      .filter((id) => tankMetaById?.get(id)?.hasAtg)
    if (tankIds.length === 0) continue

    const atgQtyMode = row.atgQtyMode === 'manual' ? 'manual' : 'auto'
    if (atgQtyMode === 'manual') continue

    let startAt = null
    let endAt = null
    try {
      startAt = normalizeStartEnd(startLocal)
    } catch {
      continue
    }
    if (row.end && String(row.end).trim()) {
      try {
        endAt = normalizeStartEnd(String(row.end).trim())
      } catch {
        endAt = null
      }
    }

    const loadLineId = parseSavedLoadLineId(row.key)
    segments.push({
      clientKey,
      ...(loadLineId != null ? { loadLineId: String(loadLineId) } : {}),
      startAt,
      endAt,
      tankIds,
      atgQtyMode,
    })
  }
  return segments
}

/**
 * Build POST /cargo-segment-hourly payloads from persisted operator segment rows.
 * @param {Array<object>} segments - operator segments with clientKey, loadLineId, startAt, endAt, tankIds, atgQtyMode
 * @param {Map<string, { hasAtg?: boolean }>} tankMetaById
 */
export function buildOperatorSegmentHourlyRequests(segments, tankMetaById) {
  if (!Array.isArray(segments) || segments.length === 0) return []

  const out = []
  for (const seg of segments) {
    const clientKey = String(seg.clientKey ?? '')
    if (!clientKey || !seg.startAt) continue

    const atgQtyMode = seg.atgQtyMode === 'manual' ? 'manual' : 'auto'
    if (atgQtyMode === 'manual') continue

    const tankIds = (seg.tankIds || [])
      .map(String)
      .filter((id) => tankMetaById?.get(id)?.hasAtg)
    if (tankIds.length === 0) continue

    const loadLineId = parseSavedLoadLineId(seg.loadLineId ?? seg.clientKey)
    out.push({
      clientKey,
      ...(loadLineId != null ? { loadLineId: String(loadLineId) } : {}),
      startAt: seg.startAt,
      endAt: seg.endAt || null,
      tankIds,
      atgQtyMode,
    })
  }
  return out
}

/** Signature for debounced refetch (draft edits + live tick). */
export function cargoSegmentHourlySignature(segments, liveTick = 0) {
  return `${liveTick}|${(segments || [])
    .map(
      (s) =>
        `${s.clientKey}|${s.startAt}|${s.endAt ?? ''}|${(s.tankIds || []).join(',')}|${s.atgQtyMode || 'auto'}`
    )
    .join(';')}`
}

/** Map API response segments to clientKey → progress slice. */
export function mapCargoSegmentHourlyResponse(res) {
  const map = new Map()
  for (const seg of res?.segments || []) {
    const key = seg.clientKey != null ? String(seg.clientKey) : ''
    if (!key) continue
    map.set(key, {
      hourlyBuckets: Array.isArray(seg.hourlyBuckets) ? seg.hourlyBuckets : [],
      movedQty: seg.movedQty != null ? Number(seg.movedQty) : 0,
      rateSummary: seg.rateSummary || {},
      error: seg.error ?? null,
    })
  }
  return map
}
