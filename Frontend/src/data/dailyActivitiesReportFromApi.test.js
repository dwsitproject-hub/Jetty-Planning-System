import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildDailyReportHeader,
  buildOverviewByOpId,
  buildPlanRefByShipmentPlanId,
  buildSingleOperationReportBlock,
  buildVesselActivitiesTimelog,
  mapEventToTemplateId,
  operationIsEligibleForReport,
  operationScheduleOverlapsRange,
  operationMatchesPlanRefFilter,
  operationMatchesPurposeFilter,
  resolveOperationPurpose,
  DAILY_ACTIVITIES_HEADER_FIELDS,
  VESSEL_ACTIVITIES_TIMELOG_TEMPLATE,
} from './dailyActivitiesReportFromApi.js'

test('buildDailyReportHeader maps schedule and plan fields without duplicate commodity/qty', () => {
  const op = {
    id: 42,
    vesselName: 'MV Test',
    referenceNumber: 'SI-2026-001',
    shippingInstructionId: 9,
    purpose: 'Loading',
    commodityShortDisplay: 'FO',
    eta: '2026-08-01T08:00:00.000Z',
    ta: '2026-08-01T10:00:00.000Z',
    etb: '2026-08-01T12:00:00.000Z',
    tbAt: '2026-08-01T12:30:00.000Z',
    estimatedCompletionTime: '2026-08-02T18:00:00.000Z',
    castOffAt: '2026-08-03T06:00:00.000Z',
    sailedAt: '2026-08-03T08:00:00.000Z',
    jettyName: 'Jetty 2A',
    status: 'IN_PROGRESS',
  }
  const overviewRow = {
    planReference: 'SP-26-08-00042',
    commodityShortDisplay: 'FO',
    planPurposeLabel: 'Loading',
  }
  const si = {
    breakdown: [{ qty: 5000, metricLabel: 'MT' }],
    loadingPortName: 'Singapore',
    destinationText: 'Jakarta',
    shipperNames: 'Shipper A',
    consigneeText: 'Consignee B',
    surveyorName: 'Surveyor C',
    agentName: 'Agent D',
  }

  const header = buildDailyReportHeader(op, si, overviewRow)

  assert.equal(header.planRef, 'SP-26-08-00042')
  assert.equal(header.shippingInstruction, 'SI-2026-001')
  assert.equal(header.commodity, 'FO')
  assert.equal(header.quantity, '5000 MT')
  assert.equal(header.purpose, 'Loading')
  assert.ok(header.eta)
  assert.ok(header.actualArrival)
  assert.ok(header.etb)
  assert.ok(header.actualBerthing)
  assert.ok(header.estimationOfCompletion)
  assert.ok(header.castOff)
  assert.ok(header.sailedAt)
  assert.equal(header.jetty, 'Jetty 2A')
  assert.equal(header.vessel, 'MV Test')

  const commodityKeys = DAILY_ACTIVITIES_HEADER_FIELDS.filter((f) => /commodity|qty/i.test(f.label))
  assert.equal(commodityKeys.length, 2)
})

test('plan ref filter matches shipment plan when operation is absent from allocation overview', () => {
  const overview = buildOverviewByOpId({ queue: [] })
  const planRefByShipmentPlanId = buildPlanRefByShipmentPlanId([
    { id: 21, planReference: 'SP-26-06-00021' },
  ])
  const op = { id: 12, shipmentPlanId: 21, vesselName: 'BG AS MARINA 2', status: 'SAILED', tbAt: '2026-06-22T17:35:00.000Z' }
  assert.equal(
    operationMatchesPlanRefFilter(op, overview, 'SP-26-06-00021', planRefByShipmentPlanId),
    true
  )
})

