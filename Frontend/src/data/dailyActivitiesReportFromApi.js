/**
 * Build Daily Activities Report rows from live API data (operations, SI, activity timeline).
 */

export const DAILY_ACTIVITIES_HEADER_DATETIME_KEYS = new Set([
  'eta',
  'actualArrival',
  'etb',
  'actualBerthing',
  'estimationOfCompletion',
  'castOff',
  'sailedAt',
  'demurrageLiabilityFrom',
])

export const DAILY_ACTIVITIES_HEADER_FIELDS = [
  { key: 'planRef', label: 'Plan Ref' },
  { key: 'shippingInstruction', label: 'Shipping Instruction' },
  { key: 'commodity', label: 'Commodity' },
  { key: 'quantity', label: 'Qty' },
  { key: 'purpose', label: 'Purpose' },
  { key: 'eta', label: 'ETA' },
  { key: 'actualArrival', label: 'Actual arrival' },
  { key: 'etb', label: 'ETB' },
  { key: 'actualBerthing', label: 'Actual berthing' },
  { key: 'estimationOfCompletion', label: 'Estimation of completion' },
  { key: 'castOff', label: 'CAST off' },
  { key: 'sailedAt', label: 'Sailed at' },
  { key: 'jetty', label: 'Jetty' },
  { key: 'vessel', label: 'Vessel' },
  { key: 'stowage', label: 'Stowage' },
  { key: 'loadPort', label: 'Load port' },
  { key: 'dischPort', label: 'Disch port' },
  { key: 'shipper', label: 'Shipper' },
  { key: 'consignee', label: 'Consignee' },
  { key: 'surveyor', label: 'Surveyor' },
  { key: 'agent', label: 'Agent' },
  { key: 'demurrageLiabilityFrom', label: 'Demurrage liability from' },
  { key: 'operationStatus', label: 'Operation status' },
]

export const DAILY_ACTIVITIES_PURPOSE_OPTIONS = [
  { value: 'Loading', label: 'Loading' },
  { value: 'Unloading', label: 'Unloading' },
]

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

export const VESSEL_ACTIVITIES_TIMELOG_TEMPLATE = [
  {
    id: 'pre_key_meeting',
    category: 'Pre-Checking - Key Meeting',
    subProcessKeys: ['key_meeting'],
  },
  {
    id: 'pre_nor',
    category: 'Pre-Checking - NOR',
    subProcessKeys: ['nor_accepted'],
  },
  {
    id: 'pre_sampling',
    category: 'Pre-Checking - Sampling',
    subProcessKeys: ['sampling'],
  },
  {
    id: 'pre_initial_cargo_checking',
    category: 'Pre-Checking - Initial Cargo Checking',
    subProcessKeys: ['initial_cargo_checking', 'initial_sounding', 'initial_draft_survey'],
  },
  {
    id: 'op_opening',
    category: 'Operational - Opening',
    milestoneKeys: ['opening_hatch'],
  },
  {
    id: 'op_cargo_pre_conditioning',
    category: 'Operational - Cargo Pre-Conditioning',
    milestoneKeys: ['cargo_pre_conditioning'],
  },
  {
    id: 'op_cargo_operations',
    category: 'Operational - Cargo Operations',
    milestoneKeys: ['cargo_operations'],
  },
  {
    id: 'op_other',
    category: 'Operational - Other',
    milestoneKeys: ['other'],
  },
  {
    id: 'post_final_inspection',
    category: 'Post-Checking - Final Inspection',
    subProcessKeys: ['final_inspection', 'final_tank_inspection', 'final_hold_inspection'],
  },
  {
    id: 'post_final_cargo_checking',
    category: 'Post-Checking - Final Cargo Checking',
    subProcessKeys: ['final_sounding'],
  },
]

function eventSortTime(ev) {
  const raw = ev?.startAt || ev?.occurredAt || ev?.sortAt || null
  if (!raw) return 0
  const t = new Date(raw).getTime()
  return Number.isNaN(t) ? 0 : t
}

