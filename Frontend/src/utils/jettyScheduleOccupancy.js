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
  const actComp = parseMs(row?.actualCompletionDateTime)
  const castOff = parseMs(row?.castOffDateTime)
  const sourceStatus = String(row?.status || '').trim().toUpperCase()
  return sourceStatus === 'SAILED' || actComp != null || castOff != null
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

export function isAlongsideOccupiedOnDate(row, dateYmd, asOfMs) {
  if (row?.shiftingOut) return false
  const interval = getActualAlongsideInterval(row, asOfMs)
  if (!interval) return false
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
  const actComp = parseMs(row?.actualCompletionDateTime)
  const castOff = parseMs(row?.castOffDateTime)
  const end = actComp ?? castOff
  if (end == null) return false
  return end < dayStartMs
}

/** Same ordering as Jetty schedule bank lanes (TB → operationId → vesselId). */
function sortBerthOccupants(occupants) {
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
  }
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

export function buildBerthsForSchematicDate({ scheduleRows, berthsMaster, dateYmd, asOfMs }) {
  const berths = Array.isArray(berthsMaster) ? berthsMaster : []
  const rows = Array.isArray(scheduleRows) ? scheduleRows : []

  const occupantsByJetty = new Map()
  for (const r of rows) {
    if (!isAlongsideOccupiedOnDate(r, dateYmd, asOfMs)) continue
    const jettyId = jettyIdFromScheduleRow(r)
    if (!jettyId) continue
    const list = occupantsByJetty.get(jettyId) || []
    list.push(rowToOccupant(r))
    occupantsByJetty.set(jettyId, list)
  }

  return berths.map((b) => {
    const occList = sortBerthOccupants(occupantsByJetty.get(b.id) || [])
    const occ0 = occList[0] || null
    return {
      ...b,
      occupants: occList,
      occupiedCount: occList.length,
      currentVesselId: occ0 ? occ0.vesselId : null,
      currentVesselName: occ0 ? occ0.vesselName : null,
      currentOperationId: occ0?.operationId != null ? Number(occ0.operationId) : null,
    }
  })
}
