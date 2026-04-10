import { apiGet, apiPost, apiPut, apiDelete, apiPostForm } from './client.js'

export function fetchOperations(params = {}) {
  const sp = new URLSearchParams()
  if (params.portId) sp.set('port_id', params.portId)
  if (params.jettyId) sp.set('jetty_id', params.jettyId)
  if (params.status) sp.set('status', params.status)
  if (params.purpose) sp.set('purpose', params.purpose)
  if (params.signoffRequested) sp.set('signoff_requested', '1')
  const q = sp.toString()
  return apiGet(`/operations${q ? `?${q}` : ''}`)
}

export function fetchPendingSignoffRequests() {
  return apiGet('/operations/pending-signoff-requests')
}

export function fetchAtBerth() {
  return apiGet('/operations/at-berth')
}

export function fetchOperation(id) {
  return apiGet(`/operations/${id}`)
}

export function saveEstimatedCompletion(operationId, estimatedCompletionTime, meta) {
  return apiPut(`/operations/${operationId}/estimated-completion`, {
    estimated_completion_time: estimatedCompletionTime,
    meta: meta ?? null,
  })
}

export function createOperation(shippingInstructionId, jettyId) {
  return apiPost('/operations', {
    shipping_instruction_id: shippingInstructionId,
    jetty_id: jettyId,
  })
}

export function updateOperation(id, body) {
  return apiPut(`/operations/${id}`, {
    status: body.status,
    completion_percent: body.completionPercent,
  })
}

/**
 * @param {object} [options]
 * @param {'allocation'|'at-berth'} [options.activityLogPage] — where this action is initiated (for activity log page filter).
 */
export function setOperationShiftingOut(operationId, shiftingOut, remark, options) {
  const shift = Boolean(shiftingOut)
  const body = { shiftingOut: shift }
  if (shift) {
    body.remark = remark != null ? String(remark) : ''
  } else if (remark !== undefined) {
    body.remark = remark != null ? String(remark) : ''
  }
  const logPage = options?.activityLogPage
  if (logPage === 'allocation' || logPage === 'at-berth') {
    body.activityLogPage = logPage
  }
  return apiPost(`/operations/${operationId}/shifting-out`, body)
}

export function startDocking(id, dockingStartTime) {
  return apiPost(`/operations/${id}/start-docking`, {
    docking_start_time: dockingStartTime ?? undefined,
  })
}

export function fetchMaterials(operationId) {
  return apiGet(`/operations/${operationId}/materials`)
}

export function addMaterial(operationId, materialKey, volume) {
  return apiPost(`/operations/${operationId}/materials`, {
    material_key: materialKey,
    volume,
  })
}

export function deleteMaterial(operationId, materialRowId) {
  return apiDelete(`/operations/${operationId}/materials/${materialRowId}`)
}

export function fetchQcSurveys(operationId) {
  return apiGet(`/operations/${operationId}/qc-surveys`)
}

export function createQcSurvey(operationId, body) {
  return apiPost(`/operations/${operationId}/qc-surveys`, {
    phase: body.phase,
    step_key: body.stepKey,
    status: body.status ?? 'Pending',
    result: body.result,
    remarks: body.remarks,
    occurred_at: body.occurredAt,
    documents: body.documents,
  })
}

export function updateQcSurvey(surveyId, body) {
  return apiPut(`/qc-surveys/${surveyId}`, {
    status: body.status,
    result: body.result,
    remarks: body.remarks,
    occurred_at: body.occurredAt,
  })
}

export function fetchQuantityChecks(operationId) {
  return apiGet(`/operations/${operationId}/quantity-checks`)
}

export function createQuantityCheck(operationId, body) {
  return apiPost(`/operations/${operationId}/quantity-checks`, {
    phase: body.phase,
    check_key: body.checkKey,
    value_json: body.value,
    remarks: body.remarks,
    occurred_at: body.occurredAt,
  })
}

export function updateQuantityCheck(checkId, body) {
  return apiPut(`/quantity-checks/${checkId}`, {
    value_json: body.value,
    remarks: body.remarks,
    occurred_at: body.occurredAt,
  })
}

export function requestException(operationId, justification, documentUrl) {
  return apiPost(`/operations/${operationId}/request-exception`, {
    justification,
    exception_document_url: documentUrl,
  })
}

export function approveException(operationId, approverUserId) {
  return apiPost(`/operations/${operationId}/approve-exception`, {
    approver_user_id: approverUserId,
  })
}

export function rejectException(operationId, approverUserId) {
  return apiPost(`/operations/${operationId}/reject-exception`, {
    approver_user_id: approverUserId,
  })
}

export function signoffRequest(operationId, remark) {
  return apiPost(`/operations/${operationId}/signoff-request`, {
    remark: remark != null && String(remark).trim() ? String(remark).trim() : undefined,
  })
}

export function signoff(operationId) {
  return apiPost(`/operations/${operationId}/signoff`, {})
}

export function depart(operationId, castOffAt, clearanceUrl, photoUrl) {
  return apiPost(`/operations/${operationId}/depart`, {
    cast_off_at: castOffAt,
    clearance_document_url: clearanceUrl,
    vessel_photo_url: photoUrl,
  })
}

export async function uploadOperationDocuments(operationId, kind, files) {
  const form = new FormData()
  for (const f of Array.from(files || [])) {
    form.append('files', f)
  }
  return apiPostForm(
    `/operation-documents/operations/${encodeURIComponent(String(operationId))}/${encodeURIComponent(String(kind))}`,
    form,
    60000
  )
}

export function deleteOperation(id) {
  return apiDelete(`/operations/${id}`)
}

