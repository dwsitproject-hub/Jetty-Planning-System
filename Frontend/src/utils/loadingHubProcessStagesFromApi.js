/**
 * Hub-aligned Pre/Operational/Post stage counts (same rules as Loading.jsx stage rail).
 * Keep in sync with PreCheckingSections / PostCheckingSections hydration + processStages useMemo.
 */
import {
  fetchSubProcesses,
  fetchSubProcessDocuments,
  fetchOperationalActivities,
  fetchNorDetails,
} from '../api/operations'
import { fetchOperationDocuments } from '../api/allocation'
import {
  LOADING_ACTIVITY_CATEGORIES,
  UNLOADING_ACTIVITY_CATEGORIES,
} from '../data/mockData'
import { operationalMilestoneDoneCount, viewModelFromOperationalEntries } from '../data/operationalMilestones'

/** API ISO or datetime-local → `yyyy-mm-ddThh:mm` (same as Loading.jsx). */
export function isoOrDatetimeToLocal(value) {
  if (value == null || value === '') return ''
  const s = String(value).trim()
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) return s
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return ''
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const h = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${day}T${h}:${min}`
}

function laterIso(a, b) {
  if (!a && !b) return null
  if (!a) return b || null
  if (!b) return a || null
  const ta = new Date(a).getTime()
  const tb = new Date(b).getTime()
  const na = Number.isNaN(ta)
  const nb = Number.isNaN(tb)
  if (na && nb) return null
  if (na) return b
  if (nb) return a
  return ta >= tb ? a : b
}

const PRECHECK_SECTION_TO_KEY = {
  keyMeeting: 'key_meeting',
  norAccepted: 'nor_accepted',
  inspection: 'inspection',
  sampling: 'sampling',
  initialCargoChecking: 'initial_cargo_checking',
}

const PRECHECK_KEY_TO_SECTION = {
  ...Object.fromEntries(Object.entries(PRECHECK_SECTION_TO_KEY).map(([section, key]) => [key, section])),
  tank_inspection: 'inspection',
  hold_inspection: 'inspection',
  initial_sounding: 'initialCargoChecking',
  initial_draft_survey: 'initialCargoChecking',
}

const POSTCHECK_KEY_TO_SECTION = {
  final_inspection: 'finalInspection',
  final_tank_inspection: 'finalInspection',
  final_hold_inspection: 'finalInspection',
  final_sounding: 'finalCargoChecking',
}

export const POST_CHECK_SUB_TABS = [
  { id: 'finalInspection', label: 'FINAL INSPECTION' },
  { id: 'finalCargoChecking', label: 'FINAL CARGO CHECKING' },
]

export const POST_CHECK_STAGE_IDS = POST_CHECK_SUB_TABS.map((t) => t.id)

function precheckStatusRank(s) {
  const x = String(s || '').trim()
  if (x === 'Done') return 3
  if (x === 'In Progress') return 2
  return 1
}

function mergeInitialCargoHydration(current, row) {
  const p = row.payload && typeof row.payload === 'object' ? row.payload : {}
  const typeFromKey =
    row.subProcessKey === 'initial_draft_survey'
      ? 'Draft Survey'
      : row.subProcessKey === 'initial_sounding'
        ? 'Sounding'
        : null
  const next = {
    ...current,
    remark: [current.remark, row.remark].filter((x) => x && String(x).trim()).join('\n') || row.remark || current.remark || '',
    status:
      precheckStatusRank(row.status) >= precheckStatusRank(current.status) ? row.status || current.status : current.status,
    lastSavedAt: laterIso(row.updatedAt, current.lastSavedAt),
  }
  if (row.startAt || row.occurredAt) {
    const st = isoOrDatetimeToLocal(row.startAt || row.occurredAt)
    if (st) next.startTime = next.startTime || st
  }
  if (row.endAt) {
    const en = isoOrDatetimeToLocal(row.endAt)
    if (en) next.endTime = next.endTime || en
  }
  const remarkResult = row.remark || p.result || ''
  if (remarkResult) next.remark = remarkResult
  next.cargoCheckingType = typeFromKey || p.cargoCheckingType || current.cargoCheckingType
  return next
}

function mergeInspectionHydration(current, row) {
  const p = row.payload && typeof row.payload === 'object' ? row.payload : {}
  const typeFromKey =
    row.subProcessKey === 'hold_inspection' ? 'Hold' : row.subProcessKey === 'tank_inspection' ? 'Tank' : null
  const next = {
    ...current,
    remark: [current.remark, row.remark].filter((x) => x && String(x).trim()).join('\n') || row.remark || current.remark || '',
    status:
      precheckStatusRank(row.status) >= precheckStatusRank(current.status) ? row.status || current.status : current.status,
    lastSavedAt: laterIso(row.updatedAt, current.lastSavedAt),
  }
  if (row.startAt || row.occurredAt) {
    const st = isoOrDatetimeToLocal(row.startAt || row.occurredAt)
    if (st) next.startTime = next.startTime || st
  }
  if (row.endAt) {
    const en = isoOrDatetimeToLocal(row.endAt)
    if (en) next.endTime = next.endTime || en
  }
  next.inspectionType = typeFromKey || p.inspectionType || current.inspectionType
  return next
}

function mergeFinalInspectionHydration(current, row, commodityType = 'Liquid') {
  const p = row.payload && typeof row.payload === 'object' ? row.payload : {}
  const typeFromKey =
    row.subProcessKey === 'final_hold_inspection'
      ? 'Hold'
      : row.subProcessKey === 'final_tank_inspection'
        ? 'Tank'
        : null
  const fallbackType = commodityType === 'Solid' ? 'Hold' : 'Tank'
  const next = {
    ...current,
    result: [current.result, row.remark].filter((x) => x && String(x).trim()).join('\n') || row.remark || current.result || '',
    status:
      precheckStatusRank(row.status) >= precheckStatusRank(current.status) ? row.status || current.status : current.status,
    lastSavedAt: laterIso(row.updatedAt, current.lastSavedAt),
    inspectionType: typeFromKey || p.inspectionType || current.inspectionType || fallbackType,
  }
  if (row.startAt || row.occurredAt) {
    const st = isoOrDatetimeToLocal(row.startAt || row.occurredAt)
    if (st) next.startTime = next.startTime || st
  }
  if (row.endAt) {
    const en = isoOrDatetimeToLocal(row.endAt)
    if (en) next.endTime = next.endTime || en
  }
  return next
}

function mergeFinalCargoCheckingHydration(current, row, commodityType = 'Liquid') {
  const p = row.payload && typeof row.payload === 'object' ? row.payload : {}
  const fallbackType = commodityType === 'Solid' ? 'Draft Survey' : 'Sounding'
  const next = {
    ...current,
    result: [current.result, row.remark].filter((x) => x && String(x).trim()).join('\n') || row.remark || current.result || '',
    status:
      precheckStatusRank(row.status) >= precheckStatusRank(current.status) ? row.status || current.status : current.status,
    lastSavedAt: laterIso(row.updatedAt, current.lastSavedAt),
    cargoCheckingType: p.cargoCheckingType || current.cargoCheckingType || fallbackType,
  }
  if (row.startAt || row.occurredAt) {
    const st = isoOrDatetimeToLocal(row.startAt || row.occurredAt)
    if (st) next.startTime = next.startTime || st
  }
  if (row.endAt) {
    const en = isoOrDatetimeToLocal(row.endAt)
    if (en) next.endTime = next.endTime || en
  }
  return next
}

function normalizeNorDetailsPayload(raw) {
  if (raw == null) return {}
  if (typeof raw === 'string') {
    try {
      const o = JSON.parse(raw)
      return o && typeof o === 'object' ? o : {}
    } catch {
      return {}
    }
  }
  return typeof raw === 'object' ? raw : {}
}

export function inferPrecheckStatus(sectionKey, item = {}) {
  const explicit = String(item?.status || '').trim()
  if (explicit) return explicit
  const hasDocs = Array.isArray(item?.documents) && item.documents.length > 0
  const hasRemark = Boolean(String(item?.remark || '').trim())
  if (sectionKey === 'sampling') {
    const hasRecords = Array.isArray(item?.records) && item.records.length > 0
    if (hasRecords) return 'Done'
    if (hasDocs || hasRemark) return 'In Progress'
    return 'Not Started'
  }
  if (sectionKey === 'norAccepted') {
    const hasTendered = Boolean(item?.norTenderedDateTime)
    const hasAccepted = Boolean(item?.norAcceptedDateTime)
    if (hasTendered && hasAccepted) return 'Done'
    if (hasTendered || hasAccepted || hasDocs || hasRemark) return 'In Progress'
    return 'Not Started'
  }
  if (sectionKey === 'initialCargoChecking') {
    const hasResult = Boolean(String(item?.remark || item?.result || '').trim())
    const hasTimes = Boolean(item?.startTime || item?.endTime || item?.dateTime)
    if (hasResult || hasTimes) return 'Done'
    if (hasDocs || hasRemark) return 'In Progress'
    return 'Not Started'
  }
  const hasTimes = Boolean(item?.startTime || item?.endTime || item?.dateTime)
  if (hasTimes) return 'Done'
  if (hasDocs || hasRemark) return 'In Progress'
  return 'Not Started'
}

export function inferPostcheckStatus(_sectionKey, item = {}) {
  const explicit = String(item?.status || '').trim()
  if (explicit) return explicit
  const hasDocs = Array.isArray(item?.documents) && item.documents.length > 0
  const hasResult = Boolean(String(item?.result || '').trim())
  const hasTimes = Boolean(item?.startTime || item?.endTime || item?.dateTime)
  if (hasResult || hasTimes) return 'Done'
  if (hasDocs) return 'In Progress'
  return 'Not Started'
}

export function getPreCheckStageKeys(purpose) {
  const keys = ['keyMeeting', 'norAccepted']
  if (purpose === 'Loading') keys.push('inspection')
  keys.push('sampling', 'initialCargoChecking')
  return keys
}

/** Align SI / operation API `purpose` with hub milestone lists (`Loading` | `Unloading`). */
export function normalizeHubPurpose(p) {
  const s = String(p ?? '').trim().toLowerCase()
  if (s === 'unloading') return 'Unloading'
  return 'Loading'
}

/**
 * Same formulas as Loading.jsx `processStages` useMemo (sub-page branch).
 */
export function computeProcessStagesNumbers({
  purpose,
  preData = {},
  postData = {},
  apiOperationalVm = { activities: [], naByLabel: {} },
  operationId,
  mockMatchesRoutePurpose,
  loadingOpProgress = { activities: [], milestoneNa: {} },
  preCheckPersistHydrated,
  operationalPersistHydrated,
  postCheckPersistHydrated,
}) {
  const preStepIds = getPreCheckStageKeys(purpose)
  const preDone = preStepIds.filter((k) => inferPrecheckStatus(k, preData?.[k] || {}) === 'Done').length
  const milestoneList = purpose === 'Unloading' ? UNLOADING_ACTIVITY_CATEGORIES : LOADING_ACTIVITY_CATEGORIES
  const operationalDone = operationId
    ? operationalMilestoneDoneCount(purpose, apiOperationalVm.activities, apiOperationalVm.naByLabel)
    : (() => {
        const naProgress = loadingOpProgress.milestoneNa || {}
        return milestoneList.filter((cat) => {
          if (naProgress[cat]?.reason) return true
          return (loadingOpProgress.activities || []).some((a) => a.category === cat)
        }).length
      })()
  const operationalTotal = milestoneList.length
  const postInspectionDone = POST_CHECK_STAGE_IDS.filter(
    (k) => inferPostcheckStatus(k, postData?.[k] || {}) === 'Done'
  ).length
  const apiBackedStages = Boolean(operationId) && !mockMatchesRoutePurpose
  const preCountUnknown = apiBackedStages && !preCheckPersistHydrated
  const operationalCountUnknown = apiBackedStages && !operationalPersistHydrated
  const postCountUnknown = apiBackedStages && !postCheckPersistHydrated

  return {
    pre: { done: preDone, total: preStepIds.length, countUnknown: preCountUnknown },
    operational: { done: operationalDone, total: operationalTotal, countUnknown: operationalCountUnknown },
    post: { done: postInspectionDone, total: POST_CHECK_STAGE_IDS.length, countUnknown: postCountUnknown },
  }
}

async function buildPreCheckingSnapshotFromApi(
  operationId,
  operationNorTenderedAt,
  operationNorAcceptedAt,
  operationDemurrageLiabilityFromAt
) {
  const [subRows, nor, norDocsFromOperation] = await Promise.all([
    fetchSubProcesses(operationId, 'Pre-Checking'),
    fetchNorDetails(operationId),
    fetchOperationDocuments(operationId, 'NOR').catch(() => []),
  ])

  const bySection = {}
  const docLoads = []
  ;(Array.isArray(subRows) ? subRows : []).forEach((row) => {
    const section = PRECHECK_KEY_TO_SECTION[row.subProcessKey]
    if (!section) return
    const current = bySection[section] || {}
    let merged
    if (section === 'inspection') {
      merged = mergeInspectionHydration(current, row)
    } else if (section === 'initialCargoChecking') {
      merged = mergeInitialCargoHydration(current, row)
    } else {
      merged = {
        ...current,
        remark: row.remark || '',
        status: row.status || current.status,
        lastSavedAt: row.updatedAt ?? current.lastSavedAt ?? null,
      }
      if (row.startAt || row.occurredAt) {
        merged.startTime = isoOrDatetimeToLocal(row.startAt || row.occurredAt)
      }
      if (row.endAt) {
        merged.endTime = isoOrDatetimeToLocal(row.endAt)
      }
      if (section === 'sampling') {
        merged.records = Array.isArray(row.payload?.records) ? row.payload.records : []
      }
      if (section === 'norAccepted') {
        const p = row.payload && typeof row.payload === 'object' ? row.payload : {}
        if (p.norTenderedDateTime) merged.norTenderedDateTime = isoOrDatetimeToLocal(p.norTenderedDateTime)
        if (p.norAcceptedDateTime) merged.norAcceptedDateTime = isoOrDatetimeToLocal(p.norAcceptedDateTime)
      }
    }
    bySection[section] = merged
    docLoads.push(
      fetchSubProcessDocuments(operationId, row.subProcessKey, 'Pre-Checking')
        .then((docs) => ({ section, docs: Array.isArray(docs) ? docs : [] }))
        .catch(() => ({ section, docs: [] }))
    )
  })

  const docBySection = {}
  const loadedDocs = await Promise.all(docLoads)
  loadedDocs.forEach((x) => {
    const list = x.docs.map((d) => ({ id: d.id, name: d.name, url: d.url, source: 'precheck_subprocess' }))
    docBySection[x.section] = [...(docBySection[x.section] || []), ...list]
  })
  Object.keys(docBySection).forEach((k) => {
    const arr = docBySection[k]
    const seen = new Set()
    docBySection[k] = arr.filter((d) => {
      if (d.id == null) return true
      if (seen.has(d.id)) return false
      seen.add(d.id)
      return true
    })
  })

  const preData = { ...bySection }
  Object.entries(preData).forEach(([section, val]) => {
    if (section === 'norAccepted') return
    preData[section] = { ...val, documents: docBySection[section] || [] }
  })

  const norFromSub = bySection.norAccepted || {}
  const opNorDocs = (Array.isArray(norDocsFromOperation) ? norDocsFromOperation : []).map((d) => ({
    id: d.id,
    name: d.name,
    url: d.url,
    source: 'shared_operation_nor',
  }))
  const mergedNorDocs = [...opNorDocs, ...(docBySection.norAccepted || [])]
  const norPayload = normalizeNorDetailsPayload(nor?.payload)
  const sourceFromPayload = norPayload?.norSource || null
  const subProcessNorDocs = docBySection.norAccepted || []
  const inferredSource =
    sourceFromPayload ||
    (opNorDocs.length > 0 ? 'inferred_from_nor_files' : null) ||
    (subProcessNorDocs.length > 0 ? 'nor_accepted_tab' : null)

  preData.norAccepted = {
    ...norFromSub,
    norTenderedDateTime:
      isoOrDatetimeToLocal(operationNorTenderedAt) || norFromSub.norTenderedDateTime || '',
    norAcceptedDateTime:
      isoOrDatetimeToLocal(operationNorAcceptedAt) || norFromSub.norAcceptedDateTime || '',
    demurrageLiabilityFromDateTime:
      isoOrDatetimeToLocal(operationDemurrageLiabilityFromAt) ||
      norFromSub.demurrageLiabilityFromDateTime ||
      '',
    remark: nor?.remark ?? norFromSub.remark ?? '',
    documents: mergedNorDocs,
    sourceModule: inferredSource,
    lastSavedAt: laterIso(nor?.updatedAt, norFromSub.lastSavedAt),
  }

  return preData
}

async function buildPostCheckingSnapshotFromApi(operationId, commodityType) {
  const subRows = await fetchSubProcesses(operationId, 'Post-Checking')
  const rows = Array.isArray(subRows) ? subRows : []
  const bySection = {
    finalInspection: {},
    finalCargoChecking: {},
  }

  const docLoads = rows
    .map((row) => {
      const section = POSTCHECK_KEY_TO_SECTION[row.subProcessKey]
      if (!section) return null
      return fetchSubProcessDocuments(operationId, row.subProcessKey, 'Post-Checking')
        .then((raw) => ({ row, section, docs: Array.isArray(raw) ? raw : [] }))
        .catch(() => ({ row, section, docs: [] }))
    })
    .filter(Boolean)

  const loaded = await Promise.all(docLoads)
  loaded.forEach(({ row, section, docs }) => {
    const current = bySection[section] || {}
    if (section === 'finalInspection') {
      bySection[section] = mergeFinalInspectionHydration(current, row, commodityType)
    } else if (section === 'finalCargoChecking') {
      bySection[section] = mergeFinalCargoCheckingHydration(current, row, commodityType)
    }
    bySection[section].documents = [
      ...(bySection[section].documents || []),
      ...docs.map((d) => ({
        id: d.id,
        name: d.name,
        url: d.url,
        source: 'precheck_subprocess',
        subProcessKey: row.subProcessKey,
      })),
    ]
  })

  return bySection
}

/**
 * Fetch persisted operation data and compute stage counts identical to Loading hub rail.
 */
export async function loadHubProcessStagesFromApi({
  operationId,
  purpose,
  commodityType,
  operationNorTenderedAt,
  operationNorAcceptedAt,
  operationDemurrageLiabilityFromAt,
}) {
  const ct = commodityType === 'Solid' ? 'Solid' : 'Liquid'
  const [preData, postData, opRes] = await Promise.all([
    buildPreCheckingSnapshotFromApi(
      operationId,
      operationNorTenderedAt,
      operationNorAcceptedAt,
      operationDemurrageLiabilityFromAt
    ),
    buildPostCheckingSnapshotFromApi(operationId, ct),
    fetchOperationalActivities(operationId),
  ])
  const apiOperationalVm = viewModelFromOperationalEntries(opRes?.entries || [], purpose)

  const stages = computeProcessStagesNumbers({
    purpose,
    preData,
    postData,
    apiOperationalVm,
    operationId,
    mockMatchesRoutePurpose: false,
    loadingOpProgress: { activities: [], milestoneNa: {} },
    preCheckPersistHydrated: true,
    operationalPersistHydrated: true,
    postCheckPersistHydrated: true,
  })

  return { stages, preData, postData, apiOperationalVm }
}

/** i18n key suffix under shippingInstruction `clearanceStatus_*` */
export function mapOperationStatusToClearanceI18nKey(status) {
  const s = String(status || '').trim().toUpperCase()
  if (!s) return 'unknown'
  if (s === 'PENDING' || s === 'ALLOCATED') return 'pendingAllocation'
  if (s === 'DOCKED' || s === 'IN_PROGRESS' || s === 'POST_OPS') return 'atBerth'
  if (s === 'SIGNOFF_REQUESTED') return 'pendingSignoff'
  if (s === 'SIGNOFF_APPROVED') return 'readyToSail'
  if (s === 'SAILED') return 'sailed'
  return 'unknown'
}
