function startOfDay(d) {
  const x = new Date(d.getTime())
  x.setHours(0, 0, 0, 0)
  return x
}

export function toDateInputValue(d) {
  const x = startOfDay(d)
  const y = x.getFullYear()
  const m = String(x.getMonth() + 1).padStart(2, '0')
  const day = String(x.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function parseDateInputStart(str) {
  if (!str || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return null
  const [y, m, d] = str.split('-').map(Number)
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime()
}

export function parseDateInputEndExclusive(str) {
  if (!str || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return null
  const [y, m, d] = str.split('-').map(Number)
  const day = new Date(y, m - 1, d, 0, 0, 0, 0)
  day.setDate(day.getDate() + 1)
  return day.getTime()
}

export function parseMs(v) {
  if (v == null || v === '') return null
  const t = new Date(v).getTime()
  return Number.isNaN(t) ? null : t
}

export function resolveActualAlongsideEnd({ tb, estComp, isSailed, actComp, castOff, nowMs }) {
  if (isSailed) {
    const knownEnd = actComp ?? castOff ?? null
    if (knownEnd != null && knownEnd > tb) {
      return { endMs: knownEnd, gradient: false, label: 'Actual · alongside → completion / cast-off' }
    }
    return {
      endMs: Math.max(tb + 60_000, nowMs),
      gradient: true,
      label: 'Actual · alongside (completion time invalid — open end)',
    }
  }

  const endMs = estComp != null ? Math.max(estComp, nowMs) : nowMs
  return {
    endMs: Math.max(endMs, tb + 60_000),
    gradient: true,
    label:
      estComp != null
        ? 'Actual · alongside → open end (max of est. completion and now)'
        : 'Actual · alongside → open end (still at berth; est. completion not set)',
  }
}

/** Today uses live clock; past/future use end of selected calendar day. */
export function asOfMsForSelectedDate(dateYmd, liveNowMs) {
  const todayYmd = toDateInputValue(new Date())
  if (dateYmd === todayYmd) return liveNowMs
  const dayEndEx = parseDateInputEndExclusive(dateYmd)
  return dayEndEx != null ? dayEndEx - 1 : liveNowMs
}

export function jettyIdFromScheduleRow(row) {
  return (row?.jetty || '').trim().split('/')[0].trim()
}

function isSailedRow(row) {
  return String(row?.status || '').trim().toUpperCase() === 'SAILED'
}

export function getActualAlongsideInterval(row, asOfMs) {
  const tb = parseMs(row?.tbDateTime)
  if (tb == null) return null
  const estComp = parseMs(row?.estimatedCompletionDateTime)
  const actComp = parseMs(row?.actualCompletionDateTime)
  const castOff = parseMs(row?.castOffDateTime)
  const isSailed = isSailedRow(row)
  const { endMs } = resolveActualAlongsideEnd({
    tb,
    estComp,
    isSailed,
    actComp,
    castOff,
    nowMs: asOfMs,
  })
  return { startMs: tb, endMs }
}

/**
 * Whether a row occupies a berth slot on the selected calendar day.
 * - **Today** (`dateYmd` = current local date): point-in-time using `asOfMs` (live "right now").
 * - **Past days**: any overlap with the full calendar day (midnight–midnight).
 */
export function isAlongsideOccupiedOnDate(row, dateYmd, asOfMs) {
  if (row?.shiftingOut) return false
  const interval = getActualAlongsideInterval(row, asOfMs)
  if (!interval) return false

  const todayYmd = toDateInputValue(new Date(asOfMs))
  if (dateYmd === todayYmd) {
    // Inclusive end: open-at-berth intervals use endMs = now, so strict `<` would hide active vessels.
    return interval.startMs <= asOfMs && asOfMs <= interval.endMs
  }

  const dayStart = parseDateInputStart(dateYmd)
  const dayEnd = parseDateInputEndExclusive(dateYmd)
  if (dayStart == null || dayEnd == null) return false
  return interval.startMs < dayEnd && interval.endMs > dayStart
}

export function getArrivalMsForScheduleRow(row) {
  return (
    parseMs(row?.etaDateTime) ?? parseMs(row?.etbDateTime) ?? parseMs(row?.taDateTime) ?? null
  )
}

function departedBeforeDay(row, dayStartMs) {
  if (String(row?.status || '').trim().toUpperCase() !== 'SAILED') return false
  const actComp = parseMs(row?.actualCompletionDateTime)
  const castOff = parseMs(row?.castOffDateTime)
  const end = actComp ?? castOff
  if (end == null) return false
  return end < dayStartMs
}

export function bankLaneKeyFromRow(row) {
  if (row?.shipmentPlanId != null && row.shipmentPlanId !== '') {
    return `plan-${row.shipmentPlanId}`
  }
  return row?.vesselId ?? null
}

/** Same ordering as Jetty schedule bank lanes (TB → operationId → vesselId). */
export function sortBerthOccupants(occupants) {
  const list = Array.isArray(occupants) ? [...occupants] : []
  list.sort((a, b) => {
    const tbA = parseMs(a?.tbDateTime)
    const tbB = parseMs(b?.tbDateTime)
    if (tbA != null && tbB != null && tbA !== tbB) return tbA - tbB
    if (tbA != null && tbB == null) return -1
    if (tbA == null && tbB != null) return 1
    const opA = a?.operationId != null ? Number(a.operationId) : Number.MAX_SAFE_INTEGER
    const opB = b?.operationId != null ? Number(b.operationId) : Number.MAX_SAFE_INTEGER
    if (opA !== opB) return opA - opB
    return String(a?.vesselId || '').localeCompare(String(b?.vesselId || ''))
  })
  return list
}

function rowToOccupant(row) {
  return {
    vesselId: row.vesselId,
    vesselName: row.vesselName,
    operationId: row.operationId != null ? Number(row.operationId) : null,
    shipmentPlanId: row.shipmentPlanId != null ? Number(row.shipmentPlanId) : null,
    status: row.status || null,
    tbDateTime: row.tbDateTime || null,
    taDateTime: row.taDateTime || null,
    estimatedCompletionDateTime: row.estimatedCompletionDateTime || null,
    actualCompletionDateTime: row.actualCompletionDateTime || null,
    castOffDateTime: row.castOffDateTime || null,
    // Multi-jetty berthing: secondary jetty short ids this occupant spans into (in addition to its own berth).
    additionalBerthIds: Array.isArray(row.additionalJetties) ? row.additionalJetties.filter(Boolean) : [],
  }
}

/**
 * Schematic KPI counters for a selected date:
 * eta = ETA on that date, no TA yet · etb = ETB on that date, no TB yet ·
 * etc = Est. Completion on that date, no actual completion yet.
 * Deduped per shipment plan (falls back to vesselId when no plan id).
 */
export function computeScheduleKpis(scheduleRows, dateYmd) {
  const rows = Array.isArray(scheduleRows) ? scheduleRows : []
  const sameDay = (iso) => {
    if (!iso) return false
    const d = new Date(iso)
    return !Number.isNaN(d.getTime()) && toDateInputValue(d) === dateYmd
  }
  const make = () => ({ count: 0, vesselIds: new Set(), planIds: new Set() })
  const kpis = { eta: make(), etb: make(), etc: make() }
  const seen = { eta: new Set(), etb: new Set(), etc: new Set() }
  const add = (key, r) => {
    const dedupe = r.shipmentPlanId != null ? `p${r.shipmentPlanId}` : `v${r.vesselId}`
    if (seen[key].has(dedupe)) return
    seen[key].add(dedupe)
    kpis[key].count += 1
    if (r.vesselId) kpis[key].vesselIds.add(r.vesselId)
    if (r.shipmentPlanId != null) kpis[key].planIds.add(Number(r.shipmentPlanId))
  }
  for (const r of rows) {
    if (!r) continue
    if (sameDay(r.etaDateTime || r.eta) && !r.taDateTime) add('eta', r)
    if (sameDay(r.etbDateTime || r.etb) && !r.tbDateTime) add('etb', r)
    if (sameDay(r.estimatedCompletionDateTime) && !r.actualCompletionDateTime) add('etc', r)
  }
  return kpis
}

export function buildIncomingByJettyForDate(scheduleRows, dateYmd, asOfMs) {
  const dayStart = parseDateInputStart(dateYmd)
  const dayEnd = parseDateInputEndExclusive(dateYmd)
  if (dayStart == null || dayEnd == null) return {}

  const rows = Array.isArray(scheduleRows) ? scheduleRows : []
  const sorted = rows
    .filter((r) => {
      if (r?.shiftingOut) return false
      const jettyId = jettyIdFromScheduleRow(r)
      if (!jettyId) return false
      if (isAlongsideOccupiedOnDate(r, dateYmd, asOfMs)) return false
      if (departedBeforeDay(r, dayStart)) return false
      const arrivalMs = getArrivalMsForScheduleRow(r)
      if (arrivalMs == null || arrivalMs >= dayEnd) return false
      return true
    })
    .sort((a, b) => {
      const aMs = getArrivalMsForScheduleRow(a) ?? Number.MAX_SAFE_INTEGER
      const bMs = getArrivalMsForScheduleRow(b) ?? Number.MAX_SAFE_INTEGER
      return aMs - bMs
    })

  const byJetty = {}
  for (const r of sorted) {
    const jettyId = jettyIdFromScheduleRow(r)
    const name = r.vesselName || r.vesselId || '—'
    if (!byJetty[jettyId]) byJetty[jettyId] = []
    byJetty[jettyId].push(name)
  }
  return byJetty
}

/**
 * Lane indices for vessels currently alongside (matches Jetty Schematic slot order).
 * @returns {Map<string, number>} keys `"jettyId\0bankLaneKey"` → lane 0..capacity-1
 */
export function buildActiveLaneMap({ scheduleRows, berthCapacities, asOfMs }) {
  const todayYmd = toDateInputValue(new Date(asOfMs))
  const rows = Array.isArray(scheduleRows) ? scheduleRows : []
  const caps =
    berthCapacities instanceof Map
      ? berthCapacities
      : new Map(Object.entries(berthCapacities || {}))
  const laneMap = new Map()

  const byJetty = new Map()
  for (const r of rows) {
    if (!isAlongsideOccupiedOnDate(r, todayYmd, asOfMs)) continue
    const jettyId = jettyIdFromScheduleRow(r)
    const bk = bankLaneKeyFromRow(r)
    if (!jettyId || !bk) continue
    const list = byJetty.get(jettyId) || []
    list.push(rowToOccupant(r))
    byJetty.set(jettyId, list)
  }

  for (const [jettyId, occupants] of byJetty) {
    const cap = Math.max(1, Number(caps.get(jettyId)) || 1)
    const sorted = sortBerthOccupants(occupants)
    const seen = new Set()
    let laneIdx = 0
    for (const occ of sorted) {
      const bk =
        occ.shipmentPlanId != null && occ.shipmentPlanId !== ''
          ? `plan-${occ.shipmentPlanId}`
          : occ.vesselId
      if (!bk || seen.has(bk)) continue
      seen.add(bk)
      laneMap.set(`${jettyId}\0${bk}`, Math.min(laneIdx, cap - 1))
      laneIdx += 1
    }
  }

  return laneMap
}

/** Jetty capacity (>= 1), from master berth records. */
function berthCapacityFromMaster(berth) {
  const c = berth?.capacity != null ? Number(berth.capacity) : 1
  return Number.isFinite(c) && c >= 1 ? c : 1
}

export function buildBerthsForSchematicDate({ scheduleRows, berthsMaster, dateYmd, asOfMs }) {
  const berths = Array.isArray(berthsMaster) ? berthsMaster : []
  const rows = Array.isArray(scheduleRows) ? scheduleRows : []
  const capacityById = new Map(berths.map((b) => [b.id, berthCapacityFromMaster(b)]))

  const occupantsByJetty = new Map()
  for (const r of rows) {
    if (!isAlongsideOccupiedOnDate(r, dateYmd, asOfMs)) continue
    const jettyId = jettyIdFromScheduleRow(r)
    if (!jettyId) continue
    const occupant = rowToOccupant(r)
    const list = occupantsByJetty.get(jettyId) || []
    list.push(occupant)
    occupantsByJetty.set(jettyId, list)
  }

  // Multi-jetty berthing: each direct occupant's lane index on its OWN (primary) jetty — needed so
  // the secondary/additional jetty(ies) it spans into reserve the SAME lane (clamped to that
  // secondary jetty's own capacity), instead of blanking out its whole double-bank stack.
  const sortedByJetty = new Map()
  for (const [jettyId, list] of occupantsByJetty) {
    const cap = capacityById.get(jettyId) ?? 1
    const sorted = sortBerthOccupants(list).map((occ, idx) => ({ ...occ, laneIndex: Math.min(idx, cap - 1) }))
    sortedByJetty.set(jettyId, sorted)
  }

  // Multi-jetty berthing: secondary (additional) jetty short id -> lane index -> who's spanning into it.
  const spannedByLaneMap = new Map()
  for (const [jettyId, sorted] of sortedByJetty) {
    for (const occupant of sorted) {
      for (const secondaryId of occupant.additionalBerthIds) {
        if (!secondaryId || secondaryId === jettyId) continue
        const secondaryCap = capacityById.get(secondaryId) ?? 1
        const secondaryLane = Math.min(occupant.laneIndex, secondaryCap - 1)
        const laneMap = spannedByLaneMap.get(secondaryId) || new Map()
        laneMap.set(secondaryLane, {
          laneIndex: secondaryLane,
          primaryBerthId: jettyId,
          vesselId: occupant.vesselId,
          vesselName: occupant.vesselName,
        })
        spannedByLaneMap.set(secondaryId, laneMap)
      }
    }
  }

  return berths.map((b) => {
    const occList = sortedByJetty.get(b.id) || []
    const occ0 = occList[0] || null
    const spannedByLanes = [...(spannedByLaneMap.get(b.id)?.values() || [])].sort(
      (x, y) => x.laneIndex - y.laneIndex
    )
    return {
      ...b,
      occupants: occList,
      occupiedCount: occList.length + spannedByLanes.length,
      currentVesselId: occ0 ? occ0.vesselId : null,
      currentVesselName: occ0 ? occ0.vesselName : null,
      currentOperationId: occ0?.operationId != null ? Number(occ0.operationId) : null,
      // Backward-compat single-value field (first spanned lane), plus the full per-lane list.
      spannedBy: spannedByLanes[0] || null,
      spannedByLanes,
    }
  })
}