test('plan ref and purpose filters', () => {
  const overview = {
    queue: [
      { operationId: 1, planReference: 'SP-26-01-00001', planPurposeLabel: 'Loading' },
      { operationId: 2, planReference: 'SP-26-01-00002', purpose: 'Unloading' },
    ],
  }
  const map = buildOverviewByOpId(overview)

  assert.equal(operationMatchesPlanRefFilter({ id: 1 }, map, 'sp-26-01-00001'), true)
  assert.equal(operationMatchesPlanRefFilter({ id: 2 }, map, 'sp-26-01-00001'), false)
  assert.equal(operationMatchesPlanRefFilter({ id: 3 }, map, 'SP'), false)

  assert.equal(operationMatchesPurposeFilter({ id: 1, purpose: 'Loading' }, map, ['Loading']), true)
  assert.equal(operationMatchesPurposeFilter({ id: 2 }, map, ['Loading']), false)
  assert.equal(resolveOperationPurpose({ purpose: 'Loading' }, map.get(1)), 'Loading')
})

test('buildVesselActivitiesTimelog emits all template categories as placeholders when empty', () => {
  const rows = buildVesselActivitiesTimelog([])
  assert.equal(rows.length, VESSEL_ACTIVITIES_TIMELOG_TEMPLATE.length)
  assert.deepEqual(
    rows.map((r) => r.category),
    VESSEL_ACTIVITIES_TIMELOG_TEMPLATE.map((t) => t.category)
  )
  assert.ok(rows.every((r) => r.isPlaceholder))
  assert.ok(rows.every((r) => r.remark === '—' && r.status === '—'))
})

test('buildVesselActivitiesTimelog maps logged events to fixed category labels', () => {
  const events = [
    {
      source: 'sub_process',
      phase: 'Pre-Checking',
      subProcessKey: 'key_meeting',
      title: 'KEY MEETING',
      status: 'Done',
      remark: 'Kick-off done',
      startAt: '2026-08-05T08:00:00.000Z',
      endAt: '2026-08-05T09:00:00.000Z',
    },
    {
      source: 'operational_activity',
      phase: 'Operational',
      milestoneKey: 'cargo_operations',
      title: 'CARGO OPERATIONS',
      startAt: '2026-08-06T10:00:00.000Z',
      endAt: '2026-08-06T12:00:00.000Z',
      remark: 'Segment 1',
    },
  ]
  const rows = buildVesselActivitiesTimelog(events)
  const keyMeeting = rows.find((r) => r.category === 'Pre-Checking - Key Meeting')
  const cargoOps = rows.find((r) => r.category === 'Operational - Cargo Operations')
  assert.equal(keyMeeting?.isPlaceholder, false)
  assert.equal(keyMeeting?.remark, 'Kick-off done')
  assert.equal(keyMeeting?.status, 'Done')
  assert.equal(cargoOps?.isPlaceholder, false)
  assert.equal(cargoOps?.remark, 'Segment 1')
  assert.equal(rows.filter((r) => r.isPlaceholder).length, VESSEL_ACTIVITIES_TIMELOG_TEMPLATE.length - 2)
})

test('buildVesselActivitiesTimelog supports multiple rows in one category', () => {
  const events = [
    {
      source: 'operational_activity',
      milestoneKey: 'cargo_operations',
      startAt: '2026-08-06T14:00:00.000Z',
      endAt: '2026-08-06T16:00:00.000Z',
    },
    {
      source: 'operational_activity',
      milestoneKey: 'cargo_operations',
      startAt: '2026-08-06T10:00:00.000Z',
      endAt: '2026-08-06T12:00:00.000Z',
    },
  ]
  const rows = buildVesselActivitiesTimelog(events)
  const cargoRows = rows.filter((r) => r.category === 'Operational - Cargo Operations')
  assert.equal(cargoRows.length, 2)
  assert.equal(cargoRows[0].dateTime, '2026-08-06T10:00:00.000Z')
  assert.equal(cargoRows[1].dateTime, '2026-08-06T14:00:00.000Z')
})

