/**
 * Build Daily Activities Report rows from live API data (operations, SI, activity timeline).
 */

const AT_BERTH_STATUSES = [
  'DOCKED',
  'IN_PROGRESS',
  'POST_OPS',
  'SIGNOFF_REQUESTED',
  'SIGNOFF_APPROVED',
]

function startOfDay(s) {
  if (!s) return null
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  d.setUTCHours(0, 0, 0, 0)
  return d.getTime()
}

function endOfDay(s) {
  if (!s) return null
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  d.setUTCHours(23, 59, 59, 999)
  return d.getTime()
}

/**
 * Same berthed idea as Allocation / At-Berth: TB/docking or active berth status.
 * SAILED is included only if there was a berth time (alongside).
 */
export function operationIsBerthedForReport(op) {
  if (!op) return false
  const st = String(op.status || '').toUpperCase()
  const hasBerthMark = Boolean(op.dockingStartTime || op.tbAt)
  if (st === 'SAILED') {
    return hasBerthMark
  }
  if (AT_BERTH_STATUSES.includes(st)) return true
  return hasBerthMark
}

function statusForTimelineEvent(ev) {
  if (ev.source === 'sub_process') return ev.status || '—'
  if (ev.source === 'operational_milestone_na') return 'N/A'
  if (ev.source === 'operational_activity') {
    if (ev.endAt) return 'Done'
    if (ev.startAt) return 'In progress'
    return '—'
  }
  return '—'
}

/**
 * @param {Array} events - from GET /operations/:id/activity-timeline
 * @returns {Array<{ category, remark, dateTime, endDateTime, status }>}
 */
export function timelineEventsToTimelog(events) {
  const rows = (Array.isArray(events) ? events : []).map((ev) => {
    const dateTime = ev.startAt || ev.occurredAt || ev.sortAt || null
    const endDateTime = ev.endAt || null
    const category = [ev.phase, ev.title].filter(Boolean).join(' · ') || '—'
    const remarkParts = []
    if (ev.subStepTitle) remarkParts.push(ev.subStepTitle)
    if (ev.remark) remarkParts.push(ev.remark)
    if (ev.skipReason) remarkParts.push(`Skip: ${ev.skipReason}`)
    if (ev.reason) remarkParts.push(ev.reason)
    if (ev.cargoHandlingMethodName) remarkParts.push(ev.cargoHandlingMethodName)
    return {
      category,
      remark: remarkParts.length ? remarkParts.join(' · ') : '—',
      dateTime,
      endDateTime: endDateTime || '',
      status: statusForTimelineEvent(ev),
    }
  })
  return rows.sort((a, b) => {
    const ta = a.dateTime ? new Date(a.dateTime).getTime() : 0
    const tb = b.dateTime ? new Date(b.dateTime).getTime() : 0
    return ta - tb
  })
}

export function timelogEntryOverlapsRange(entry, startDate, endDate) {
  if (!startDate || !endDate) return true
  const rangeStart = startOfDay(startDate)
  const rangeEnd = endOfDay(endDate)
  if (rangeStart == null || rangeEnd == null) return true
  const t = (s) => {
    if (!s) return null
    const x = new Date(s).getTime()
    return Number.isNaN(x) ? null : x
  }
  let lo = t(entry.dateTime)
  const hiRaw = t(entry.endDateTime)
  const hi = hiRaw != null ? hiRaw : lo
  if (lo == null) return false
  const bottom = Math.min(lo, hi)
  const top = Math.max(lo, hi)
  return bottom <= rangeEnd && top >= rangeStart
}

function summarizeQuantityFromSiBreakdown(breakdown) {
  if (!Array.isArray(breakdown) || breakdown.length === 0) return '—'
  return breakdown
    .map((l) => {
      const q = l.qty != null ? Number(l.qty) : null
      const unit = l.metricLabel || l.metricCode || ''
      if (q == null || Number.isNaN(q)) return unit || '—'
      return unit ? `${q} ${unit}` : String(q)
    })
    .join('; ')
}

/**
 * @param {object} op - operation from API
 * @param {object|null} si - shipping instruction from API (with breakdown)
 * @param {object|undefined} overviewRow - allocation overview queue row for same operationId
 */
export function buildDailyReportHeader(op, si, overviewRow) {
  const shipper = si?.shipperName || overviewRow?.shipper || '—'
  const surveyor = si?.surveyorName || overviewRow?.surveyor || '—'
  const agent = si?.agentName || overviewRow?.agent || '—'
  const commodity = op.commodity || si?.commodity || '—'
  const quantity = summarizeQuantityFromSiBreakdown(si?.breakdown)
  const loadPort = si?.loadingPortName || '—'
  const dischPort = si?.destinationText || '—'

  return {
    jetty: op.jettyName || overviewRow?.jetty || '—',
    vessel: op.vesselName || '—',
    commodity,
    quantity,
    stowage: '—',
    loadPort,
    dischPort,
    shipper,
    consignee: si?.consigneeText || '—',
    surveyor,
    agent,
    demurrageLiabilityFrom: op.demurrageLiabilityFromAt || overviewRow?.demurrageLiabilityFromDateTime || null,
    operationStatus: op.status || '—',
  }
}

/**
 * @returns {null | { vesselId, vesselName, header, timelog }}
 */
export function buildSingleOperationReportBlock(op, si, overviewRow, events, startDate, endDate) {
  const fullTimelog = timelineEventsToTimelog(events)
  const hasRange = Boolean(startDate && endDate)
  const timelog = hasRange ? fullTimelog.filter((e) => timelogEntryOverlapsRange(e, startDate, endDate)) : fullTimelog
  if (hasRange && timelog.length === 0) return null
  return {
    vesselId: String(op.id),
    vesselName: [op.vesselName || '—', op.referenceNumber].filter(Boolean).join(' — '),
    header: buildDailyReportHeader(op, si, overviewRow),
    timelog,
  }
}
