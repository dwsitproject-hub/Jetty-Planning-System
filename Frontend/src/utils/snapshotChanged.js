/**
 * Cheap equality check for poll payloads — avoids setState when API data is unchanged.
 * Compares stable scalar fields rather than deep object identity.
 */

function eventsSnapshot(events) {
  if (!Array.isArray(events) || events.length === 0) return '0'
  const last = events[events.length - 1]
  const lastTs = last?.timestamp ?? last?.createdAt ?? last?.occurredAt ?? ''
  const lastId = last?.id ?? ''
  const cargoLineCount = events.reduce(
    (n, ev) => n + (Array.isArray(ev?.cargoLoadLines) ? ev.cargoLoadLines.length : 0),
    0
  )
  return `${events.length}:${lastId}:${lastTs}:${cargoLineCount}`
}

function progressSnapshot(progress) {
  if (!progress || typeof progress !== 'object') return 'null'
  const buckets = Array.isArray(progress.hourlyBuckets) ? progress.hourlyBuckets.length : 0
  const moved = progress.movedQty ?? progress.scheduleComparison?.movedQty ?? ''
  const source = progress.source ?? ''
  const lastBucket = buckets > 0 ? progress.hourlyBuckets[buckets - 1]?.hourKey ?? '' : ''
  const cumLen = Array.isArray(progress.cumulativeSeries) ? progress.cumulativeSeries.length : 0
  const lastCum =
    cumLen > 0 ? progress.cumulativeSeries[cumLen - 1]?.cumulativeQty ?? '' : ''
  return `${moved}:${source}:${buckets}:${lastBucket}:${cumLen}:${lastCum}`
}

/** Returns true when events or progress meaningfully changed. */
export function operationalProgressPayloadChanged(prevEvents, nextEvents, prevProgress, nextProgress) {
  return (
    eventsSnapshot(prevEvents) !== eventsSnapshot(nextEvents) ||
    progressSnapshot(prevProgress) !== progressSnapshot(nextProgress)
  )
}