export function fetchSubProcesses(operationId, phase) {
  const q = phase ? `?phase=${encodeURIComponent(phase)}` : ''
  return apiGet(`/operations/${operationId}/sub-processes${q}`)
}

/**
 * Sub-process times from `datetime-local` (no timezone) must be converted in the **browser**
 * so the server receives an unambiguous instant (RFC3339). Otherwise Node may treat
 * `YYYY-MM-DDTHH:mm` as UTC while the user entered local time, or merge logic can break ranges.
 */
function normalizeSubProcessTimestampForApi(v) {
  if (v === undefined) return undefined
  if (v === null || v === '') return null
  const s = String(v).trim()
  if (!s) return null
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) {
    throw new Error('Invalid date or time')
  }
  return d.toISOString()
}

export function upsertSubProcess(operationId, subProcessKey, body) {
  const nOcc = normalizeSubProcessTimestampForApi(body.occurredAt)
  const nStart = normalizeSubProcessTimestampForApi(body.startAt)
  const nEnd = normalizeSubProcessTimestampForApi(body.endAt)

  const base = {
    phase: body.phase,
    status: body.status,
    skipReason: body.skipReason,
    remark: body.remark,
    payload: body.payload,
  }

  // Post-Checking: always send all three keys (null or ISO). Omitting a key made JSON drop `endAt`,
  // so the API kept a stale DB `end_at` and merged it with a new `start_at` → invalid range 400.
  if (body.phase === 'Post-Checking') {
    return apiPut(`/operations/${operationId}/sub-processes/${encodeURIComponent(subProcessKey)}`, {
      ...base,
      occurredAt: nOcc === undefined ? null : nOcc,
      startAt: nStart === undefined ? null : nStart,
      endAt: nEnd === undefined ? null : nEnd,
    })
  }

  return apiPut(`/operations/${operationId}/sub-processes/${encodeURIComponent(subProcessKey)}`, {
    ...base,
    ...(nOcc !== undefined ? { occurredAt: nOcc } : {}),
    ...(nStart !== undefined ? { startAt: nStart } : {}),
    ...(nEnd !== undefined ? { endAt: nEnd } : {}),
  })
}

export function deleteSubProcess(operationId, subProcessKey, phase) {
  const q = `?phase=${encodeURIComponent(phase)}`
  return apiDelete(`/operations/${operationId}/sub-processes/${encodeURIComponent(subProcessKey)}${q}`)
}

export function fetchSubProcessDocuments(operationId, subProcessKey, phase = 'Pre-Checking') {
  return apiGet(
    `/operations/${operationId}/sub-processes/${encodeURIComponent(subProcessKey)}/documents?phase=${encodeURIComponent(phase)}`
  )
}

export function deleteSubProcessDocument(operationId, subProcessKey, documentId, phase = 'Pre-Checking') {
  const q = `?phase=${encodeURIComponent(phase)}`
  return apiDelete(
    `/operations/${operationId}/sub-processes/${encodeURIComponent(subProcessKey)}/documents/${encodeURIComponent(String(documentId))}${q}`
  )
}

export async function uploadSubProcessDocuments(operationId, subProcessKey, phase, files) {
  const form = new FormData()
  const phaseValue = phase || 'Pre-Checking'
  form.append('phase', phaseValue)
  for (const f of Array.from(files || [])) {
    form.append('files', f)
  }
  return apiPostForm(
    `/operations/${operationId}/sub-processes/${encodeURIComponent(subProcessKey)}/documents?phase=${encodeURIComponent(phaseValue)}`,
    form,
    60000
  )
}

export function fetchNorDetails(operationId) {
  return apiGet(`/operations/${operationId}/nor-details`)
}

export function updateNorDetails(operationId, body) {
  const req = {
    remark: body?.remark ?? '',
    payload: body?.payload ?? null,
  }
  if (body && Object.prototype.hasOwnProperty.call(body, 'demurrageLiabilityFromAt')) {
    req.demurrageLiabilityFromAt = body.demurrageLiabilityFromAt
  }
  return apiPut(`/operations/${operationId}/nor-details`, req)
}

/** Operational milestone activities + N/A (merged entry_type). */
export function fetchOperationalActivities(operationId) {
  return apiGet(`/operations/${operationId}/operational-activities`)
}

export function createOperationalEntry(operationId, body) {
  return apiPost(`/operations/${operationId}/operational-activities`, {
    entryType: body.entryType,
    milestoneKey: body.milestoneKey,
    subStepTitle: body.subStepTitle,
    remark: body.remark,
    startAt: body.startAt,
    endAt: body.endAt,
    reason: body.reason,
    markedAt: body.markedAt,
    cargoHandlingMethodId: body.cargoHandlingMethodId,
  })
}

export function updateOperationalEntry(operationId, entryId, body) {
  return apiPut(`/operations/${operationId}/operational-activities/${entryId}`, {
    milestoneKey: body.milestoneKey,
    subStepTitle: body.subStepTitle,
    remark: body.remark,
    startAt: body.startAt,
    endAt: body.endAt,
    reason: body.reason,
    markedAt: body.markedAt,
    cargoHandlingMethodId: body.cargoHandlingMethodId,
  })
}

export function deleteOperationalEntry(operationId, entryId) {
  return apiDelete(`/operations/${operationId}/operational-activities/${entryId}`)
}

export function fetchActivityTimeline(operationId) {
  return apiGet(`/operations/${operationId}/activity-timeline`)
}

export function fetchCargoHandlingMethods() {
  return apiGet('/master/cargo-handling-methods')
}
