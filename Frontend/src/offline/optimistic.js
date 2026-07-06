/**
 * Optimistic read overlays. When offline, a queued mutation must still be visible
 * on the screens that read the same data — otherwise a change "vanishes" when the
 * page auto-refetches from the (pre-change) cache. Overlays re-apply pending
 * outbox mutations onto a cached read payload at read time. They are applied to
 * cached data only (never to fresh online responses, which are authoritative) and
 * auto-disappear once the outbox item syncs.
 *
 * Every overlay is DEFENSIVE: it must never throw on an unexpected payload shape —
 * worst case it returns the input unchanged (the change just won't show offline).
 */

/** Which write-entities affect which read-entity's cached payload. */
export const READ_ENTITY_WRITE_SOURCES = {
  'allocation-overview': ['arrival'],
}

/** Fields copied from an arrival write body onto a matching schedule/queue row. */
const ARRIVAL_DATE_FIELDS = [
  'etaDateTime',
  'taDateTime',
  'tbDateTime',
  'pobDateTime',
  'sobDateTime',
  'estimatedCompletionDateTime',
]

function rowMatchesBody(row, body) {
  const eq = (a, b) => a != null && b != null && String(a) === String(b)
  return (
    eq(row.operationId, body.operationId) ||
    eq(row.shipmentPlanId, body.shipmentPlanId) ||
    eq(row.shippingInstructionId, body.shippingInstructionId)
  )
}

function mergeArrival(row, body) {
  const merged = { ...row, __pendingSync: true }
  for (const f of ARRIVAL_DATE_FIELDS) {
    if (body[f] !== undefined && body[f] !== '') merged[f] = body[f]
  }
  // The Gantt reads plannedEtbDateTime ?? etbDateTime — keep both in sync.
  if (body.etbDateTime !== undefined && body.etbDateTime !== '') {
    merged.etbDateTime = body.etbDateTime
    merged.plannedEtbDateTime = body.etbDateTime
  }
  if (body.jetty !== undefined && String(body.jetty).trim() !== '') merged.jetty = body.jetty
  return merged
}

/**
 * Apply queued arrival writes onto an allocation overview payload
 * ({ queue, scheduleQueue, berths, ... }). Defensive against shape changes.
 */
export function applyArrivalOverlay(payload, pendingRows) {
  if (!payload || typeof payload !== 'object') return payload
  const bodies = pendingRows.map((r) => r && r.body).filter((b) => b && typeof b === 'object')
  if (!bodies.length) return payload

  const patchRow = (row) => {
    if (!row || typeof row !== 'object') return row
    for (const body of bodies) {
      if (rowMatchesBody(row, body)) return mergeArrival(row, body)
    }
    return row
  }
  const patchArr = (arr) => (Array.isArray(arr) ? arr.map(patchRow) : arr)

  return {
    ...payload,
    queue: patchArr(payload.queue),
    scheduleQueue: patchArr(payload.scheduleQueue),
  }
}

/**
 * Overlay pending mutations onto a cached read payload for the given read entity.
 * @param {string} readEntity
 * @param {any} payload cached payload
 * @param {Array} pendingRows outbox rows (pending/failed)
 */
export function overlayPending(readEntity, payload, pendingRows) {
  try {
    const sources = READ_ENTITY_WRITE_SOURCES[readEntity]
    if (!sources || !Array.isArray(pendingRows) || !pendingRows.length) return payload
    const relevant = pendingRows.filter((r) => r && sources.includes(r.entity))
    if (!relevant.length) return payload
    if (readEntity === 'allocation-overview') return applyArrivalOverlay(payload, relevant)
    return payload
  } catch {
    return payload
  }
}