test('buildVesselActivitiesTimelog marks start-only Opening and Pre-conditioning as Done', () => {
  const events = [
    {
      source: 'operational_activity',
      milestoneKey: 'opening_hatch',
      startAt: '2026-07-16T08:40:00.000Z',
      subStepTitle: 'Open ramdoor',
      cargoHandlingMethodName: 'Conveyor',
      remark: 'Unload by truck',
    },
    {
      source: 'operational_activity',
      milestoneKey: 'cargo_pre_conditioning',
      startAt: '2026-07-16T10:22:00.000Z',
      remark: 'N/a',
    },
  ]
  const rows = buildVesselActivitiesTimelog(events)
  const opening = rows.find((r) => r.category === 'Operational - Opening')
  const preCond = rows.find((r) => r.category === 'Operational - Cargo Pre-Conditioning')
  assert.equal(opening?.status, 'Done')
  assert.equal(opening?.endDateTime, '')
  assert.equal(preCond?.status, 'Done')
  assert.equal(preCond?.endDateTime, '')
})

test('mapEventToTemplateId covers sub-process and milestone keys', () => {
  assert.equal(mapEventToTemplateId({ source: 'sub_process', subProcessKey: 'nor_accepted' }), 'pre_nor')
  assert.equal(
    mapEventToTemplateId({ source: 'operational_milestone_na', milestoneKey: 'other', reason: 'N/A' }),
    'op_other'
  )
  assert.equal(mapEventToTemplateId({ source: 'sub_process', subProcessKey: 'inspection' }), null)
})

test('operationIsEligibleForReport includes pre-berth and excludes sailed without TB', () => {
  assert.equal(operationIsEligibleForReport({ status: 'PENDING' }), true)
  assert.equal(operationIsEligibleForReport({ status: 'ALLOCATED' }), true)
  assert.equal(operationIsEligibleForReport({ status: 'DOCKED' }), true)
  assert.equal(operationIsEligibleForReport({ status: 'SAILED', tbAt: '2026-06-01T00:00:00.000Z' }), true)
  assert.equal(operationIsEligibleForReport({ status: 'SAILED' }), false)
})

test('operationScheduleOverlapsRange uses ETA and related schedule fields', () => {
  const op = { eta: '2026-09-05T08:00:00.000Z' }
  assert.equal(operationScheduleOverlapsRange(op, null, '2026-09-01', '2026-09-07'), true)
  assert.equal(operationScheduleOverlapsRange(op, null, '2026-10-01', '2026-10-07'), false)
})

test('buildSingleOperationReportBlock uses operation-level date filter and full checklist', () => {
  const op = { id: 7, vesselName: 'MV Alpha', purpose: 'Loading', status: 'IN_PROGRESS' }
  const events = [
    {
      source: 'sub_process',
      subProcessKey: 'key_meeting',
      status: 'Done',
      startAt: '2026-08-05T08:00:00.000Z',
      endAt: '2026-08-05T09:00:00.000Z',
    },
  ]
  const inRange = buildSingleOperationReportBlock(op, null, null, events, '2026-08-01', '2026-08-07', new Map())
  assert.ok(inRange)
  assert.equal(inRange.timelog.length, VESSEL_ACTIVITIES_TIMELOG_TEMPLATE.length)

  const outOfRange = buildSingleOperationReportBlock(op, null, null, events, '2026-09-01', '2026-09-07', new Map())
  assert.equal(outOfRange, null)

  const noEvents = buildSingleOperationReportBlock(op, null, null, [], '2026-08-01', '2026-08-07', new Map())
  assert.equal(noEvents, null)
})

test('buildSingleOperationReportBlock includes pre-berth op when ETA is in date range', () => {
  const op = {
    id: 99,
    vesselName: 'MV Pre-Berth',
    status: 'ALLOCATED',
    eta: '2026-09-05T08:00:00.000Z',
  }
  const block = buildSingleOperationReportBlock(op, null, null, [], '2026-09-01', '2026-09-07', new Map())
  assert.ok(block)
  assert.equal(block.timelog.length, VESSEL_ACTIVITIES_TIMELOG_TEMPLATE.length)
  assert.ok(block.timelog.every((r) => r.isPlaceholder))

  const outOfRange = buildSingleOperationReportBlock(op, null, null, [], '2026-10-01', '2026-10-07', new Map())
  assert.equal(outOfRange, null)
})
