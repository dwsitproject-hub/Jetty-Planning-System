/**
 * Builds Daily Activities Report data by aggregating allocation, berthing, pre-check,
 * operational activities, post-check, and clearance. Used by DailyActivitiesReport page.
 */

/** Normalize activity category for display (e.g. COMM DISCHARGE → COMM DISCH) */
function normalizeCategory(cat) {
  if (!cat) return ''
  if (cat === 'COMM DISCHARGE') return 'COMM DISCH'
  if (cat === 'COMPL DISCHARGE') return 'COMPL DISCH'
  return cat
}

/** Parse date string to start of day (UTC) for comparison */
function startOfDay(s) {
  if (!s) return null
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  d.setUTCHours(0, 0, 0, 0)
  return d.getTime()
}

/** Parse date string to end of day (UTC) for comparison */
function endOfDay(s) {
  if (!s) return null
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  d.setUTCHours(23, 59, 59, 999)
  return d.getTime()
}

/** Check if a date string falls within [startDate, endDate] (inclusive, day granularity) */
function isInDateRange(dateStr, startDate, endDate) {
  if (!dateStr || !startDate || !endDate) return false
  const t = new Date(dateStr).getTime()
  if (Number.isNaN(t)) return false
  const start = startOfDay(startDate)
  const end = endOfDay(endDate)
  return t >= start && t <= end
}

/**
 * Build timelog entries for one vessel from all sources.
 * Each entry: { category, remark, dateTime, endDateTime }
 */
function buildTimelogForVessel(vesselId, deps) {
  const {
    allocationPlan,
    getArrivalNor,
    getBerthingEvents,
    getPreChecking,
    getPostChecking,
    getLoadingOperation,
    getClearance,
  } = deps

  const plan = allocationPlan.find((p) => p.vesselId === vesselId) || {}
  const arrivalNor = getArrivalNor(vesselId) || {}
  const berthing = getBerthingEvents(vesselId) || {}
  const preCheck = getPreChecking(vesselId) || {}
  const postCheck = getPostChecking(vesselId) || {}
  const loadingOp = getLoadingOperation(vesselId) || {}
  const clearance = getClearance(vesselId) || {}

  const entries = []

  if (plan.taDateTime) {
    entries.push({ category: 'VESSEL ARRIVED (TA)', remark: '', dateTime: plan.taDateTime, endDateTime: '' })
  }
  if (arrivalNor.norTenderedDateTime) {
    entries.push({ category: 'NOR TENDERED', remark: '', dateTime: arrivalNor.norTenderedDateTime, endDateTime: '' })
  }
  if (berthing.pob) {
    entries.push({ category: 'POB', remark: '', dateTime: berthing.pob, endDateTime: '' })
  }
  if (berthing.allFast) {
    entries.push({ category: 'ALL FAST (TB)', remark: '', dateTime: berthing.allFast, endDateTime: '' })
  }
  if (berthing.sob) {
    entries.push({ category: 'SOB', remark: '', dateTime: berthing.sob, endDateTime: '' })
  }
  if (preCheck.keyMeeting?.dateTime) {
    entries.push({
      category: 'KEY MEETING',
      remark: preCheck.keyMeeting.remark || '',
      dateTime: preCheck.keyMeeting.dateTime,
      endDateTime: '',
    })
  }
  if (arrivalNor.norAcceptedDateTime) {
    entries.push({ category: 'NOR ACCEPTED', remark: '', dateTime: arrivalNor.norAcceptedDateTime, endDateTime: '' })
  }
  const inspectionDt =
    preCheck.inspection?.dateTime || preCheck.inspection?.startTime || preCheck.tankInspection?.dateTime || preCheck.holdInspection?.dateTime
  if (inspectionDt) {
    const isHold =
      preCheck.inspection?.inspectionType === 'Hold' ||
      (!preCheck.inspection && preCheck.holdInspection?.dateTime && !preCheck.tankInspection?.dateTime)
    entries.push({
      category: isHold ? 'HOLD INSPECTION' : 'TANK INSPECTION',
      remark: preCheck.inspection?.remark || preCheck.tankInspection?.remark || preCheck.holdInspection?.remark || '',
      dateTime: inspectionDt,
      endDateTime: '',
    })
  }
  if (preCheck.sampling?.dateTime) {
    entries.push({
      category: 'SAMPLING',
      remark: preCheck.sampling.remark || '',
      dateTime: preCheck.sampling.dateTime,
      endDateTime: '',
    })
  }
  const iccDt =
    preCheck.initialCargoChecking?.dateTime ||
    preCheck.initialCargoChecking?.startTime ||
    preCheck.initialSounding?.dateTime ||
    preCheck.initialDraftSurvey?.dateTime
  if (iccDt) {
    const isDraft =
      preCheck.initialCargoChecking?.cargoCheckingType === 'Draft Survey' ||
      (!preCheck.initialCargoChecking && preCheck.initialDraftSurvey?.dateTime && !preCheck.initialSounding?.dateTime)
    entries.push({
      category: isDraft ? 'INITIAL DRAFT SURVEY' : 'INITIAL SOUNDING/ULLAGE&CAL',
      remark:
        preCheck.initialCargoChecking?.remark ||
        preCheck.initialCargoChecking?.result ||
        preCheck.initialSounding?.result ||
        preCheck.initialDraftSurvey?.result ||
        '',
      dateTime: iccDt,
      endDateTime: '',
    })
  }

  const activities = loadingOp.activities || []
  activities.forEach((a) => {
    entries.push({
      category: normalizeCategory(a.category),
      remark: a.description || '',
      dateTime: a.startTime || '',
      endDateTime: a.endTime || '',
    })
  })

  const finalCargoCheckingDt =
    postCheck.finalCargoChecking?.dateTime ||
    postCheck.finalCargoChecking?.startTime ||
    postCheck.finalSounding?.dateTime
  if (finalCargoCheckingDt) {
    entries.push({
      category: 'FINAL CARGO CHECKING',
      remark: postCheck.finalCargoChecking?.result || postCheck.finalSounding?.result || '',
      dateTime: finalCargoCheckingDt,
      endDateTime: '',
    })
  }
  const finalInspectionDt =
    postCheck.finalInspection?.dateTime ||
    postCheck.finalInspection?.startTime ||
    postCheck.finalTankInspection?.dateTime ||
    postCheck.finalHoldInspection?.dateTime
  if (finalInspectionDt) {
    entries.push({
      category: 'FINAL INSPECTION',
      remark:
        postCheck.finalInspection?.result ||
        postCheck.finalTankInspection?.result ||
        postCheck.finalHoldInspection?.result ||
        '',
      dateTime: finalInspectionDt,
      endDateTime: '',
    })
  }
  if (clearance.hoseOff) {
    entries.push({ category: 'HOSE Off', remark: '', dateTime: clearance.hoseOff, endDateTime: '' })
  }
  if (clearance.castOff) {
    entries.push({ category: 'CAST Off', remark: '', dateTime: clearance.castOff, endDateTime: '' })
  }

  return entries.sort((a, b) => {
    const ta = a.dateTime ? new Date(a.dateTime).getTime() : 0
    const tb = b.dateTime ? new Date(b.dateTime).getTime() : 0
    return ta - tb
  })
}