export function mapEventToTemplateId(ev) {
  if (!ev) return null
  const subKey = ev.subProcessKey ?? ev.sub_process_key ?? null
  const milestoneKey = ev.milestoneKey ?? ev.milestone_key ?? null

  for (const template of VESSEL_ACTIVITIES_TIMELOG_TEMPLATE) {
    if (subKey && template.subProcessKeys?.includes(subKey)) return template.id
    if (
      milestoneKey &&
      template.milestoneKeys?.includes(milestoneKey) &&
      (ev.source === 'operational_activity' || ev.source === 'operational_milestone_na')
    ) {
      return template.id
    }
  }
  return null
}

function buildRemarkForTimelineEvent(ev) {
  const remarkParts = []
  if (ev.subStepTitle) remarkParts.push(ev.subStepTitle)
  if (ev.remark) remarkParts.push(ev.remark)
  if (ev.skipReason) remarkParts.push(`Skip: ${ev.skipReason}`)
  if (ev.reason) remarkParts.push(ev.reason)
  if (ev.cargoHandlingMethodName) remarkParts.push(ev.cargoHandlingMethodName)
  return remarkParts.length ? remarkParts.join(' · ') : '—'
}

export function timelineEventToTimelogRow(ev, categoryLabel) {
  const dateTime = ev.startAt || ev.occurredAt || ev.sortAt || null
  const endDateTime = ev.endAt || null
  return {
    category: categoryLabel,
    remark: buildRemarkForTimelineEvent(ev),
    dateTime,
    endDateTime: endDateTime || '',
    status: statusForTimelineEvent(ev),
    isPlaceholder: false,
  }
}

function buildPlaceholderTimelogRow(categoryLabel) {
  return {
    category: categoryLabel,
    remark: '—',
    dateTime: null,
    endDateTime: '',
    status: '—',
    isPlaceholder: true,
  }
}

/**
 * Fixed 10-category checklist; unfilled categories show placeholder rows.
 * @param {Array} events - from GET /operations/:id/activity-timeline
 * @returns {Array<{ category, remark, dateTime, endDateTime, status, isPlaceholder }>}
 */
export function buildVesselActivitiesTimelog(events) {
  const buckets = new Map(VESSEL_ACTIVITIES_TIMELOG_TEMPLATE.map((t) => [t.id, []]))
  for (const ev of Array.isArray(events) ? events : []) {
    const templateId = mapEventToTemplateId(ev)
    if (templateId && buckets.has(templateId)) buckets.get(templateId).push(ev)
  }

  const rows = []
  for (const template of VESSEL_ACTIVITIES_TIMELOG_TEMPLATE) {
    const matched = (buckets.get(template.id) || []).slice().sort((a, b) => eventSortTime(a) - eventSortTime(b))
    if (matched.length === 0) {
      rows.push(buildPlaceholderTimelogRow(template.category))
      continue
    }
    for (const ev of matched) {
      rows.push(timelineEventToTimelogRow(ev, template.category))
    }
  }
  return rows
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
    return {
      category,
      remark: buildRemarkForTimelineEvent(ev),
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

export function resolveOperationPurpose(op, overviewRow) {
  return op?.purpose || overviewRow?.planPurposeLabel || overviewRow?.purpose || null
}

export function buildOverviewByOpId(overview) {
  const map = new Map()
  for (const row of overview?.queue || []) {
    if (row.operationId != null) map.set(Number(row.operationId), row)
  }
  return map
}

export function buildPlanRefByShipmentPlanId(shipmentPlans) {
  const map = new Map()
  for (const plan of Array.isArray(shipmentPlans) ? shipmentPlans : []) {
    const id = plan?.id != null ? Number(plan.id) : null
    const ref = plan?.planReference ?? plan?.plan_reference ?? null
    if (id != null && ref) map.set(id, ref)
  }
  return map
}

export function resolveOperationPlanReference(op, overviewRow, planRefByShipmentPlanId) {
  if (overviewRow?.planReference) return overviewRow.planReference
  const planId = op?.shipmentPlanId != null ? Number(op.shipmentPlanId) : null
  if (planId != null && planRefByShipmentPlanId?.has(planId)) {
    return planRefByShipmentPlanId.get(planId)
  }
  return null
}

export function operationMatchesPlanRefFilter(op, overviewByOpId, planRefFilter, planRefByShipmentPlanId) {
  const term = String(planRefFilter || '').trim()
  if (!term) return true
  const overviewRow = overviewByOpId.get(Number(op.id))
  const planRef = resolveOperationPlanReference(op, overviewRow, planRefByShipmentPlanId)
  if (!planRef) return false
  return String(planRef).toLowerCase().includes(term.toLowerCase())
}

export function operationMatchesPurposeFilter(op, overviewByOpId, selectedPurposes) {
  if (!Array.isArray(selectedPurposes) || selectedPurposes.length === 0) return true
  const want = new Set(selectedPurposes.map(String))
  const purpose = resolveOperationPurpose(op, overviewByOpId.get(Number(op.id)))
  return purpose != null && want.has(String(purpose))
}

/**
 * @param {object} op - operation from API
 * @param {object|null} si - shipping instruction from API (with breakdown)
 * @param {object|undefined} overviewRow - allocation overview queue row for same operationId
 */
export function buildDailyReportHeader(op, si, overviewRow, planRefByShipmentPlanId) {
  const shipper = si?.shipperNames || overviewRow?.shipper || '—'
  const surveyor = si?.surveyorName || overviewRow?.surveyor || '—'
  const agent = si?.agentName || overviewRow?.agent || '—'
  const commodity =
    op.commodityShortDisplay ||
    overviewRow?.commodityShortDisplay ||
    op.commodity ||
    si?.commodity ||
    '—'
  const quantity = summarizeQuantityFromSiBreakdown(si?.breakdown)
  const loadPort = si?.loadingPortName || '—'
  const dischPort = si?.destinationText || '—'

  return {
    planRef: resolveOperationPlanReference(op, overviewRow, planRefByShipmentPlanId) || '—',
    shippingInstruction:
      op.referenceNumber || (op.shippingInstructionId ? `SI-${op.shippingInstructionId}` : '—'),
    commodity,
    quantity,
    purpose: resolveOperationPurpose(op, overviewRow) || '—',
    eta: op.eta ?? overviewRow?.etaDateTime ?? null,
    actualArrival: op.ta ?? overviewRow?.taDateTime ?? null,
    etb: op.etb ?? overviewRow?.etbDateTime ?? overviewRow?.plannedEtbDateTime ?? null,
    actualBerthing: op.tbAt ?? op.dockingStartTime ?? overviewRow?.tbDateTime ?? null,
    estimationOfCompletion:
      op.estimatedCompletionTime ?? overviewRow?.estimatedCompletionDateTime ?? null,
    castOff: op.castOffAt ?? overviewRow?.castOffDateTime ?? null,
    sailedAt: op.sailedAt ?? null,
    jetty: op.jettyName || overviewRow?.jetty || '—',
    vessel: op.vesselName || '—',
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
export function buildSingleOperationReportBlock(op, si, overviewRow, events, startDate, endDate, planRefByShipmentPlanId) {
  const fullTimelog = buildVesselActivitiesTimelog(events)
  const filledRows = fullTimelog.filter((row) => !row.isPlaceholder)
  const hasRange = Boolean(startDate && endDate)
  const hasFilledInRange =
    !hasRange || filledRows.some((row) => timelogEntryOverlapsRange(row, startDate, endDate))
  if (hasRange && !hasFilledInRange) return null
  return {
    vesselId: String(op.id),
    vesselName: op.vesselName || '—',
    header: buildDailyReportHeader(op, si, overviewRow, planRefByShipmentPlanId),
    timelog: fullTimelog,
  }
}