/**
 * Build progress (QTY LOAD/DISCHARGE, RATE, BALANCE) for one vessel.
 * Uses steps quantityResult and vessel mock where available.
 */
function buildProgressForVessel(vesselId, deps) {
  const { getSteps, vessels } = deps
  const vessel = vessels[vesselId]
  const steps = getSteps ? getSteps(vesselId) : null
  let qtyLoadDischarge = '—'
  let rate = '—'
  let balance = '—'
  if (vessel?.quantity != null) {
    const totalQty = vessel.totalQuantityDischarged ?? vessel.quantity
    qtyLoadDischarge = `${Number(totalQty ?? 0).toLocaleString('en-US', { minimumFractionDigits: 0 })} MT`
  }
  if (vessel?.avgPumpingRateMTPerHour != null) {
    rate = `${vessel.avgPumpingRateMTPerHour} MT/h`
  }
  if (steps?.B?.quantityResult) {
    qtyLoadDischarge = steps.B.quantityResult
  }
  return { qtyLoadDischarge, rate, balance }
}

/**
 * @param filters { startDate, endDate, selectedVesselIds (string[]), selectedJettyIds (string[]) }
 * @param deps { allocationPlan, getLoadingOperationCargo, getArrivalNor, getBerthingEvents, getPreChecking, getPostChecking, getLoadingOperation, getClearance, getAtBerthOperations, getSteps, vessels }
 * @returns { vessels: Array<{ vesselId, vesselName, header, timelog, progress }> }
 */
export function buildDailyActivitiesReport(filters, deps) {
  const { allocationPlan, getLoadingOperationCargo, getAtBerthOperations, vessels } = deps
  const loadingOps = getAtBerthOperations('Loading') || []
  const unloadingOps = getAtBerthOperations('Unloading') || []
  const atBerthIds = new Set([...loadingOps.map((o) => o.vesselId), ...unloadingOps.map((o) => o.vesselId)])
  const planIds = new Set((allocationPlan || []).map((p) => p.vesselId))
  const candidateIds = [...new Set([...atBerthIds, ...planIds])]

  const startDate = (filters.startDate || '').trim()
  const endDate = (filters.endDate || '').trim()
  const selectedVesselIds = Array.isArray(filters.selectedVesselIds) ? filters.selectedVesselIds : []
  const selectedJettyIds = Array.isArray(filters.selectedJettyIds) ? filters.selectedJettyIds : []

  const result = []

  for (const vesselId of candidateIds) {
    const cargo = getLoadingOperationCargo(vesselId)
    const plan = (allocationPlan || []).find((p) => p.vesselId === vesselId) || {}
    const jetty = plan.jetty || cargo?.jettyName || '—'

    if (selectedVesselIds.length > 0 && !selectedVesselIds.includes(vesselId)) {
      continue
    }
    if (selectedJettyIds.length > 0 && !selectedJettyIds.includes(jetty)) {
      continue
    }

    const vesselName = cargo?.vesselName || plan.vesselName || vesselId

    const timelog = buildTimelogForVessel(vesselId, deps)
    const hasInRange = !startDate || !endDate || timelog.some((e) => isInDateRange(e.dateTime, startDate, endDate))
    if (startDate && endDate && !hasInRange) continue

    const header = {
      jetty,
      vessel: vesselName,
      commodity: cargo?.commodity ?? '—',
      quantity: cargo?.quantity ?? '—',
      stowage: cargo?.stowage ?? '—',
      loadPort: cargo?.loadPort ?? '—',
      dischPort: cargo?.dischPort ?? '—',
      shipper: cargo?.shipper ?? '—',
      consignee: cargo?.consignee ?? '—',
      surveyor: cargo?.surveyor ?? '—',
      agent: cargo?.agent ?? '—',
    }
    const progress = buildProgressForVessel(vesselId, { ...deps, vessels: vessels || {} })

    result.push({
      vesselId,
      vesselName: header.vessel,
      header,
      timelog,
      progress,
    })
  }

  return { vessels: result }
}
