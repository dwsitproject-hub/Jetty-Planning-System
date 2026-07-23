/* @refresh reload */
import { useState, Fragment, useEffect, useMemo, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'react-router-dom'
import JettySchematic from '../components/JettySchematic'
import JettyScheduleGantt from '../components/JettyScheduleGantt'
import AllocationPlanExportMenu from '../components/AllocationPlanExportMenu'
import AllocationTableColumnMenu from '../components/AllocationTableColumnMenu'
import {
  deleteOperationDocument,
  fetchAllocationOverview,
  fetchAllocationPlanOverview,
  fetchOperationDocuments,
  saveArrivalUpdate as saveArrivalUpdateApi,
  swapShipmentPlanBerthingSequence,
  uploadOperationDocuments,
} from '../api/allocation'
import { setOperationShiftingOut } from '../api/operations'
import { fetchShipmentPlan } from '../api/shipmentPlans'
import { fetchSiLookups } from '../api/siLookups'
import { ApiError, resolveUploadUrl } from '../api/client'
import FilePreviewLink from '../components/FilePreviewLink'
import AuthenticatedFileImage from '../components/AuthenticatedFileImage'
import { useFilePreview } from '../context/FilePreviewContext'
import { formatDateTimeDisplay } from '../utils/formatDateTimeDisplay'
import {
  getScheduleEntryTimeZone,
  normalizeForApiOrEmpty,
  nowToNaiveLocalInScheduleZone,
  utcIsoToNaiveLocal,
} from '../utils/scheduleDateTime'
import { isBerthOutOfService, jettyOosAllocationMessage } from '../utils/jettyAvailability'
import PurposeBadge, { resolvePurposeLabel } from '../components/PurposeBadge'
import SiDetailModal from '../components/SiDetailModal'
import SiDocumentModal from '../components/SiDocumentModal'
import VesselInfoModal, { VesselNameButton } from '../components/VesselInfoModal'
import OperationalProgressSection from '../components/OperationalProgressSection'
import { usePortScope } from '../context/PortScopeContext'
import { useRbac } from '../context/RbacContext'
import '../styles/allocation.css'
import '../styles/modal.css'
import { MAX_REMARK_CHARS } from '../constants/inputLimits'
import { mergeBerthsStateForPlanPov, mergeQueueRowsForPlanPov } from '../utils/allocationPlanPovMerge'
import {
  currentPhaseLabelForVessel,
  deriveCurrentPhaseIndex,
  getPlanAlongsideEndMs,
  getVesselAlongsideEndMs,
  isPlanOrVesselSailed,
  isVesselReadyToSail,
  isVesselSailed,
} from '../utils/allocationVesselPhase'
import { renderCommodityQtyCell } from '../utils/siCargoTableDisplay'
import EtcBreachBadge from '../components/EtcBreachBadge'
import { getEtcBreach, getEtcBreachRagStatus } from '../utils/etcBreach'
import AllocationLateSiNotice from '../components/AllocationLateSiNotice'
import BerthingActionButton from '../components/BerthingActionButton'
import JettyAllocationSelect from '../components/JettyAllocationSelect'
import {
  berthingDisabledReason,
  getBerthingPlanStatus,
  isPlanOnlySchedulingRow,
  showLateSiBerthingGateNotice,
} from '../utils/berthingEligibility'
import {
  ETC_BREACH_STATUS_FILTER_LEGACY,
  ETC_BREACH_STATUS_FILTER_PLAN,
  LEGACY_STATUS_FILTER_DEFAULT,
  PLAN_CENTRIC_STATUS_FILTER_DEFAULT,
  planCentricSiColumnDisplay,
  rowPassesAllocationStatusFilter,
} from '../utils/allocationQueueStatusFilter'
import {
  computeAllocationJettyAdvice,
  validateJettyAdviceSelection,
} from '../utils/jettyAdvice'
import '../styles/etc-breach.css'

/** Standardized pipeline flow (match Dashboard Vessel pipeline) */
const UNIFIED_PHASES = ['Shipping Instruction', 'Planned berthing', 'At-Berth', 'Clearance']

function schematicMaterialDisplay(r) {
  if (Array.isArray(r?.shippingTable) && r.shippingTable.length) {
    const names = [...new Set(r.shippingTable.map((row) => row.material).filter(Boolean))]
    if (names.length) return names.join(' - ')
  }
  return r?.commodityShortDisplay || r?.commodity || null
}

function getPhaseLink(label, vessel, plannedBerthingPath = '/allocation-plans') {
  const phaseRoutes = {
    'Shipping Instruction': '/shipment-plans',
    'Planned berthing': plannedBerthingPath,
    'Clearance': '/verification',
  }
  if (label === 'At-Berth') {
    const opId = vessel?.operationId
    if (!opId) return null
    const purpose = String(vessel?.purpose || '').trim()
    const base = purpose === 'Unloading' ? '/unloading' : '/loading'
    return `${base}/op-${opId}/pre-checking`
  }
  return phaseRoutes[label] || '#'
}

const PRIORITY_OPTIONS = ['Low', 'Moderate', 'High', 'Critical']

/** Missing berthing sequence sorts last (no magic numbers in the UI). */
function seqSortKey(row) {
  const n = row?.sequence != null ? Number(row.sequence) : NaN
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY
}

function parseDateMs(val) {
  if (!val) return null
  const t = new Date(val).getTime()
  return Number.isNaN(t) ? null : t
}

function renderAllocationVesselCell(r) {
  return (
    <strong className="allocation-table__vessel-cell">
      <span>{r.vesselName || '—'}</span>
      {r.shiftingOut ? (
        <span className="si-status-badge si-status-badge--external" style={{ marginLeft: 8 }}>
          Shifted
        </span>
      ) : null}
    </strong>
  )
}

const ALLOCATION_COLUMNS = [
  { key: 'sequence', label: 'Berthing sequence', getValue: () => '—', getSortValue: (r) => seqSortKey(r), getFilterValue: (r) => `${r.sequence ?? ''}` },
  {
    key: 'vesselName',
    label: 'Vessel Name',
    getValue: (r) => renderAllocationVesselCell(r),
    getSortValue: (r) => (r.vesselName || '').toLowerCase(),
  },
  {
    key: 'jettyOperationCode',
    label: 'Jetty Operation ID',
    getValue: (r) => r.jettyOperationCode || '—',
    getSortValue: (r) => (r.jettyOperationCode || '').toLowerCase(),
  },
  { key: 'shippingInstruction', label: 'Shipping Instruction', getValue: (r) => r.shippingInstruction || '—', getSortValue: (r) => (r.shippingInstruction || '').toLowerCase() },
  {
    key: 'commodityQty',
    label: 'Commodity Qty',
    getValue: (r) => r.totalQtyDisplay || '—',
    getSortValue: (r) => (r.totalQtyDisplay || '').toLowerCase(),
    getFilterValue: (r) => r.totalQtyDisplay || '',
  },
  { key: 'priority', label: 'Priority', getValue: (r) => r.priority || '—', getSortValue: (r) => (r.priority || '').toLowerCase() },
  {
    key: 'purpose',
    label: 'Purpose',
    getValue: (r) => <PurposeBadge purpose={r.purpose} loadDischarge={r.loadDischarge} />,
    getSortValue: (r) => resolvePurposeLabel(r.purpose, r.loadDischarge).toLowerCase(),
  },
  { key: 'remark', label: 'Remark', getValue: (r) => r.remark || r.remarks || '—', getSortValue: (r) => (r.remark || r.remarks || '').toLowerCase() },
  { key: 'eta', label: 'ETA', getValue: (r) => formatDateTimeDisplay(r.etaDateTime || r.eta) || '—', getSortValue: (r) => parseDateMs(r.etaDateTime || r.eta) ?? Number.NEGATIVE_INFINITY },
  { key: 'etb', label: 'ETB', getValue: (r) => formatDateTimeDisplay(r.etbDateTime || r.etb) || '—', getSortValue: (r) => parseDateMs(r.etbDateTime || r.etb) ?? Number.NEGATIVE_INFINITY },
  { key: 'jetty', label: 'Jetty', getValue: (r) => r.jetty || '—', getSortValue: (r) => (r.jetty || '').toLowerCase() },
]

const PLAN_CENTRIC_VESSEL_COLUMN = {
  key: 'vesselName',
  label: 'Vessel',
  getValue: (r) => renderAllocationVesselCell(r),
  getSortValue: (r) => (r.vesselName || '').toLowerCase(),
}

const PLAN_CENTRIC_ALLOCATION_COLUMNS = [
  { key: 'sequence', label: 'Berthing sequence', getValue: () => '—', getSortValue: (r) => seqSortKey(r), getFilterValue: (r) => `${r.sequence ?? ''}` },
  {
    key: 'planReference',
    label: 'Plan ref',
    getValue: (r) =>
      r.shipmentPlanId != null ? r.planReference || `Plan #${r.shipmentPlanId}` : '—',
    getSortValue: (r) =>
      (r.planReference || (r.shipmentPlanId != null ? `Plan #${r.shipmentPlanId}` : '') || '').toLowerCase(),
    getFilterValue: (r) =>
      r.planReference || (r.shipmentPlanId != null ? `Plan #${r.shipmentPlanId}` : ''),
  },
  PLAN_CENTRIC_VESSEL_COLUMN,
  {
    key: 'shippingInstruction',
    label: 'Shipping Instructions',
    getValue: (r) => planCentricSiColumnDisplay(r),
    getSortValue: (r) => planCentricSiColumnDisplay(r).toLowerCase(),
  },
  {
    key: 'commodityQty',
    label: 'Commodity Qty',
    getValue: (r) => r.totalQtyDisplay || '—',
    getSortValue: (r) => (r.totalQtyDisplay || '').toLowerCase(),
    getFilterValue: (r) => r.totalQtyDisplay || '',
  },
  {
    key: 'purpose',
    label: 'Purpose',
    getValue: (r) => <PurposeBadge purpose={r.purpose} loadDischarge={r.loadDischarge} />,
    getSortValue: (r) => resolvePurposeLabel(r.purpose, r.loadDischarge).toLowerCase(),
    getFilterValue: (r) => resolvePurposeLabel(r.purpose, r.loadDischarge),
  },
  {
    key: 'shipper',
    label: 'Shipper',
    getValue: (r) => r.shipper || '—',
    getSortValue: (r) => (r.shipper || '').toLowerCase(),
  },
  {
    key: 'tradeTerm',
    label: 'Term',
    getValue: (r) => r.tradeTerm || '—',
    getSortValue: (r) => (r.tradeTerm || '').toLowerCase(),
  },
  {
    key: 'loadingPort',
    label: 'Port of Loading',
    getValue: (r) => r.loadingPort || '—',
    getSortValue: (r) => (r.loadingPort || '').toLowerCase(),
  },
  {
    key: 'agent',
    label: 'Agent',
    getValue: (r) => r.agent || '—',
    getSortValue: (r) => (r.agent || '').toLowerCase(),
  },
  {
    key: 'surveyor',
    label: 'Surveyor',
    getValue: (r) => r.surveyor || '—',
    getSortValue: (r) => (r.surveyor || '').toLowerCase(),
  },
  { key: 'eta', label: 'ETA', getValue: (r) => formatDateTimeDisplay(r.etaDateTime || r.eta) || '—', getSortValue: (r) => parseDateMs(r.etaDateTime || r.eta) ?? Number.NEGATIVE_INFINITY, getFilterValue: (r) => formatDateTimeDisplay(r.etaDateTime || r.eta) || '' },
  {
    key: 'ta',
    label: 'TA',
    getValue: (r) => formatDateTimeDisplay(r.taDateTime) || '—',
    getSortValue: (r) => parseDateMs(r.taDateTime) ?? Number.NEGATIVE_INFINITY,
    getFilterValue: (r) => formatDateTimeDisplay(r.taDateTime) || '',
  },
  { key: 'etb', label: 'ETB', getValue: (r) => formatDateTimeDisplay(r.etbDateTime || r.etb) || '—', getSortValue: (r) => parseDateMs(r.etbDateTime || r.etb) ?? Number.NEGATIVE_INFINITY, getFilterValue: (r) => formatDateTimeDisplay(r.etbDateTime || r.etb) || '' },
  {
    key: 'tb',
    label: 'TB',
    getValue: (r) => formatDateTimeDisplay(r.tbDateTime) || '—',
    getSortValue: (r) => parseDateMs(r.tbDateTime) ?? Number.NEGATIVE_INFINITY,
    getFilterValue: (r) => formatDateTimeDisplay(r.tbDateTime) || '',
  },
  {
    key: 'etc',
    label: 'ETC',
    getValue: (r) =>
      formatDateTimeDisplay(r.estimatedCompletionDateTime || r.estimationOfCompletion) || '—',
    getSortValue: (r) => parseDateMs(r.estimatedCompletionDateTime) ?? Number.NEGATIVE_INFINITY,
    getFilterValue: (r) =>
      formatDateTimeDisplay(r.estimatedCompletionDateTime || r.estimationOfCompletion) || '',
  },
  { key: 'jetty', label: 'Jetty', getValue: (r) => r.jetty || '—', getSortValue: (r) => (r.jetty || '').toLowerCase() },
  {
    key: 'remark',
    label: 'Remarks',
    getValue: (r) => r.remark || r.remarks || '—',
    getSortValue: (r) => (r.remark || r.remarks || '').toLowerCase(),
    getFilterValue: (r) => r.remark || r.remarks || '',
  },
]

const PLAN_CENTRIC_DEFAULT_VISIBLE_COLUMN_KEYS = [
  'sequence',
  'vesselName',
  'commodityQty',
  'purpose',
  'tradeTerm',
  'agent',
  'eta',
  'ta',
  'etb',
  'jetty',
  'remark',
]

function buildAllocationColumnDefs(isPlanCentric) {
  const source = isPlanCentric ? PLAN_CENTRIC_ALLOCATION_COLUMNS : ALLOCATION_COLUMNS
  return source.map((c) => ({ ...c }))
}

const ALLOCATION_FILTER_STATE_KEYS = [
  ...new Set([
    ...ALLOCATION_COLUMNS.map((c) => c.key),
    ...PLAN_CENTRIC_ALLOCATION_COLUMNS.map((c) => c.key),
  ]),
]

/** Next / previous displayed queue row that has a shipment plan (for plan-centric ↑/↓). */
function findAdjacentPlanRowInDisplay(rows, fromIdx, dir) {
  const step = dir < 0 ? -1 : 1
  for (let i = fromIdx + step; i >= 0 && i < rows.length; i += step) {
    const x = rows[i]
    const pid = x?.shipmentPlanId != null ? Number(x.shipmentPlanId) : NaN
    if (Number.isFinite(pid) && pid > 0) return x
  }
  return null
}

function formatDuration(ms) {
  if (ms == null || ms < 0) return '—'
  const totalMinutes = Math.floor(ms / 60000)
  const days = Math.floor(totalMinutes / (24 * 60))
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60)
  const minutes = totalMinutes % 60
  if (days > 0) return `${days}d ${hours}h ${minutes}m`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

/** Queue row → "Last updated on … by …" (supports camelCase or snake_case from API). */
function formatVesselRecordLastUpdatedLine(vessel) {
  const raw = vessel?.recordLastUpdatedAt ?? vessel?.record_last_updated_at
  const by = vessel?.recordLastUpdatedByDisplayName ?? vessel?.record_last_updated_by_display_name
  if (raw == null || raw === '') return null
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return null
  return `Last updated on ${formatDateTimeDisplay(raw)}${by ? ` by ${by}` : ''}`
}

function getArrivalMsForJettyValidation(row) {
  return (
    parseDateMs(row?.etaDateTime) ??
    parseDateMs(row?.etbDateTime) ??
    parseDateMs(row?.taDateTime) ??
    null
  )
}

function getCompletionMsForJettyValidation(row) {
  return parseDateMs(row?.actualCompletionDateTime) ?? parseDateMs(row?.estimatedCompletionDateTime) ?? null
}

function AllocationDetailPanel({ r, tAlloc, onOpenSiDetail, queueList, nowMs = Date.now() }) {
  const breach = getEtcBreach(r, nowMs)
  const planSis =
    r?.shipmentPlanId != null && Array.isArray(queueList)
      ? queueList.filter((row) => Number(row?.shipmentPlanId) === Number(r.shipmentPlanId))
      : []
  const planSiLabels = [...new Set(planSis.map((row) => (row.shippingInstruction || '').trim()).filter(Boolean))]

  return (
    <div className="allocation-detail">
      <h4 className="allocation-detail__title">{tAlloc('fullDetails', { defaultValue: 'Full details' })}</h4>
      <dl className="allocation-detail__grid">
        <dt>{tAlloc('dtVesselName', { defaultValue: 'Vessel Name' })}</dt><dd>{r.vesselName || '—'}</dd>
        <dt>{tAlloc('dtJettyOperationId', { defaultValue: 'Jetty Operation ID' })}</dt>
        <dd>
          {r.shippingInstructionId && onOpenSiDetail ? (
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault()
                onOpenSiDetail(r.shippingInstructionId)
              }}
              aria-label={tAlloc('openSiDetailFromJettyOp')}
            >
              {r.jettyOperationCode || '—'}
            </a>
          ) : (
            r.jettyOperationCode || '—'
          )}
        </dd>
        <dt>{tAlloc('dtShippingInstruction', { defaultValue: 'Shipping Instruction' })}</dt><dd>{r.shippingInstruction || '—'}</dd>
        <dt>{tAlloc('dtNoPkk', { defaultValue: 'No PKK' })}</dt><dd>{r.noPkk ?? '—'}</dd>
        <dt>{tAlloc('dtPriority', { defaultValue: 'Priority' })}</dt><dd>{r.priority || '—'}</dd>
        <dt>{tAlloc('dtNumberOfPalka', { defaultValue: 'Number of Palka' })}</dt><dd>{r.numberOfPalka ?? '—'}</dd>
        <dt>{tAlloc('dtPurpose', { defaultValue: 'Purpose' })}</dt>
        <dd>
          <PurposeBadge purpose={r.purpose} loadDischarge={r.loadDischarge} />
        </dd>
        <dt>{tAlloc('dtShipper', { defaultValue: 'Shipper' })}</dt><dd>{r.shipper || '—'}</dd>
        <dt>{tAlloc('dtAgent', { defaultValue: 'Agent' })}</dt><dd>{r.agent || '—'}</dd>
        <dt>{tAlloc('dtSurveyor', { defaultValue: 'Surveyor' })}</dt><dd>{r.surveyor || '—'}</dd>
        <dt>{tAlloc('dtJetty', { defaultValue: 'Jetty' })}</dt><dd>{r.jetty || '—'}</dd>
        <dt>{tAlloc('dtEta', { defaultValue: 'ETA' })}</dt><dd>{formatDateTimeDisplay(r.etaDateTime || r.eta)}</dd>
        <dt>{tAlloc('dtTa', { defaultValue: 'TA' })}</dt><dd>{formatDateTimeDisplay(r.taDateTime)}</dd>
        <dt>{tAlloc('dtEtb', { defaultValue: 'ETB' })}</dt><dd>{formatDateTimeDisplay(r.etbDateTime || r.etb)}</dd>
        <dt>{tAlloc('dtTb', { defaultValue: 'TB' })}</dt><dd>{formatDateTimeDisplay(r.tbDateTime)}</dd>
        <dt>{tAlloc('dtEstimatedCompletion', { defaultValue: 'Estimation of Completion' })}</dt>
        <dd className={breach ? 'allocation-detail__dd--etc-breach' : undefined}>
          {formatDateTimeDisplay(r.estimatedCompletionDateTime || r.estimationOfCompletion)}
          {breach ? (
            <EtcBreachBadge overMs={breach.overMs} etcMs={breach.etcMs} size="sm" />
          ) : null}
        </dd>
        <dt>{tAlloc('dtRemark', { defaultValue: 'Remark' })}</dt><dd>{r.remark || r.remarks || '—'}</dd>
      </dl>
      {planSiLabels.length > 1 && (
        <div className="allocation-detail__plan-sis">
          <h5 className="allocation-detail__subtitle">
            {tAlloc('dtSisOnPlan', { defaultValue: 'SIs on this shipment plan' })}
          </h5>
          <ul className="allocation-detail__plan-sis-list">
            {planSiLabels.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
        </div>
      )}
      {Array.isArray(r.shippingTable) && r.shippingTable.length > 0 && (
        <div className="allocation-detail__shipping-table-wrap">
          <h5 className="allocation-detail__subtitle">Shipping Table</h5>
          <table className="data-table allocation-detail__shipping-table">
            <thead>
              <tr>
                <th>Contract</th>
                <th>PO</th>
                <th>Material</th>
                <th>QTY</th>
              </tr>
            </thead>
            <tbody>
              {r.shippingTable.map((row, i) => (
                <tr key={i}>
                  <td>{row.contract ?? '—'}</td>
                  <td>{row.po ?? '—'}</td>
                  <td>{row.material ?? '—'}</td>
                  <td>{row.qty ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default function Allocation({ pageProfile = 'legacy' } = {}) {
  const { openFilePreview } = useFilePreview()
  const { t } = useTranslation('pages')
  const { t: tAlloc } = useTranslation('allocation')
  const { t: tSp } = useTranslation('shipmentPlan')
  const location = useLocation()
  const isPlanCentric = pageProfile === 'planCentric'
  const rbacPageKey = 'allocation-plan'
  const activityLogPageKey = rbacPageKey
  const plannedBerthingPath = '/allocation-plans'
  const overviewFetcher = useMemo(
    () => (isPlanCentric ? fetchAllocationPlanOverview : fetchAllocationOverview),
    [isPlanCentric]
  )
  const { selectedPortId, selectedPort } = usePortScope()
  const scheduleEntryTz = getScheduleEntryTimeZone()
  const toDateTimeLocalValue = useCallback(
    (iso) => utcIsoToNaiveLocal(iso, scheduleEntryTz),
    [scheduleEntryTz]
  )
  const getNowForDateTimeLocal = useCallback(
    () => nowToNaiveLocalInScheduleZone(scheduleEntryTz),
    [scheduleEntryTz]
  )
  const { canEdit, canView } = useRbac()
  const canEditAllocation = canEdit(rbacPageKey)
  const canViewMasterJetty = canView('master-jetty')
  const [list, setList] = useState([])
  const [scheduleList, setScheduleList] = useState([])
  const [berthsState, setBerthsState] = useState([])
  const [allocationLookups, setAllocationLookups] = useState(null)
  const [filters, setFilters] = useState(() =>
    Object.fromEntries(ALLOCATION_FILTER_STATE_KEYS.map((k) => [k, '']))
  )
  const [statusFilter, setStatusFilter] = useState(() =>
    isPlanCentric ? { ...PLAN_CENTRIC_STATUS_FILTER_DEFAULT } : { ...LEGACY_STATUS_FILTER_DEFAULT }
  )
  const [etcBreachFilter, setEtcBreachFilter] = useState(false)
  const [breachNowMs, setBreachNowMs] = useState(() => Date.now())
  const [sortState, setSortState] = useState({ key: 'sequence', dir: 'asc' })
  const [expandedId, setExpandedId] = useState(null)
  const [expandedMobileId, setExpandedMobileId] = useState(null)
  const [vesselDetailModalVesselId, setVesselDetailModalVesselId] = useState(null)
  /** When opening from merged jetty slot (`plan-*`), load plan detail for plan-first modal. */
  const [vesselDetailPlanId, setVesselDetailPlanId] = useState(null)
  const [planDetail, setPlanDetail] = useState(null)
  const [planDetailLoading, setPlanDetailLoading] = useState(false)
  const [planDetailError, setPlanDetailError] = useState(null)
  /** Editable "Time & status (shipment plan)" form (null = read-only view). */
  const [planTimesEdit, setPlanTimesEdit] = useState(null)
  const [planTimesSaving, setPlanTimesSaving] = useState(false)
  const [planTimesMsg, setPlanTimesMsg] = useState(null)

  const savePlanTimes = async (vesselRow) => {
    if (!planTimesEdit) return
    setPlanTimesSaving(true)
    setPlanTimesMsg(null)
    const hasOp = vesselRow?.operationId != null && vesselRow.operationId !== ''
    const hasSi = vesselRow?.shippingInstructionId != null && vesselRow.shippingInstructionId !== ''
    const payload = { activityLogPage: 'allocation-plan' }
    if (hasOp) payload.operationId = vesselRow.operationId
    if (hasSi) payload.shippingInstructionId = vesselRow.shippingInstructionId
    if (!hasOp && !hasSi) payload.shipmentPlanId = vesselRow?.shipmentPlanId
    const put = (key, raw) => {
      // Only send touched, non-empty values (clearing a milestone is not supported here).
      if (raw == null || String(raw).trim() === '') return
      payload[key] = normalizeForApiOrEmpty(raw, scheduleEntryTz)
    }
    put('etaDateTime', planTimesEdit.eta)
    put('etbDateTime', planTimesEdit.etb)
    if (hasOp || hasSi) {
      put('taDateTime', planTimesEdit.ta)
      put('tbDateTime', planTimesEdit.tb)
      put('estimatedCompletionDateTime', planTimesEdit.etc)
      put('actualCompletionDateTime', planTimesEdit.act)
    }
    try {
      await saveArrivalUpdateApi(payload)
      setPlanTimesEdit(null)
      if (vesselRow?.shipmentPlanId != null) {
        fetchShipmentPlan(vesselRow.shipmentPlanId)
          .then((d) => setPlanDetail(d))
          .catch(() => {})
      }
      await refreshOverview().catch(() => {})
    } catch (e) {
      setPlanTimesMsg(e?.message || 'Save failed')
    } finally {
      setPlanTimesSaving(false)
    }
  }
  const [arrivalUpdateForm, setArrivalUpdateForm] = useState(null)
  const [arrivalUpdateOriginalJetty, setArrivalUpdateOriginalJetty] = useState('')
  const [berthingConfirmRow, setBerthingConfirmRow] = useState(null)
  const [berthingErrors, setBerthingErrors] = useState([])
  const [berthingSelectedJetty, setBerthingSelectedJetty] = useState('')
  const [berthingPob, setBerthingPob] = useState('')
  const [berthingTa, setBerthingTa] = useState('')
  const [berthingTb, setBerthingTb] = useState('')
  const [berthingSob, setBerthingSob] = useState('')
  const [berthingPhotos, setBerthingPhotos] = useState([]) // { id, file, previewUrl }[]
  const [berthingRemarks, setBerthingRemarks] = useState('')
  const [berthingEstimatedCompletion, setBerthingEstimatedCompletion] = useState('')
  const [berthingSaving, setBerthingSaving] = useState(false)
  const [vesselPhotosByVesselId, setVesselPhotosByVesselId] = useState({}) // { [vesselId]: [{ url, name }] }
  const [berthingSuccessMessage, setBerthingSuccessMessage] = useState(null)
  const [arrivalSuccessMessage, setArrivalSuccessMessage] = useState(null)
  const [visualTab, setVisualTab] = useState('schematic') // 'schematic' | 'jettySchedule'
  const schematicExportRef = useRef(null)
  const queueExportRef = useRef(null)
  const [planExporting, setPlanExporting] = useState(false)
  const [siDetailId, setSiDetailId] = useState(null)
  const [siDocumentModalId, setSiDocumentModalId] = useState(null)

  const openSiDocumentModal = useCallback((id) => {
    setSiDetailId(null)
    setSiDocumentModalId(id)
  }, [])
  const openSiDetailModal = useCallback((id) => {
    setSiDocumentModalId(null)
    setSiDetailId(id)
  }, [])
  const [vesselInfoPlanId, setVesselInfoPlanId] = useState(null)
  /** Schematic KPI drill-down: filters the berthing queue to the counted vessels. */
  const [queueKpiFilter, setQueueKpiFilter] = useState(null)
  const handleSchematicKpiOpen = useCallback((key, kpi, dateYmd) => {
    const labels = {
      eta: 'ETA by Today not yet arrived',
      etb: 'ETB by Today not yet berthing',
      etc: 'ETC by Today not yet completed',
    }
    setQueueKpiFilter({
      key,
      dateYmd,
      label: labels[key] || key,
      vesselIds: new Set(kpi?.vesselIds || []),
      planIds: new Set(kpi?.planIds || []),
    })
    window.setTimeout(() => {
      document.getElementById('allocation-queue-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 60)
  }, [])

  const handleAllocationPlanExport = useCallback(async ({ includeSchematic, includeQueueTable }) => {
    setPlanExporting(true)
    try {
      const { captureElementToCanvas, stitchCanvasesVertically, downloadCanvasAsJpeg } = await import(
        '../utils/captureDomAsJpeg'
      )
      const canvases = []
      if (includeSchematic && schematicExportRef.current) {
        const canvas = await captureElementToCanvas(schematicExportRef.current, {
          capturingClass: 'allocation-export-schematic--capturing',
          expandWidth: true,
        })
        canvases.push(canvas)
      }
      if (includeQueueTable && queueExportRef.current) {
        const canvas = await captureElementToCanvas(queueExportRef.current, {
          capturingClass: 'allocation-export-queue-table--capturing',
          expandWidth: false,
        })
        canvases.push(canvas)
      }
      if (canvases.length === 0) throw new Error('Nothing to export')
      const stitched = stitchCanvasesVertically(canvases, 16)
      const dateInput = document.getElementById('jetty-schematic-date')
      const dateYmd =
        dateInput instanceof HTMLInputElement && dateInput.value
          ? dateInput.value
          : new Date().toISOString().slice(0, 10)
      await downloadCanvasAsJpeg(stitched, `allocation-plan-${dateYmd}.jpg`)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Allocation plan JPG export failed:', err)
      throw err
    } finally {
      setPlanExporting(false)
    }
  }, [])
  /** Embedded At-Berth / Clearance activity popup (vessel pipeline). */
  const [pipelineEmbed, setPipelineEmbed] = useState(null)
  const [shiftSavingByOpId, setShiftSavingByOpId] = useState({})
  /** `minPlanId-maxPlanId` while swapping berthing sequence (shipment_plans only). */
  const [planSequenceBusyPair, setPlanSequenceBusyPair] = useState(null)
  const [planSequenceSwapError, setPlanSequenceSwapError] = useState(null)
  const [reDockModal, setReDockModal] = useState(null)
  const [reDockRemarkDraft, setReDockRemarkDraft] = useState('')
  const [reDockModalError, setReDockModalError] = useState(null)
  const [reDockSuccessMessage, setReDockSuccessMessage] = useState(null)
  const [vesselDetailEditing, setVesselDetailEditing] = useState(false)
  const [vesselDetailDraft, setVesselDetailDraft] = useState(null)
  const [vesselDetailOriginalJetty, setVesselDetailOriginalJetty] = useState('')
  const [vesselDetailEditError, setVesselDetailEditError] = useState(null)
  const [vesselDetailEditSaving, setVesselDetailEditSaving] = useState(false)
  const [vesselDetailNorNewFiles, setVesselDetailNorNewFiles] = useState([])
  const [vesselDetailNorNewRaw, setVesselDetailNorNewRaw] = useState([])
  const [vesselDetailBerthingNewPhotos, setVesselDetailBerthingNewPhotos] = useState([])

  const berthIds = useMemo(
    () => (Array.isArray(berthsState) ? berthsState.map((b) => b.id).filter(Boolean) : []),
    [berthsState]
  )

  const portJetties = useMemo(() => {
    const all = allocationLookups?.jetties
    if (!Array.isArray(all) || !selectedPortId) return []
    return all.filter((j) => Number(j.portId) === Number(selectedPortId))
  }, [allocationLookups, selectedPortId])

  const jettyOccupancyRows = useMemo(
    () => [...(list || []), ...(scheduleList || [])],
    [list, scheduleList]
  )

  const arrivalJettyAdvice = useMemo(
    () =>
      computeAllocationJettyAdvice({
        jetties: portJetties,
        row: arrivalUpdateForm,
        referenceDateTime: arrivalUpdateForm?.etaDateTime,
        occupancyRows: jettyOccupancyRows,
      }),
    [portJetties, arrivalUpdateForm, jettyOccupancyRows]
  )

  const berthingJettyAdvice = useMemo(() => {
    const referenceDateTime =
      berthingTb?.trim() ||
      berthingConfirmRow?.etbDateTime ||
      berthingConfirmRow?.etaDateTime ||
      null
    return computeAllocationJettyAdvice({
      jetties: portJetties,
      row: berthingConfirmRow,
      referenceDateTime,
      occupancyRows: jettyOccupancyRows,
    })
  }, [portJetties, berthingConfirmRow, berthingTb, jettyOccupancyRows])

  const planViz = useMemo(() => {
    if (!isPlanCentric) {
      return {
        mergedList: list,
        mergedSchedule: scheduleList,
        mergedBerths: berthsState,
        planVesselToRepresentativeVesselId: new Map(),
      }
    }
    const q = mergeQueueRowsForPlanPov(list)
    const s = mergeQueueRowsForPlanPov(scheduleList)
    const rep = new Map([...q.planVesselToRepresentativeVesselId, ...s.planVesselToRepresentativeVesselId])
    return {
      mergedList: q.mergedRows,
      mergedSchedule: s.mergedRows,
      mergedBerths: mergeBerthsStateForPlanPov(berthsState, rep),
      planVesselToRepresentativeVesselId: rep,
    }
  }, [isPlanCentric, list, scheduleList, berthsState])

  const closeVesselDetailModal = useCallback(() => {
    setVesselDetailModalVesselId(null)
    setVesselDetailPlanId(null)
    setPlanDetail(null)
    setPlanDetailError(null)
    setPlanDetailLoading(false)
  }, [])

  const selectVesselFromVisualization = useCallback(
    (vesselId) => {
      if (!vesselId) return
      if (isPlanCentric && typeof vesselId === 'string' && vesselId.startsWith('plan-')) {
        const n = parseInt(String(vesselId).replace(/^plan-/i, ''), 10)
        setVesselDetailPlanId(Number.isFinite(n) && n > 0 ? n : null)
      } else {
        setVesselDetailPlanId(null)
        setPlanDetail(null)
        setPlanDetailError(null)
        setPlanDetailLoading(false)
      }
      let resolved =
        isPlanCentric &&
        typeof vesselId === 'string' &&
        vesselId.startsWith('plan-') &&
        planViz.planVesselToRepresentativeVesselId.has(vesselId)
          ? planViz.planVesselToRepresentativeVesselId.get(vesselId)
          : vesselId
      if (
        isPlanCentric &&
        typeof resolved === 'string' &&
        resolved.startsWith('plan-')
      ) {
        const pid = parseInt(resolved.replace(/^plan-/i, ''), 10)
        if (Number.isFinite(pid) && pid > 0) {
          const fallback =
            list.find(
              (r) => Number(r?.shipmentPlanId) === pid && r?.operationId != null && r?.vesselId
            ) ||
            scheduleList.find(
              (r) => Number(r?.shipmentPlanId) === pid && r?.operationId != null && r?.vesselId
            ) ||
            list.find((r) => Number(r?.shipmentPlanId) === pid && r?.vesselId) ||
            scheduleList.find((r) => Number(r?.shipmentPlanId) === pid && r?.vesselId)
          if (fallback?.vesselId) resolved = fallback.vesselId
        }
      }
      setVesselDetailModalVesselId(resolved || vesselId)
    },
    [isPlanCentric, planViz.planVesselToRepresentativeVesselId, list]
  )

  useEffect(() => {
    if (!isPlanCentric || vesselDetailPlanId == null) {
      setPlanDetail(null)
      setPlanDetailError(null)
      setPlanDetailLoading(false)
      return undefined
    }
    let cancelled = false
    setPlanDetailLoading(true)
    setPlanDetailError(null)
    fetchShipmentPlan(vesselDetailPlanId)
      .then((data) => {
        if (!cancelled) setPlanDetail(data)
      })
      .catch((err) => {
        if (!cancelled) setPlanDetailError(err?.message || 'Failed to load shipment plan')
      })
      .finally(() => {
        if (!cancelled) setPlanDetailLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [isPlanCentric, vesselDetailPlanId])

  useEffect(() => {
    if (!selectedPortId) {
      setAllocationLookups(null)
      return undefined
    }
    let alive = true
    fetchSiLookups()
      .then((data) => {
        if (alive) setAllocationLookups(data)
      })
      .catch(() => {
        if (alive) setAllocationLookups(null)
      })
    return () => {
      alive = false
    }
  }, [selectedPortId])

  useEffect(() => {
    if (!selectedPortId) {
      setList([])
      setScheduleList([])
      setBerthsState([])
      return undefined
    }
    let alive = true
    overviewFetcher()
      .then((data) => {
        if (!alive) return
        setList(Array.isArray(data?.queue) ? data.queue : [])
        setScheduleList(Array.isArray(data?.scheduleQueue) ? data.scheduleQueue : (Array.isArray(data?.queue) ? data.queue : []))
        setBerthsState(Array.isArray(data?.berths) ? data.berths : [])
      })
      .catch(() => {
        if (!alive) return
        setList([])
        setScheduleList([])
        setBerthsState([])
      })
    return () => {
      alive = false
    }
    // location.key: refetch when landing here via navigation (port alone does not change on SPA route change).
  }, [selectedPortId, location.key, overviewFetcher])

  useEffect(() => {
    if (!selectedPortId) return undefined
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      overviewFetcher()
        .then((data) => {
          setList(Array.isArray(data?.queue) ? data.queue : [])
          setScheduleList(Array.isArray(data?.scheduleQueue) ? data.scheduleQueue : (Array.isArray(data?.queue) ? data.queue : []))
          setBerthsState(Array.isArray(data?.berths) ? data.berths : [])
        })
        .catch(() => {})
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [selectedPortId, overviewFetcher])

  useEffect(() => {
    const id = setInterval(() => setBreachNowMs(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  const vesselById = useMemo(() => {
    const map = {}
    const srcList = planViz.mergedList
    const srcSchedule = planViz.mergedSchedule
    const srcBerths = planViz.mergedBerths

    const refLabel = (r) => {
      if (isPlanCentric && String(r?.vesselId || '').startsWith('plan-')) {
        return r.planReference || r.shippingInstruction || '—'
      }
      return r.shippingInstruction || '—'
    }

    // From queue rows (incoming + operations list)
    for (const r of srcList) {
      if (!r?.vesselId) continue
      map[r.vesselId] = {
        vesselName: r.vesselName || r.vesselId,
        siId: refLabel(r),
        purpose: r.purpose || null,
        loadDischarge: r.loadDischarge ?? null,
        commodity: r.commodity || null,
        materialDisplay: schematicMaterialDisplay(r),
        agent: r.agent || null,
        tbDateTime: r.tbDateTime ?? null,
        estimatedCompletionDateTime: r.estimatedCompletionDateTime ?? null,
        vesselLoaM: r.vesselLoaM ?? null,
        vesselDraft: r.vesselDraft ?? null,
        vesselDwt: r.vesselDwt ?? null,
        vesselGrossTonnage: r.vesselGrossTonnage ?? null,
        vesselCapacity: r.vesselCapacity ?? null,
        totalQtyDisplay: r.totalQtyDisplay || null,
        completionPercent: r.completionPercent != null ? Number(r.completionPercent) : null,
        cargoMovedQty: r.cargoMovedQty != null ? Number(r.cargoMovedQty) : 0,
        cargoFirstLoggedAt: r.cargoFirstLoggedAt ?? null,
        cargoLastLoggedAt: r.cargoLastLoggedAt ?? null,
        openingHatchStartAt: r.openingHatchStartAt ?? null,
        openingCargoHandlingMethodName: r.openingCargoHandlingMethodName ?? null,
        etaToCompletion: r.estimatedCompletionDateTime ? formatDateTimeDisplay(r.estimatedCompletionDateTime) : '—',
        ragStatus: getEtcBreachRagStatus(r, breachNowMs),
        etcBreach: getEtcBreach(r, breachNowMs),
        status: r.status || null,
      }
    }

    // From schedule rows (includes SAILED rows used by Jetty Schedule Gantt)
    for (const r of srcSchedule) {
      if (!r?.vesselId) continue
      if (map[r.vesselId]) continue
      map[r.vesselId] = {
        vesselName: r.vesselName || r.vesselId,
        siId: refLabel(r),
        purpose: r.purpose || null,
        loadDischarge: r.loadDischarge ?? null,
        commodity: r.commodity || null,
        materialDisplay: schematicMaterialDisplay(r),
        agent: r.agent || null,
        tbDateTime: r.tbDateTime ?? null,
        estimatedCompletionDateTime: r.estimatedCompletionDateTime ?? null,
        vesselLoaM: r.vesselLoaM ?? null,
        vesselDraft: r.vesselDraft ?? null,
        vesselDwt: r.vesselDwt ?? null,
        vesselGrossTonnage: r.vesselGrossTonnage ?? null,
        vesselCapacity: r.vesselCapacity ?? null,
        totalQtyDisplay: r.totalQtyDisplay || null,
        completionPercent: r.completionPercent != null ? Number(r.completionPercent) : null,
        cargoMovedQty: r.cargoMovedQty != null ? Number(r.cargoMovedQty) : 0,
        cargoFirstLoggedAt: r.cargoFirstLoggedAt ?? null,
        cargoLastLoggedAt: r.cargoLastLoggedAt ?? null,
        openingHatchStartAt: r.openingHatchStartAt ?? null,
        openingCargoHandlingMethodName: r.openingCargoHandlingMethodName ?? null,
        etaToCompletion: r.estimatedCompletionDateTime ? formatDateTimeDisplay(r.estimatedCompletionDateTime) : '—',
        ragStatus: getEtcBreachRagStatus(r, breachNowMs),
        etcBreach: getEtcBreach(r, breachNowMs),
        status: r.status || null,
      }
    }

    // From berths occupants (berthed vessels might not appear in queue depending on backend rules)
    for (const b of srcBerths || []) {
      const occs = Array.isArray(b?.occupants) ? b.occupants : []
      for (const o of occs) {
        if (!o?.vesselId) continue
        if (map[o.vesselId]) continue
        map[o.vesselId] = {
          vesselName: o.vesselName || o.vesselId,
          siId: '—',
          purpose: o.purpose || null,
          loadDischarge: o.loadDischarge ?? null,
          commodity: null,
          materialDisplay: schematicMaterialDisplay(o),
          agent: o.agent || null,
          tbDateTime: o.tbDateTime ?? null,
          estimatedCompletionDateTime: o.estimatedCompletionDateTime ?? null,
          vesselLoaM: o.vesselLoaM ?? null,
          vesselDraft: o.vesselDraft ?? null,
          vesselDwt: o.vesselDwt ?? null,
          vesselGrossTonnage: o.vesselGrossTonnage ?? null,
          vesselCapacity: o.vesselCapacity ?? null,
          totalQtyDisplay: o.totalQtyDisplay || null,
          completionPercent: o.completionPercent != null ? Number(o.completionPercent) : null,
          cargoMovedQty: o.cargoMovedQty != null ? Number(o.cargoMovedQty) : 0,
          cargoFirstLoggedAt: o.cargoFirstLoggedAt ?? null,
          cargoLastLoggedAt: o.cargoLastLoggedAt ?? null,
          openingHatchStartAt: o.openingHatchStartAt ?? null,
          openingCargoHandlingMethodName: o.openingCargoHandlingMethodName ?? null,
          etaToCompletion: o.estimatedCompletionDateTime ? formatDateTimeDisplay(o.estimatedCompletionDateTime) : '—',
          ragStatus: getEtcBreachRagStatus(o, breachNowMs),
          etcBreach: getEtcBreach(o, breachNowMs),
          status: o.status || null,
        }
      }
    }

    return map
  }, [planViz, isPlanCentric, breachNowMs])

  const vesselDetailRows = useMemo(() => {
    const byId = new Map()
    for (const r of list) {
      if (!r?.vesselId) continue
      if (!byId.has(r.vesselId)) byId.set(r.vesselId, r)
    }
    for (const r of scheduleList) {
      if (!r?.vesselId) continue
      if (!byId.has(r.vesselId)) byId.set(r.vesselId, r)
    }
    return Array.from(byId.values())
  }, [list, scheduleList])

  const vesselDetailPlanQueueRows = useMemo(() => {
    if (!isPlanCentric || vesselDetailPlanId == null) return []
    const byKey = new Map()
    for (const r of [...list, ...scheduleList]) {
      if (Number(r?.shipmentPlanId) !== Number(vesselDetailPlanId)) continue
      const k = r.vesselId || r.id || String(r.shippingInstructionId ?? '')
      if (!k) continue
      if (!byKey.has(k)) byKey.set(k, r)
    }
    return [...byKey.values()].sort((a, b) => {
      const ds = seqSortKey(a) - seqSortKey(b)
      if (ds !== 0) return ds
      return (Number(a.shippingInstructionId) || 0) - (Number(b.shippingInstructionId) || 0)
    })
  }, [isPlanCentric, vesselDetailPlanId, list, scheduleList])

  const allocationColumnDefsBase = useMemo(() => buildAllocationColumnDefs(isPlanCentric), [isPlanCentric])

  const allocationTableColumns = useMemo(() => {
    const berthById = new Map((berthsState || []).map((b) => [b.id, b]))
    return allocationColumnDefsBase.map((c) => {
      if (c.key === 'vesselName') {
        return {
          ...c,
          getValue: (r) => renderAllocationVesselCell(r),
        }
      }
      if (c.key === 'etc') {
        return {
          ...c,
          getValue: (r) => {
            const breach = getEtcBreach(r, breachNowMs)
            return (
              <span className="at-berth-etc-cell">
                {formatDateTimeDisplay(r.estimatedCompletionDateTime || r.estimationOfCompletion) || '—'}
                {breach ? (
                  <span className="at-berth-etc-cell__badge">
                    <EtcBreachBadge overMs={breach.overMs} etcMs={breach.etcMs} size="sm" />
                  </span>
                ) : null}
              </span>
            )
          },
          getSortValue: (r) => getEtcBreach(r, breachNowMs)?.overMs ?? 0,
        }
      }
      if (c.key !== 'jetty') return c
      return {
        ...c,
        getValue: (r) => {
          const j = (r.jetty || '').trim().split('/')[0].trim()
          const berth = j ? berthById.get(j) : null
          const oos = berth && isBerthOutOfService(berth)
          return (
            <>
              {r.jetty || '—'}
              {oos ? (
                <span
                  className="allocation-jetty-oos-badge"
                  title="Jetty is out of service in master data"
                >
                  {' '}
                  OOS
                </span>
              ) : null}
            </>
          )
        },
      }
    })
  }, [berthsState, allocationColumnDefsBase, breachNowMs])

  const [visibleColumnKeys, setVisibleColumnKeys] = useState(
    () => new Set(PLAN_CENTRIC_DEFAULT_VISIBLE_COLUMN_KEYS)
  )

  const visibleAllocationTableColumns = useMemo(() => {
    if (!isPlanCentric) return allocationTableColumns
    return allocationTableColumns.filter((c) => visibleColumnKeys.has(c.key))
  }, [allocationTableColumns, visibleColumnKeys, isPlanCentric])

  const getVesselName = useCallback(
    (vesselId) => {
      if (!vesselId) return '—'
      const v = vesselById?.[vesselId]
      return v?.vesselName || String(vesselId)
    },
    [vesselById]
  )

  const [arrivalNorFiles, setArrivalNorFiles] = useState([]) // [{ name, url }] for NOR document preview
  const [arrivalNorRawFiles, setArrivalNorRawFiles] = useState([]) // File[]
  const [arrivalSaving, setArrivalSaving] = useState(false)
  const [arrivalSaveMsg, setArrivalSaveMsg] = useState(null)
  const allocColLabel = useCallback(
    (key, fallback) =>
      tAlloc(
        ({
          sequence: 'colBerthingSequence',
          vesselName: isPlanCentric ? 'colVessel' : 'colVesselName',
          planReference: 'colPlanRef',
          jettyOperationCode: 'colJettyOperationId',
          shippingInstruction: isPlanCentric ? 'colShippingInstructions' : 'colShippingInstruction',
          commodityQty: 'colCommodityQty',
          priority: 'colPriority',
          purpose: 'colPurpose',
          shipper: 'colShipper',
          tradeTerm: 'colTerm',
          loadingPort: 'colPortOfLoading',
          agent: 'colAgent',
          surveyor: 'colSurveyor',
          remark: isPlanCentric ? 'colRemarks' : 'colRemark',
          eta: 'colEta',
          ta: 'colTa',
          etb: 'colEtb',
          tb: 'colTb',
          etc: 'colEtc',
          jetty: 'colJetty',
        })[key] || '',
        { defaultValue: fallback }
      ),
    [tAlloc, isPlanCentric]
  )

  const fileUrl = (p) => resolveUploadUrl(p)

  useEffect(() => {
    if (!vesselDetailModalVesselId) return undefined
    // Load BERTHING docs (vessel photos) for op-* vessel ids.
    const fromId = typeof vesselDetailModalVesselId === 'string' && vesselDetailModalVesselId.startsWith('op-')
      ? parseInt(vesselDetailModalVesselId.slice(3), 10)
      : null
    const vesselRow = vesselDetailRows.find((r) => r.vesselId === vesselDetailModalVesselId) || null
    const opId = Number.isFinite(fromId) ? fromId : vesselRow?.operationId ?? null
    if (!opId) return undefined

    const key = `op-${opId}`
    if (Array.isArray(vesselPhotosByVesselId[key]) && vesselPhotosByVesselId[key].length > 0) return undefined

    let alive = true
    fetchOperationDocuments(opId, 'BERTHING')
      .then((res) => {
        if (!alive) return
        const items = Array.isArray(res?.items) ? res.items : Array.isArray(res) ? res : []
        const mapped = items
          .map((d) => ({
            url: fileUrl(d.url),
            name: d.name || 'Berthing photo',
            mimeType: d.mimeType ?? null,
          }))
          .filter((x) => x.url)
        if (mapped.length === 0) return
        setVesselPhotosByVesselId((prev) => ({ ...prev, [key]: mapped }))
      })
      .catch(() => {})

    return () => {
      alive = false
    }
  }, [vesselDetailModalVesselId, vesselDetailRows, vesselPhotosByVesselId, fileUrl])

  const refreshOverview = useCallback(async () => {
    const data = await overviewFetcher()
    const q = Array.isArray(data?.queue) ? data.queue : []
    setList(q)
    setScheduleList(Array.isArray(data?.scheduleQueue) ? data.scheduleQueue : q)
    setBerthsState(Array.isArray(data?.berths) ? data.berths : [])
    return q
  }, [overviewFetcher])

  const swapPlanBerthingSequencePair = useCallback(
    async (planIdA, planIdB, earlierPlanId) => {
      const a = Number(planIdA)
      const b = Number(planIdB)
      if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return
      const busyKey = `${Math.min(a, b)}-${Math.max(a, b)}`
      setPlanSequenceBusyPair(busyKey)
      setPlanSequenceSwapError(null)
      try {
        const earlier =
          earlierPlanId != null && Number.isFinite(Number(earlierPlanId)) ? Number(earlierPlanId) : undefined
        await swapShipmentPlanBerthingSequence(a, b, {
          activityLogPage: activityLogPageKey,
          earlierPlanId: earlier,
        })
        await refreshOverview()
      } catch (e) {
        const msg =
          e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Sequence update failed'
        setPlanSequenceSwapError(msg)
      } finally {
        setPlanSequenceBusyPair(null)
      }
    },
    [activityLogPageKey, refreshOverview]
  )

  const closeReDockModal = useCallback(() => {
    setReDockModal(null)
    setReDockRemarkDraft('')
    setReDockModalError(null)
  }, [])

  const openReDockModal = useCallback((row, e) => {
    e?.stopPropagation?.()
    const opId = row?.operationId
    if (!opId) return
    setReDockModalError(null)
    setReDockModal({ row })
    setReDockRemarkDraft(String(row.remark ?? row.remarks ?? ''))
  }, [])

  const confirmReDock = useCallback(async () => {
    const row = reDockModal?.row
    const opId = row?.operationId
    if (!opId) return
    const trimmed = reDockRemarkDraft.trim()
    if (!trimmed) {
      setReDockModalError('Enter a remark before confirming re-dock.')
      return
    }
    setReDockModalError(null)
    setShiftSavingByOpId((m) => ({ ...m, [opId]: true }))
    try {
      const vesselLabel = row.vesselName || row.shippingInstruction || 'Vessel'
      await setOperationShiftingOut(opId, false, trimmed, { activityLogPage: activityLogPageKey })
      closeReDockModal()
      setReDockSuccessMessage(
        `Redocking complete for ${vesselLabel}. You may now resume activities via the 'At-Berth Executions'.`
      )
      await refreshOverview()
    } catch (err) {
      setReDockModalError(err?.message || 'Re-dock failed')
    } finally {
      setShiftSavingByOpId((m) => ({ ...m, [opId]: false }))
    }
  }, [reDockModal, reDockRemarkDraft, refreshOverview, closeReDockModal])

  const openArrivalUpdate = (r) => {
    setArrivalUpdateForm({
      ...r,
      etaDateTime: toDateTimeLocalValue(r.etaDateTime),
      taDateTime: toDateTimeLocalValue(r.taDateTime),
      etbDateTime: toDateTimeLocalValue(r.etbDateTime),
      estimatedCompletionDateTime: toDateTimeLocalValue(r.estimatedCompletionDateTime),
      norTenderedDateTime: toDateTimeLocalValue(r.norTenderedDateTime),
      norAcceptedDateTime: toDateTimeLocalValue(r.norAcceptedDateTime),
      demurrageLiabilityFromDateTime: toDateTimeLocalValue(r.demurrageLiabilityFromDateTime),
    })
    // Captured so saveArrivalUpdate can detect a *new/changed* jetty assignment
    // (vs. an unrelated edit on a row that already has a jetty) and require ETB then.
    setArrivalUpdateOriginalJetty((r.jetty || '').trim().split('/')[0].trim())
    setArrivalNorFiles([])
    setArrivalNorRawFiles([])
    setArrivalSaving(false)
    setArrivalSaveMsg(null)
  }

  const addArrivalNorFiles = (files) => {
    if (!files?.length) return
    const newOnes = Array.from(files).map((file) => ({
      name: file.name,
      url: URL.createObjectURL(file),
    }))
    setArrivalNorFiles((prev) => [...prev, ...newOnes])
    setArrivalNorRawFiles((prev) => [...prev, ...Array.from(files)])
  }

  // ETB is required once the user picks a jetty different from what the row had when
  // "Log arrival update" was opened (mirrors the server-side check in PUT /allocation/arrival).
  const isEtbRequiredForArrivalForm = (form) => {
    if (!form) return false
    const currentJetty = (form.jetty || '').trim().split('/')[0].trim()
    return Boolean(currentJetty) && currentJetty !== arrivalUpdateOriginalJetty
  }

  const saveArrivalUpdate = async () => {
    if (!arrivalUpdateForm) return
    setArrivalSaving(true)
    setArrivalSaveMsg(null)

    // Validate selected jetty suitability (LOA / DWT / commodity) before saving.
    const targetJettyId = (arrivalUpdateForm.jetty || '').trim().split('/')[0].trim()

    // A jetty is only being (re)assigned when it differs from what the row had when
    // this modal opened; ETB is required at that moment so Planned Berthing data stays
    // populated going forward (unrelated edits on rows that already have a jetty aren't blocked).
    const jettyBeingAssigned = Boolean(targetJettyId) && targetJettyId !== arrivalUpdateOriginalJetty
    if (jettyBeingAssigned && !arrivalUpdateForm.etbDateTime) {
      setArrivalSaveMsg('ETB is required when assigning a jetty.')
      setArrivalSaving(false)
      return
    }

    if (targetJettyId) {
      const jettyValidation = validateJettyAdviceSelection({
        jettyAdvice: arrivalJettyAdvice,
        selectedJettyShortId: targetJettyId,
        jetties: portJetties,
        ctx: { loa: arrivalUpdateForm.vesselLoaM, dwt: arrivalUpdateForm.vesselDwt },
        t: tSp,
      })
      if (!jettyValidation.ok) {
        setArrivalSaveMsg(jettyValidation.message)
        setArrivalSaving(false)
        return
      }
    }

    // Validate selected jetty availability before saving arrival update.
    if (targetJettyId) {
      const berth = berthsState.find((b) => b.id === targetJettyId)
      if (!berth) {
        setArrivalSaveMsg(`Jetty ${targetJettyId} not found.`)
        setArrivalSaving(false)
        return
      }
      if (isBerthOutOfService(berth)) {
        setArrivalSaveMsg(jettyOosAllocationMessage(targetJettyId, canViewMasterJetty))
        setArrivalSaving(false)
        return
      }
      const capacity = berth.capacity != null ? Number(berth.capacity) : 1
      const occList = Array.isArray(berth.occupants) ? berth.occupants : (berth.currentVesselId ? [{ vesselId: berth.currentVesselId }] : [])
      const others = occList.filter((o) => o?.vesselId && o.vesselId !== arrivalUpdateForm.vesselId)
      const isFull = others.length >= Math.max(1, capacity)
      if (isFull) {
        const firstOccId = others[0]?.vesselId
        const occupantName = firstOccId ? getVesselName(firstOccId) : 'another vessel'
        const occupantRow = firstOccId ? list.find((x) => x.vesselId === firstOccId) : null
        const candidateArrivalMs = getArrivalMsForJettyValidation(arrivalUpdateForm)
        const completionCandidates = others
          .map((o) => list.find((x) => x.vesselId === o.vesselId))
          .map((row) => getCompletionMsForJettyValidation(row))
          .filter((x) => x != null)
        const earliestFreeMs = completionCandidates.length ? Math.min(...completionCandidates) : null

        const canAllocateAfterCompletion =
          candidateArrivalMs != null &&
          earliestFreeMs != null &&
          candidateArrivalMs >= earliestFreeMs

        if (!canAllocateAfterCompletion) {
          const completionHint =
            earliestFreeMs != null
              ? ` Earliest estimated completion: ${formatDateTimeDisplay(new Date(earliestFreeMs).toISOString())}.`
              : ' Estimated/actual completion for current occupants is not set.'
          setArrivalSaveMsg(
            `Jetty ${targetJettyId} is full (${others.length}/${Math.max(1, capacity)}). Example occupant: ${occupantName}.${completionHint} Please choose another jetty or set a later arrival.`
          )
          setArrivalSaving(false)
          return
        }
      }
    }

    const norFilesToUpload = arrivalNorRawFiles
    const newSequence = Math.max(1, Math.min(list.length, Number(arrivalUpdateForm.sequence) || 1))
    const updated = {
      ...arrivalUpdateForm,
      sequence: newSequence,
      eta: arrivalUpdateForm.etaDateTime ? formatDateTimeDisplay(arrivalUpdateForm.etaDateTime) : arrivalUpdateForm.eta,
      ta: arrivalUpdateForm.taDateTime ? formatDateTimeDisplay(arrivalUpdateForm.taDateTime) : arrivalUpdateForm.ta,
      etb: arrivalUpdateForm.etbDateTime ? formatDateTimeDisplay(arrivalUpdateForm.etbDateTime) : arrivalUpdateForm.etb,
      norTenderedDateTime: arrivalUpdateForm.norTenderedDateTime || undefined,
      norAcceptedDateTime: arrivalUpdateForm.norAcceptedDateTime || undefined,
      demurrageLiabilityFromDateTime: arrivalUpdateForm.demurrageLiabilityFromDateTime || undefined,
      norDocumentNames: arrivalNorFiles.length > 0 ? arrivalNorFiles.map((f) => f.name) : undefined,
    }
    // Plan-centric table rows are merged; do not write them back into the flat API queue.
    if (!isPlanCentric) {
      const listWithUpdate = list.map((row) => (row.id === arrivalUpdateForm.id ? updated : row))
      const bySequence = [...listWithUpdate].sort((a, b) => seqSortKey(a) - seqSortKey(b))
      const renumbered = bySequence.map((row, i) => ({ ...row, sequence: i + 1 }))
      setList(renumbered)
    }

    const planOnlySave = isPlanOnlySchedulingRow(updated)
    let saveRes
    try {
      const arrivalPayload = {
        activityLogPage: activityLogPageKey,
        operationId: updated.operationId,
        shippingInstructionId: updated.shippingInstructionId,
        shipmentPlanId: planOnlySave ? updated.shipmentPlanId : undefined,
        noPkk: updated.noPkk ?? '',
        jetty: updated.jetty ?? '',
        priority: updated.priority || '',
        etaDateTime: normalizeForApiOrEmpty(updated.etaDateTime, scheduleEntryTz),
        etbDateTime: normalizeForApiOrEmpty(updated.etbDateTime, scheduleEntryTz),
        remark: updated.remark ?? updated.remarks ?? '',
      }
      if (!planOnlySave) {
        Object.assign(arrivalPayload, {
          taDateTime: normalizeForApiOrEmpty(updated.taDateTime, scheduleEntryTz),
          pobDateTime: normalizeForApiOrEmpty(updated.pobDateTime, scheduleEntryTz),
          tbDateTime: normalizeForApiOrEmpty(updated.tbDateTime, scheduleEntryTz),
          sobDateTime: normalizeForApiOrEmpty(updated.sobDateTime, scheduleEntryTz),
          estimatedCompletionDateTime: normalizeForApiOrEmpty(
            updated.estimatedCompletionDateTime,
            scheduleEntryTz
          ),
          norTenderedDateTime: normalizeForApiOrEmpty(updated.norTenderedDateTime, scheduleEntryTz),
          norAcceptedDateTime: normalizeForApiOrEmpty(updated.norAcceptedDateTime, scheduleEntryTz),
          demurrageLiabilityFromDateTime: normalizeForApiOrEmpty(
            updated.demurrageLiabilityFromDateTime,
            scheduleEntryTz
          ),
        })
      }
      saveRes = await saveArrivalUpdateApi(arrivalPayload)
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Save failed. Check your connection and try again.'
      await refreshOverview().catch(() => {})
      setArrivalSaveMsg(msg)
      setArrivalSaving(false)
      return
    }

    const opId = updated.operationId || saveRes?.operationId
    let norUploadError = null
    if (opId && norFilesToUpload.length > 0) {
      try {
        await uploadOperationDocuments(opId, 'NOR', norFilesToUpload)
      } catch (e) {
        norUploadError =
          e instanceof Error ? e.message : typeof e === 'string' ? e : 'NOR upload failed'
      }
    }

    await refreshOverview().catch(() => {})

    setArrivalNorFiles([])
    setArrivalNorRawFiles([])
    setArrivalSaving(false)
    setArrivalUpdateForm(null)

    if (norUploadError) {
      setArrivalSuccessMessage(
        `Arrival saved, but NOR upload failed: ${norUploadError}`
      )
    } else if (norFilesToUpload.length > 0) {
      setArrivalSuccessMessage('Arrival update saved. NOR uploaded.')
    } else {
      setArrivalSuccessMessage('Arrival update saved.')
    }
  }

  const moveSequenceUp = (r, e) => {
    e.stopPropagation()
    const bySeq = [...list].sort((a, b) => seqSortKey(a) - seqSortKey(b))
    const i = bySeq.findIndex((row) => row.id === r.id)
    if (i <= 0) return
    ;[bySeq[i - 1], bySeq[i]] = [bySeq[i], bySeq[i - 1]]
    const renumbered = bySeq.map((row, idx) => ({ ...row, sequence: idx + 1 }))
    setList(renumbered)
  }

  const moveSequenceDown = (r, e) => {
    e.stopPropagation()
    const bySeq = [...list].sort((a, b) => seqSortKey(a) - seqSortKey(b))
    const i = bySeq.findIndex((row) => row.id === r.id)
    if (i < 0 || i >= bySeq.length - 1) return
    ;[bySeq[i], bySeq[i + 1]] = [bySeq[i + 1], bySeq[i]]
    const renumbered = bySeq.map((row, idx) => ({ ...row, sequence: idx + 1 }))
    setList(renumbered)
  }

  const handleBerthClick = (berthId) => {
    const berth = berthsState.find((b) => b.id === berthId)
    const id = berth?.currentVesselId
    if (!id) return
    if (isPlanCentric) selectVesselFromVisualization(id)
    else {
      setVesselDetailPlanId(null)
      setPlanDetail(null)
      setPlanDetailError(null)
      setPlanDetailLoading(false)
      setVesselDetailModalVesselId(id)
    }
  }

  /** Resolve row.jetty to a single berth id (e.g. "1A" or "1A/2A" → "1A") */
  const getTargetJettyId = (row) => {
    const raw = (row.jetty || '').trim()
    return raw.split('/')[0].trim() || null
  }

  const handleBerthingConfirm = async () => {
    if (!berthingConfirmRow) return
    const targetJettyId = (berthingSelectedJetty || '').trim()
    const errors = []
    if (!targetJettyId) {
      errors.push('Please select a jetty.')
    } else {
      const jettyValidation = validateJettyAdviceSelection({
        jettyAdvice: berthingJettyAdvice,
        selectedJettyShortId: targetJettyId,
        jetties: portJetties,
        ctx: { loa: berthingConfirmRow.vesselLoaM, dwt: berthingConfirmRow.vesselDwt },
        t: tSp,
      })
      if (!jettyValidation.ok) {
        errors.push(jettyValidation.message)
      }
      const berth = berthsState.find((b) => b.id === targetJettyId)
      if (!berth) {
        errors.push(`Jetty ${targetJettyId} not found.`)
      } else if (isBerthOutOfService(berth)) {
        errors.push(jettyOosAllocationMessage(targetJettyId, canViewMasterJetty))
      } else {
        const capacity = berth.capacity != null ? Number(berth.capacity) : 1
        const occList = Array.isArray(berth.occupants)
          ? berth.occupants
          : (berth.currentVesselId ? [{ vesselId: berth.currentVesselId }] : [])
        const others = occList.filter((o) => o?.vesselId && o.vesselId !== berthingConfirmRow.vesselId)
        const isFull = others.length >= Math.max(1, capacity)
        if (isFull) {
          const occupantId = others[0]?.vesselId
          const occupantName = occupantId ? getVesselName(occupantId) : 'another vessel'
          errors.push(
            `Jetty ${targetJettyId} is full (${others.length}/${Math.max(1, capacity)}). Example occupant: ${occupantName}. Please choose another jetty.`
          )
        }
      }
    }
    if (!(berthingTa || '').trim()) {
      errors.push('Please enter Actual Time of Arrival (TA).')
    }
    if (!(berthingTb || '').trim()) {
      errors.push('Please enter Actual Time of Berthing (TB).')
    }
    if (!(berthingEstimatedCompletion || '').trim()) {
      errors.push('Please enter Estimated completion.')
    }
    if (berthingPhotos.length === 0) {
      errors.push('Please upload at least one vessel photo.')
    }
    if (!(berthingRemarks || '').trim()) {
      errors.push('Please enter a remark.')
    }
    if (errors.length > 0) {
      setBerthingErrors(errors)
      return
    }
    if (!berthingConfirmRow.operationId && !berthingConfirmRow.shippingInstructionId) {
      setBerthingErrors(['Cannot save: missing operation or shipping instruction.'])
      return
    }

    setBerthingErrors([])
    setBerthingSaving(true)
    const berthingFilesToUpload = berthingPhotos.map((p) => p.file)
    let saveRes
    try {
      saveRes = await saveArrivalUpdateApi({
        activityLogPage: activityLogPageKey,
        operationId: berthingConfirmRow.operationId,
        shippingInstructionId: berthingConfirmRow.shippingInstructionId,
        noPkk: berthingConfirmRow.noPkk ?? '',
        jetty: targetJettyId,
        priority: berthingConfirmRow.priority || '',
        etaDateTime: normalizeForApiOrEmpty(berthingConfirmRow.etaDateTime, scheduleEntryTz),
        taDateTime: normalizeForApiOrEmpty(berthingTa, scheduleEntryTz),
        etbDateTime: normalizeForApiOrEmpty(berthingConfirmRow.etbDateTime, scheduleEntryTz),
        pobDateTime: normalizeForApiOrEmpty(berthingPob, scheduleEntryTz),
        tbDateTime: normalizeForApiOrEmpty(berthingTb, scheduleEntryTz),
        sobDateTime: normalizeForApiOrEmpty(berthingSob, scheduleEntryTz),
        estimatedCompletionDateTime: normalizeForApiOrEmpty(berthingEstimatedCompletion, scheduleEntryTz),
        norTenderedDateTime: normalizeForApiOrEmpty(berthingConfirmRow.norTenderedDateTime, scheduleEntryTz),
        norAcceptedDateTime: normalizeForApiOrEmpty(berthingConfirmRow.norAcceptedDateTime, scheduleEntryTz),
        demurrageLiabilityFromDateTime: normalizeForApiOrEmpty(
          berthingConfirmRow.demurrageLiabilityFromDateTime,
          scheduleEntryTz
        ),
        remark: (berthingRemarks || '').trim(),
      })
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Save failed. Check your connection and try again.'
      setBerthingErrors([msg])
      setBerthingSaving(false)
      return
    }

    const opId = berthingConfirmRow.operationId || saveRes?.operationId
    let photoUploadError = null
    let savedPhotoItems = []
    if (opId && berthingFilesToUpload.length > 0) {
      try {
        const uploadRes = await uploadOperationDocuments(opId, 'BERTHING', berthingFilesToUpload)
        savedPhotoItems = Array.isArray(uploadRes?.items)
          ? uploadRes.items.map((d) => ({ url: fileUrl(d.url), name: d.name || 'Berthing photo' }))
          : []
      } catch (e) {
        photoUploadError =
          e instanceof Error ? e.message : typeof e === 'string' ? e : 'Berthing photo upload failed'
      }
    }

    setBerthingSaving(false)
    await refreshOverview().catch(() => {})

    setVesselPhotosByVesselId((prev) => ({
      ...prev,
      ...(berthingConfirmRow.vesselId
        ? {
            [berthingConfirmRow.vesselId]:
              savedPhotoItems.length > 0
                ? savedPhotoItems
                : berthingPhotos.map((p) => ({ url: p.previewUrl, name: p.file.name })),
          }
        : {}),
      ...(opId ? { [`op-${opId}`]: savedPhotoItems.length > 0 ? savedPhotoItems : berthingPhotos.map((p) => ({ url: p.previewUrl, name: p.file.name })) } : {}),
    }))

    // Do not manually mutate berths/list after refreshOverview:
    // - overview is the source of truth (supports multi-occupant / capacity)
    // - removing rows here can make the schematic miss vessel details until a full reload
    const vesselName = berthingConfirmRow.vesselName || 'Vessel'
    if (photoUploadError) {
      setBerthingSuccessMessage(
        `${vesselName} has been allocated to Jetty ${targetJettyId}, but vessel photo upload failed: ${photoUploadError}`
      )
    } else if (berthingFilesToUpload.length > 0) {
      setBerthingSuccessMessage(
        `${vesselName} has been allocated to Jetty ${targetJettyId}. Berthing completed and vessel photo uploaded.`
      )
    } else {
      setBerthingSuccessMessage(`${vesselName} has been allocated to Jetty ${targetJettyId}. Berthing completed successfully.`)
    }
    closeBerthingConfirm()
  }

  const openBerthingConfirm = (r, e) => {
    e.stopPropagation()
    const berthBlock = berthingDisabledReason(r, { planCentric: isPlanCentric })
    if (berthBlock) return
    setBerthingErrors([])
    setBerthingConfirmRow(r)
    setBerthingSelectedJetty(getTargetJettyId(r) || '')
    setBerthingPob(r.pobDateTime || '')
    setBerthingTa(toDateTimeLocalValue(r.taDateTime))
    setBerthingTb(toDateTimeLocalValue(r.tbDateTime) || getNowForDateTimeLocal())
    setBerthingSob(r.sobDateTime || '')
    setBerthingEstimatedCompletion(toDateTimeLocalValue(r.estimatedCompletionDateTime))
    setBerthingPhotos([])
    setBerthingRemarks(r.remark ?? r.remarks ?? '')
    setBerthingSaving(false)
  }

  const closeBerthingConfirm = (skipRevoke = false) => {
    if (!skipRevoke) {
      berthingPhotos.forEach((p) => {
        if (p.previewUrl) URL.revokeObjectURL(p.previewUrl)
      })
    }
    setBerthingConfirmRow(null)
    setBerthingErrors([])
    setBerthingSelectedJetty('')
    setBerthingPob('')
    setBerthingTa('')
    setBerthingTb('')
    setBerthingSob('')
    setBerthingEstimatedCompletion('')
    setBerthingPhotos([])
    setBerthingRemarks('')
    setBerthingSaving(false)
  }

  const addBerthingPhotos = (e) => {
    const files = Array.from(e.target.files || [])
    const newPhotos = files.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file,
      previewUrl: URL.createObjectURL(file),
    }))
    setBerthingPhotos((prev) => [...prev, ...newPhotos])
    e.target.value = ''
  }

  const removeBerthingPhoto = (id) => {
    setBerthingPhotos((prev) => {
      const p = prev.find((x) => x.id === id)
      if (p?.previewUrl) URL.revokeObjectURL(p.previewUrl)
      return prev.filter((x) => x.id !== id)
    })
  }

  useEffect(() => {
    if (!vesselDetailModalVesselId) {
      setVesselDetailEditing(false)
      setVesselDetailDraft(null)
      setVesselDetailEditError(null)
      setVesselDetailEditSaving(false)
      setVesselDetailNorNewFiles([])
      setVesselDetailNorNewRaw([])
      setVesselDetailPlanId(null)
      setPlanDetail(null)
      setPlanDetailError(null)
      setPlanDetailLoading(false)
      setVesselDetailBerthingNewPhotos((prev) => {
        prev.forEach((p) => {
          if (p.previewUrl) URL.revokeObjectURL(p.previewUrl)
        })
        return []
      })
      return
    }
    const onKeyDown = (e) => {
      if (e.key !== 'Escape') return
      if (siDocumentModalId != null) {
        setSiDocumentModalId(null)
        return
      }
      if (siDetailId != null) {
        setSiDetailId(null)
        return
      }
      if (vesselDetailEditing) {
        setVesselDetailBerthingNewPhotos((prev) => {
          prev.forEach((p) => {
            if (p.previewUrl) URL.revokeObjectURL(p.previewUrl)
          })
          return []
        })
        setVesselDetailNorNewFiles([])
        setVesselDetailNorNewRaw([])
        setVesselDetailEditing(false)
        setVesselDetailDraft(null)
        setVesselDetailEditError(null)
        return
      }
      closeVesselDetailModal()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [vesselDetailModalVesselId, siDetailId, siDocumentModalId, vesselDetailEditing, closeVesselDetailModal])

  const addVesselDetailNorNewFiles = (fileList) => {
    if (!fileList?.length) return
    const arr = Array.from(fileList)
    setVesselDetailNorNewFiles((prev) => [...prev, ...arr.map((file) => ({ name: file.name }))])
    setVesselDetailNorNewRaw((prev) => [...prev, ...arr])
  }

  const addVesselDetailBerthingNewPhotos = (e) => {
    const files = Array.from(e.target.files || [])
    const newPhotos = files.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file,
      previewUrl: URL.createObjectURL(file),
    }))
    setVesselDetailBerthingNewPhotos((prev) => [...prev, ...newPhotos])
    e.target.value = ''
  }

  const removeVesselDetailBerthingNewPhoto = (id) => {
    setVesselDetailBerthingNewPhotos((prev) => {
      const p = prev.find((x) => x.id === id)
      if (p?.previewUrl) URL.revokeObjectURL(p.previewUrl)
      return prev.filter((x) => x.id !== id)
    })
  }

  const openVesselDetailEdit = (vessel) => {
    if (!vessel?.operationId) return
    setVesselDetailEditError(null)
    setVesselDetailNorNewFiles([])
    setVesselDetailNorNewRaw([])
    setVesselDetailBerthingNewPhotos([])
    setVesselDetailDraft({
      etaDateTime: toDateTimeLocalValue(vessel.etaDateTime),
      taDateTime: toDateTimeLocalValue(vessel.taDateTime),
      etbDateTime: toDateTimeLocalValue(vessel.etbDateTime),
      pobDateTime: toDateTimeLocalValue(vessel.pobDateTime),
      tbDateTime: toDateTimeLocalValue(vessel.tbDateTime),
      sobDateTime: toDateTimeLocalValue(vessel.sobDateTime),
      estimatedCompletionDateTime: toDateTimeLocalValue(vessel.estimatedCompletionDateTime),
      norTenderedDateTime: toDateTimeLocalValue(vessel.norTenderedDateTime),
      norAcceptedDateTime: toDateTimeLocalValue(vessel.norAcceptedDateTime),
      demurrageLiabilityFromDateTime: toDateTimeLocalValue(vessel.demurrageLiabilityFromDateTime),
      noPkk: vessel.noPkk ?? '',
      priority: vessel.priority || '',
      jetty: getTargetJettyId(vessel) || '',
      remark: vessel.remark ?? vessel.remarks ?? '',
    })
    // Captured so saveVesselDetailEdit can detect a *new/changed* jetty assignment
    // (vs. an unrelated edit on a row that already has a jetty) and require ETB then.
    setVesselDetailOriginalJetty((getTargetJettyId(vessel) || '').trim())
    setVesselDetailEditing(true)
  }

  const cancelVesselDetailEdit = () => {
    setVesselDetailBerthingNewPhotos((prev) => {
      prev.forEach((p) => {
        if (p.previewUrl) URL.revokeObjectURL(p.previewUrl)
      })
      return []
    })
    setVesselDetailNorNewFiles([])
    setVesselDetailNorNewRaw([])
    setVesselDetailEditing(false)
    setVesselDetailDraft(null)
    setVesselDetailEditError(null)
  }

  // ETB is required once the user picks a jetty different from what the row had when
  // the vessel detail edit was opened (mirrors the server-side check in PUT /allocation/arrival).
  const isEtbRequiredForVesselDetailDraft = (draft) => {
    if (!draft) return false
    const currentJetty = (draft.jetty || '').trim().split('/')[0].trim()
    return Boolean(currentJetty) && currentJetty !== vesselDetailOriginalJetty
  }

  const saveVesselDetailEdit = async (vessel) => {
    if (!vessel?.operationId || !vesselDetailDraft) return
    const targetJettyId = (vesselDetailDraft.jetty || '').trim().split('/')[0].trim()

    // A jetty is only being (re)assigned when it differs from what the row had when this
    // edit opened; ETB is required at that moment (mirrors Log arrival update / server check).
    const jettyBeingAssigned = Boolean(targetJettyId) && targetJettyId !== vesselDetailOriginalJetty
    if (jettyBeingAssigned && !vesselDetailDraft.etbDateTime) {
      setVesselDetailEditError('ETB is required when assigning a jetty.')
      return
    }

    if (targetJettyId) {
      const berth = berthsState.find((b) => b.id === targetJettyId)
      if (!berth) {
        setVesselDetailEditError(`Jetty ${targetJettyId} not found.`)
        return
      }
      if (isBerthOutOfService(berth)) {
        setVesselDetailEditError(jettyOosAllocationMessage(targetJettyId, canViewMasterJetty))
        return
      }
      const capacity = berth.capacity != null ? Number(berth.capacity) : 1
      const occList = Array.isArray(berth.occupants) ? berth.occupants : berth.currentVesselId ? [{ vesselId: berth.currentVesselId }] : []
      const others = occList.filter((o) => o?.vesselId && o.vesselId !== vessel.vesselId)
      const isFull = others.length >= Math.max(1, capacity)
      if (isFull) {
        const firstOccId = others[0]?.vesselId
        const occupantName = firstOccId ? getVesselName(firstOccId) : 'another vessel'
        const occupantRow = firstOccId ? list.find((x) => x.vesselId === firstOccId) : null
        const candidateArrivalMs = getArrivalMsForJettyValidation({
          ...vessel,
          etaDateTime: vesselDetailDraft.etaDateTime || vessel.etaDateTime,
          etbDateTime: vesselDetailDraft.etbDateTime || vessel.etbDateTime,
          taDateTime: vesselDetailDraft.taDateTime || vessel.taDateTime,
        })
        const completionCandidates = others
          .map((o) => list.find((x) => x.vesselId === o.vesselId))
          .map((row) => getCompletionMsForJettyValidation(row))
          .filter((x) => x != null)
        const earliestFreeMs = completionCandidates.length ? Math.min(...completionCandidates) : null
        const canAllocateAfterCompletion =
          candidateArrivalMs != null && earliestFreeMs != null && candidateArrivalMs >= earliestFreeMs
        if (!canAllocateAfterCompletion) {
          const completionHint =
            earliestFreeMs != null
              ? ` Earliest estimated completion: ${formatDateTimeDisplay(new Date(earliestFreeMs).toISOString())}.`
              : ' Estimated/actual completion for current occupants is not set.'
          setVesselDetailEditError(
            `Jetty ${targetJettyId} is full (${others.length}/${Math.max(1, capacity)}). Example occupant: ${occupantName}.${completionHint} Please choose another jetty or set a later arrival.`
          )
          return
        }
      }
    }

    setVesselDetailEditSaving(true)
    setVesselDetailEditError(null)
    const norRaw = vesselDetailNorNewRaw
    const berthDraft = vesselDetailBerthingNewPhotos
    try {
      const putRes = await saveArrivalUpdateApi({
        activityLogPage: activityLogPageKey,
        operationId: vessel.operationId,
        shippingInstructionId: vessel.shippingInstructionId,
        noPkk: vesselDetailDraft.noPkk ?? '',
        jetty: targetJettyId,
        priority: vesselDetailDraft.priority || '',
        etaDateTime: normalizeForApiOrEmpty(vesselDetailDraft.etaDateTime, scheduleEntryTz),
        taDateTime: normalizeForApiOrEmpty(vesselDetailDraft.taDateTime, scheduleEntryTz),
        etbDateTime: normalizeForApiOrEmpty(vesselDetailDraft.etbDateTime, scheduleEntryTz),
        pobDateTime: normalizeForApiOrEmpty(vesselDetailDraft.pobDateTime, scheduleEntryTz),
        tbDateTime: normalizeForApiOrEmpty(vesselDetailDraft.tbDateTime, scheduleEntryTz),
        sobDateTime: normalizeForApiOrEmpty(vesselDetailDraft.sobDateTime, scheduleEntryTz),
        estimatedCompletionDateTime: normalizeForApiOrEmpty(
          vesselDetailDraft.estimatedCompletionDateTime,
          scheduleEntryTz
        ),
        norTenderedDateTime: normalizeForApiOrEmpty(vesselDetailDraft.norTenderedDateTime, scheduleEntryTz),
        norAcceptedDateTime: normalizeForApiOrEmpty(vesselDetailDraft.norAcceptedDateTime, scheduleEntryTz),
        demurrageLiabilityFromDateTime: normalizeForApiOrEmpty(
          vesselDetailDraft.demurrageLiabilityFromDateTime,
          scheduleEntryTz
        ),
        remark: vesselDetailDraft.remark ?? '',
        source: 'active_vessel_detail',
      })
      const opId = vessel.operationId
      if (norRaw.length > 0) {
        await uploadOperationDocuments(opId, 'NOR', norRaw)
      }
      const berthFiles = berthDraft.map((p) => p.file)
      if (berthFiles.length > 0) {
        await uploadOperationDocuments(opId, 'BERTHING', berthFiles)
      }
      await refreshOverview()
      if (putRes && putRes.ok && putRes.operationId != null) {
        const oid = Number(putRes.operationId)
        setList((prev) =>
          prev.map((row) =>
            row.operationId === oid
              ? {
                  ...row,
                  recordLastUpdatedAt: putRes.recordLastUpdatedAt ?? row.recordLastUpdatedAt,
                  recordLastUpdatedByDisplayName:
                    putRes.recordLastUpdatedByDisplayName !== undefined
                      ? putRes.recordLastUpdatedByDisplayName
                      : row.recordLastUpdatedByDisplayName,
                }
              : row
          )
        )
      }
      setVesselPhotosByVesselId((prev) => {
        const next = { ...prev }
        delete next[`op-${opId}`]
        delete next[vessel.vesselId]
        return next
      })
      berthDraft.forEach((p) => {
        if (p.previewUrl) URL.revokeObjectURL(p.previewUrl)
      })
      setVesselDetailEditing(false)
      setVesselDetailDraft(null)
      setVesselDetailNorNewFiles([])
      setVesselDetailNorNewRaw([])
      setVesselDetailBerthingNewPhotos([])
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Save failed. Check your connection and try again.'
      setVesselDetailEditError(msg)
    } finally {
      setVesselDetailEditSaving(false)
    }
  }

  useEffect(() => {
    if (!arrivalUpdateForm) return
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setArrivalUpdateForm(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [arrivalUpdateForm])

  useEffect(() => {
    if (!berthingConfirmRow) return
    const onKeyDown = (e) => {
      if (e.key === 'Escape') closeBerthingConfirm()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [berthingConfirmRow])

  useEffect(() => {
    if (!berthingSuccessMessage) return
    const t = setTimeout(() => setBerthingSuccessMessage(null), 5000)
    return () => clearTimeout(t)
  }, [berthingSuccessMessage])

  useEffect(() => {
    if (!arrivalSuccessMessage) return
    const t = setTimeout(() => setArrivalSuccessMessage(null), 6000)
    return () => clearTimeout(t)
  }, [arrivalSuccessMessage])

  useEffect(() => {
    if (!reDockSuccessMessage) return
    const t = setTimeout(() => setReDockSuccessMessage(null), 7500)
    return () => clearTimeout(t)
  }, [reDockSuccessMessage])

  const updateFilter = (key, value) => setFilters((f) => ({ ...f, [key]: value }))
  const handleSort = (key) => setSortState((s) => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }))

  const filterKeys = useMemo(() => allocationColumnDefsBase.map((c) => c.key), [allocationColumnDefsBase])

  /** Plan-centric table is one row per plan — merge before status/SI slice filters. */
  const planCentricMergedQueue = useMemo(() => {
    if (!isPlanCentric) return []
    const { mergedRows } = mergeQueueRowsForPlanPov(list, { idMode: 'representative' })
    // Safety dedup: the merge should already produce one row per plan, but guard
    // against any raw rows that slipped through with a duplicate shipmentPlanId.
    const seenPlanIds = new Set()
    return mergedRows.filter((r) => {
      const pid = r?.shipmentPlanId != null ? Number(r.shipmentPlanId) : null
      if (pid == null || Number.isNaN(pid)) return true  // unlinked rows always pass
      if (seenPlanIds.has(pid)) return false
      seenPlanIds.add(pid)
      return true
    })
  }, [isPlanCentric, list])

  const filteredList = useMemo(() => {
    const source = isPlanCentric ? planCentricMergedQueue : list
    return source.filter((r) => {
      const rowStatus = getBerthingPlanStatus(r, { planCentric: isPlanCentric })
      if (queueKpiFilter) {
        // KPI drill-down: rows with a plan match strictly on plan id; plan-less rows fall back to vesselId.
        const match =
          r.shipmentPlanId != null
            ? queueKpiFilter.planIds.has(Number(r.shipmentPlanId))
            : r.vesselId != null && queueKpiFilter.vesselIds.has(r.vesselId)
        if (!match) return false
      } else if (etcBreachFilter) {
        if (rowStatus !== 'berthed' || !getEtcBreach(r, breachNowMs)) return false
      } else if (!rowPassesAllocationStatusFilter(r, rowStatus, statusFilter, isPlanCentric)) {
        return false
      }
      return filterKeys.every((key) => {
        const f = (filters[key] || '').trim().toLowerCase()
        if (!f) return true
        const col = allocationColumnDefsBase.find((c) => c.key === key)
        const val = col?.getFilterValue
          ? col.getFilterValue(r)
          : key === 'purpose'
            ? resolvePurposeLabel(r.purpose, r.loadDischarge) || r[key]
            : key === 'planReference'
              ? r.planReference || (r.shipmentPlanId != null ? `Plan #${r.shipmentPlanId}` : '')
              : r[key]
        return String(val ?? '').toLowerCase().includes(f)
      })
    })
  }, [
    isPlanCentric,
    planCentricMergedQueue,
    list,
    etcBreachFilter,
    breachNowMs,
    statusFilter,
    filterKeys,
    filters,
    allocationColumnDefsBase,
    queueKpiFilter,
  ])

  const sortedList = [...filteredList].sort((a, b) => {
    const col = allocationColumnDefsBase.find((c) => c.key === sortState.key)
    if (!col) return 0
    const va = col.getSortValue(a)
    const vb = col.getSortValue(b)
    const isNum = typeof va === 'number' && typeof vb === 'number'
    const cmp = isNum ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true })
    return sortState.dir === 'asc' ? cmp : -cmp
  })

  /** Plan-centric queue: already merged + filtered in filteredList. */
  const sortedPlanQueueList = useMemo(() => {
    if (!isPlanCentric) return null
    return [...filteredList].sort((a, b) => {
      const col = allocationColumnDefsBase.find((c) => c.key === sortState.key)
      if (!col) return 0
      const va = col.getSortValue(a)
      const vb = col.getSortValue(b)
      const isNum = typeof va === 'number' && typeof vb === 'number'
      const cmp = isNum ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true })
      return sortState.dir === 'asc' ? cmp : -cmp
    })
  }, [isPlanCentric, filteredList, sortState, allocationColumnDefsBase])

  const hasQueueRows = isPlanCentric ? (sortedPlanQueueList?.length ?? 0) > 0 : sortedList.length > 0

  const renderOneDesktopRow = (r) => {
    const rowBreach = getEtcBreach(r, breachNowMs)
    // Key on vesselId: merged plan rows and op rows can collide on bare `id` (e.g. op-13 vs plan #13).
    return (
      <Fragment key={r.vesselId ?? r.id}>
        <tr
          className={[
            'allocation-table__row',
            expandedId === r.id ? 'allocation-table__row--expanded' : '',
            rowBreach ? 'allocation-table__row--etc-breach' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          onClick={() => setExpandedId((id) => (id === r.id ? null : r.id))}
        >
          <td className="allocation-table__expand-col">
            <span className="allocation-table__expand-icon" aria-hidden>
              {expandedId === r.id ? '▼' : '▶'}
            </span>
          </td>
          <td className="allocation-table__action-col" onClick={(e) => e.stopPropagation()}>
            <div className="allocation-table__action-btns">
              <button type="button" className="btn btn--primary btn--small" onClick={() => openArrivalUpdate(r)}>
                {tAlloc('logArrivalUpdate')}
              </button>
              {r.shiftingOut && r.operationId != null ? (
                <button
                  type="button"
                  className="btn btn--secondary btn--small"
                  onClick={(e) => openReDockModal(r, e)}
                  disabled={Boolean(shiftSavingByOpId[r.operationId])}
                  title="Clear shift-out so this vessel can be treated as at-berth again (preserves history)."
                >
                  {shiftSavingByOpId[r.operationId] ? tAlloc('saving') : tAlloc('reDock')}
                </button>
              ) : (
                <BerthingActionButton
                  row={r}
                  isPlanCentric={isPlanCentric}
                  label={tAlloc('berthing')}
                  onBerthing={openBerthingConfirm}
                />
              )}
            </div>
          </td>
          {visibleAllocationTableColumns.map((col) => (
            <td key={col.key} onClick={col.key === 'sequence' ? (e) => e.stopPropagation() : undefined}>
              {col.key === 'sequence' ? (
                <span className="allocation-table__sequence-cell">
                  {isPlanCentric && r.shipmentPlanId != null && canEditAllocation && sortedPlanQueueList ? (
                    (() => {
                      const displayList = sortedPlanQueueList
                      const idx = displayList.findIndex((x) => x.id === r.id)
                      const prevPlan = idx >= 0 ? findAdjacentPlanRowInDisplay(displayList, idx, -1) : null
                      const nextPlan = idx >= 0 ? findAdjacentPlanRowInDisplay(displayList, idx, 1) : null
                      const pid = Number(r.shipmentPlanId)
                      let busyThis = false
                      if (planSequenceBusyPair) {
                        const parts = planSequenceBusyPair.split('-').map((p) => parseInt(p, 10))
                        if (parts.length === 2 && parts.every((n) => Number.isFinite(n))) {
                          const [ba, bb] = parts
                          busyThis = pid === ba || pid === bb
                        }
                      }
                      return (
                        <span className="allocation-table__sequence-btns">
                          <button
                            type="button"
                            className="btn btn--small allocation-table__sequence-btn"
                            onClick={(e) => {
                              e.stopPropagation()
                              if (!prevPlan?.shipmentPlanId) return
                              void swapPlanBerthingSequencePair(pid, Number(prevPlan.shipmentPlanId), pid)
                            }}
                            disabled={!prevPlan || busyThis}
                            title="Move up"
                            aria-label="Move berthing sequence up"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="btn btn--small allocation-table__sequence-btn"
                            onClick={(e) => {
                              e.stopPropagation()
                              if (!nextPlan?.shipmentPlanId) return
                              void swapPlanBerthingSequencePair(
                                pid,
                                Number(nextPlan.shipmentPlanId),
                                Number(nextPlan.shipmentPlanId)
                              )
                            }}
                            disabled={!nextPlan || busyThis}
                            title="Move down"
                            aria-label="Move berthing sequence down"
                          >
                            ↓
                          </button>
                        </span>
                      )
                    })()
                  ) : !isPlanCentric ? (
                    <span className="allocation-table__sequence-btns">
                      <button
                        type="button"
                        className="btn btn--small allocation-table__sequence-btn"
                        onClick={(e) => moveSequenceUp(r, e)}
                        disabled={sortedList.findIndex((x) => x.id === r.id) <= 0}
                        title="Move up"
                        aria-label="Move berthing sequence up"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="btn btn--small allocation-table__sequence-btn"
                        onClick={(e) => moveSequenceDown(r, e)}
                        disabled={sortedList.findIndex((x) => x.id === r.id) >= sortedList.length - 1}
                        title="Move down"
                        aria-label="Move berthing sequence down"
                      >
                        ↓
                      </button>
                    </span>
                  ) : (
                    '—'
                  )}
                </span>
              ) : col.key === 'planReference' ? (
                r.shipmentPlanId != null ? (
                  <Link
                    to={`/shipment-plans/${r.shipmentPlanId}`}
                    className="link"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {r.planReference || `Plan #${r.shipmentPlanId}`}
                  </Link>
                ) : (
                  '—'
                )
              ) : col.key === 'jettyOperationCode' ? (
                r.shippingInstructionId ? (
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      openSiDetailModal(r.shippingInstructionId)
                    }}
                    aria-label={tAlloc('openSiDetailFromJettyOp')}
                  >
                    {r.jettyOperationCode || '—'}
                  </a>
                ) : (
                  r.jettyOperationCode || '—'
                )
              ) : col.key === 'shippingInstruction' ? (
                Array.isArray(r.planQueueSiEntries) && r.planQueueSiEntries.length > 0 ? (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.35rem',
                      alignItems: 'flex-start',
                    }}
                  >
                    {r.planQueueSiEntries.map((si) => (
                      <a
                        key={si.shippingInstructionId}
                        href="#"
                        className="link"
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          openSiDocumentModal(si.shippingInstructionId)
                        }}
                        aria-label={tAlloc('openSiDocument')}
                      >
                        {si.label}
                      </a>
                    ))}
                  </div>
                ) : r.shippingInstructionId ? (
                  <a
                    href="#"
                    className="link"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      openSiDocumentModal(r.shippingInstructionId)
                    }}
                    aria-label={tAlloc('openSiDocument')}
                  >
                    {isPlanCentric ? planCentricSiColumnDisplay(r) : r.shippingInstruction || '—'}
                  </a>
                ) : (
                  isPlanCentric ? planCentricSiColumnDisplay(r) : r.shippingInstruction || '—'
                )
              ) : col.key === 'commodityQty' ? (
                renderCommodityQtyCell(r)
              ) : col.key === 'vesselName' && r.shipmentPlanId != null ? (
                <strong className="allocation-table__vessel-cell">
                  <VesselNameButton
                    name={r.vesselName || '—'}
                    onClick={() => setVesselInfoPlanId(r.shipmentPlanId)}
                  />
                  {r.shiftingOut ? (
                    <span className="si-status-badge si-status-badge--external" style={{ marginLeft: 8 }}>
                      Shifted
                    </span>
                  ) : null}
                </strong>
              ) : (
                col.getValue(r)
              )}
            </td>
          ))}
        </tr>
        {expandedId === r.id && (
          <tr className="allocation-table__detail-row">
            <td colSpan={visibleAllocationTableColumns.length + 2} className="allocation-table__detail-cell">
              <AllocationDetailPanel
                r={r}
                tAlloc={tAlloc}
                onOpenSiDetail={openSiDetailModal}
                queueList={list}
                nowMs={breachNowMs}
              />
            </td>
          </tr>
        )}
      </Fragment>
    )
  }

  return (
    <div className="allocation-page">
      {berthingSuccessMessage && (
        <div
          className="toast toast--success"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <span className="toast__icon" aria-hidden>✓</span>
          <p className="toast__message">{berthingSuccessMessage}</p>
          <button
            type="button"
            className="toast__close"
            onClick={() => setBerthingSuccessMessage(null)}
            aria-label="Dismiss notification"
          >
            ×
          </button>
        </div>
      )}

      {arrivalSuccessMessage && (
        <div
          className={`toast ${arrivalSuccessMessage.includes('failed') ? 'toast--warning' : 'toast--success'}${berthingSuccessMessage ? ' toast--stacked' : ''}`}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <span className="toast__icon" aria-hidden>
            {arrivalSuccessMessage.includes('failed') ? '!' : '✓'}
          </span>
          <p className="toast__message">{arrivalSuccessMessage}</p>
          <button
            type="button"
            className="toast__close"
            onClick={() => setArrivalSuccessMessage(null)}
            aria-label="Dismiss notification"
          >
            ×
          </button>
        </div>
      )}

      {reDockSuccessMessage && (
        <div
          className={`toast toast--success${berthingSuccessMessage || arrivalSuccessMessage ? ' toast--stacked' : ''}`}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <span className="toast__icon" aria-hidden>
            ✓
          </span>
          <p className="toast__message">{reDockSuccessMessage}</p>
          <button
            type="button"
            className="toast__close"
            onClick={() => setReDockSuccessMessage(null)}
            aria-label={tAlloc('dismissNotification')}
          >
            ×
          </button>
        </div>
      )}

      <h1 className="page-title">{isPlanCentric ? t('allocationPlanBerthing') : t('allocation')}</h1>

      <div className="allocation-visual">
        <div className="allocation-tabs" role="tablist" aria-label={tAlloc('visualizationAria')}>
          <button
            type="button"
            role="tab"
            aria-selected={visualTab === 'schematic'}
            aria-controls="allocation-panel-schematic"
            id="allocation-tab-schematic"
            className={`allocation-tabs__tab ${visualTab === 'schematic' ? 'allocation-tabs__tab--active' : ''}`}
            onClick={() => setVisualTab('schematic')}
          >
            {tAlloc('jettySchematic')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={visualTab === 'jettySchedule'}
            aria-controls="allocation-panel-jetty-schedule"
            id="allocation-tab-jetty-schedule"
            className={`allocation-tabs__tab ${visualTab === 'jettySchedule' ? 'allocation-tabs__tab--active' : ''}`}
            onClick={() => setVisualTab('jettySchedule')}
          >
            {tAlloc('jettySchedule')}
          </button>
        </div>
        <div
          id="allocation-panel-schematic"
          role="tabpanel"
          aria-labelledby="allocation-tab-schematic"
          hidden={visualTab !== 'schematic'}
          className="allocation-tabpanel"
        >
          <JettySchematic
            berths={planViz.mergedBerths}
            scheduleList={planViz.mergedSchedule}
            viewAsOfMs={breachNowMs}
            vesselById={vesselById}
            onSelectBerth={handleBerthClick}
            onSelectVessel={(vesselId) => vesselId && selectVesselFromVisualization(vesselId)}
            popoutProfile={isPlanCentric ? 'plan' : 'legacy'}
            onKpiOpen={handleSchematicKpiOpen}
            exportRootRef={isPlanCentric ? schematicExportRef : undefined}
            exportMenu={
              isPlanCentric ? (
                <AllocationPlanExportMenu
                  exporting={planExporting}
                  onExport={handleAllocationPlanExport}
                />
              ) : null
            }
          />
        </div>
        <div
          id="allocation-panel-jetty-schedule"
          role="tabpanel"
          aria-labelledby="allocation-tab-jetty-schedule"
          hidden={visualTab !== 'jettySchedule'}
          className="allocation-tabpanel"
        >
          <JettyScheduleGantt
            berthIds={berthIds}
            berthsState={berthsState}
            list={planViz.mergedSchedule}
            onSelectVessel={(vesselId) => vesselId && selectVesselFromVisualization(vesselId)}
            onScheduleChanged={refreshOverview}
            popoutProfile={isPlanCentric ? 'plan' : 'legacy'}
          />
        </div>
      </div>

      {/* Active Vessel Detail modal (opens when user clicks an occupied ship block) */}
      {vesselDetailModalVesselId && (
        <div
          className="modal-overlay"
          onClick={() => closeVesselDetailModal()}
          aria-hidden="true"
        >
          <div
            className="modal modal--wide"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-labelledby="vessel-detail-modal-title"
            aria-modal="true"
          >
            <h2 id="vessel-detail-modal-title" className="modal__title">
              {isPlanCentric && vesselDetailPlanId != null ? (
                <span>
                  {tAlloc('planModalTitleWithVessel', {
                    defaultValue: 'Active vessel - {{name}}',
                    name: getVesselName(vesselDetailModalVesselId) || '—',
                  })}
                </span>
              ) : (
                <>
                  ⚓ {tAlloc('activeVesselDetailTitle', { defaultValue: 'Active Vessel Detail' })}:{' '}
                  {getVesselName(vesselDetailModalVesselId)}
                </>
              )}
            </h2>
            {(() => {
              const vesselRow = vesselDetailRows.find((r) => r.vesselId === vesselDetailModalVesselId)
              const vessel = vesselRow || null
              const phases = UNIFIED_PHASES
              const currentPhaseIndex = deriveCurrentPhaseIndex(vessel)
              const currentPhaseLabel = currentPhaseLabelForVessel(vessel, phases)
              const readyToSail = isVesselReadyToSail(vessel)
              const hasSailed = isVesselSailed(vessel)
              const formatModalDateTime = (val) => {
                if (val == null || val === '') return '—'
                return formatDateTimeDisplay(val)
              }
              const eta = formatModalDateTime(vessel?.etaDateTime)
              const ta = formatModalDateTime(vessel?.taDateTime)
              const etb = formatModalDateTime(vessel?.etbDateTime)
              const pob = formatModalDateTime(vessel?.pobDateTime)
              const tb = formatModalDateTime(vessel?.tbDateTime)
              const sob = formatModalDateTime(vessel?.sobDateTime)
              const norTendered = formatModalDateTime(vessel?.norTenderedDateTime)
              const norAccepted = formatModalDateTime(vessel?.norAcceptedDateTime)
              const demurrageFrom = formatModalDateTime(vessel?.demurrageLiabilityFromDateTime)
              const estCompletion = formatModalDateTime(vessel?.estimatedCompletionDateTime)
              const operationsCompleted = formatModalDateTime(vessel?.operationsCompletedDateTime)
              const actualCompletion = formatModalDateTime(vessel?.actualCompletionDateTime)
              const tbMs = parseDateMs(vessel?.tbDateTime)
              const estCompMs = parseDateMs(vessel?.estimatedCompletionDateTime)
              const opsCompMs = parseDateMs(vessel?.operationsCompletedDateTime)
              const nowMs = Date.now()
              const isPlanDetailMode = Boolean(isPlanCentric && vesselDetailPlanId != null)
              const planTbEffective = planDetail?.tb ?? planDetail?.dockingStartTime
              const planEta = formatModalDateTime(planDetail?.eta)
              const planTa = formatModalDateTime(planDetail?.ta)
              const planEtb = formatModalDateTime(planDetail?.etb)
              const planTb = formatModalDateTime(planTbEffective)
              const planEstCompletion = formatModalDateTime(planDetail?.estimatedCompletionTime)
              const planOpsCompleted = formatModalDateTime(planDetail?.operationsCompletedAt)
              const planTbMs = parseDateMs(planTbEffective)
              const planEstCompMs = parseDateMs(planDetail?.estimatedCompletionTime)
              const planOpsCompMs = parseDateMs(planDetail?.operationsCompletedAt)
              const planAlongsideEndMs = getPlanAlongsideEndMs(planDetail, vessel, nowMs)
              const planTimeSinceBerthing =
                planTbMs != null
                  ? formatDuration(Math.max(0, planAlongsideEndMs - planTbMs))
                  : '—'
              const planSailed = isPlanOrVesselSailed(planDetail, vessel)
              const planEstTimeRemaining = planSailed
                ? tAlloc('planModalSailed', { defaultValue: 'Sailed' })
                : planOpsCompMs != null
                  ? tAlloc('planModalCompleted', { defaultValue: 'Completed' })
                  : planEstCompMs != null
                    ? planEstCompMs > nowMs
                      ? formatDuration(planEstCompMs - nowMs)
                      : tAlloc('planModalOverdue', { defaultValue: 'Overdue' })
                    : '—'
              const vesselAlongsideEndMs = getVesselAlongsideEndMs(vessel, nowMs)
              const timeSinceBerthing =
                tbMs != null ? formatDuration(Math.max(0, vesselAlongsideEndMs - tbMs)) : '—'
              const estTimeRemaining = hasSailed
                ? tAlloc('planModalSailed', { defaultValue: 'Sailed' })
                : opsCompMs != null
                  ? tAlloc('planModalCompleted', { defaultValue: 'Completed' })
                  : estCompMs != null
                    ? estCompMs > nowMs
                      ? formatDuration(estCompMs - nowMs)
                      : 'Overdue'
                    : '—'
              const canVesselDetailEdit = Boolean(canEditAllocation && vessel?.operationId)
              const d = vesselDetailDraft
              const lastUpdatedText = formatVesselRecordLastUpdatedLine(vessel)
              const existingBerthPhotos = vesselPhotosByVesselId[vesselDetailModalVesselId] || []
              return (
                <>
                <div className="vessel-detail-modal__body">
                  <section className="berthing-modal__card berthing-modal__card--vessel">
                    <h3 className="berthing-modal__card-title">Vessel info</h3>
                    <dl className="berthing-modal__vessel-dl">
                      <div className="berthing-modal__vessel-row">
                        <dt>Vessel name</dt>
                        <dd className="berthing-modal__vessel-dl--bold">{vessel?.vesselName || '—'}</dd>
                      </div>
                      <div className="berthing-modal__vessel-row">
                        <dt>SI No</dt>
                        <dd className="berthing-modal__vessel-dl--bold">{vessel?.shippingInstruction || '—'}</dd>
                      </div>
                      <div className="berthing-modal__vessel-row">
                        <dt>{tAlloc('dtJettyOperationId', { defaultValue: 'Jetty Operation ID' })}</dt>
                        <dd className="berthing-modal__vessel-dl--bold">
                          {vessel?.shippingInstructionId ? (
                            <a
                              href="#"
                              onClick={(e) => {
                                e.preventDefault()
                                openSiDetailModal(vessel.shippingInstructionId)
                              }}
                              aria-label={tAlloc('openSiDetailFromJettyOp')}
                            >
                              {vessel?.jettyOperationCode || '—'}
                            </a>
                          ) : (
                            vessel?.jettyOperationCode || '—'
                          )}
                        </dd>
                      </div>
                      <div className="berthing-modal__vessel-row">
                        <dt>Purpose</dt>
                        <dd>
                          <PurposeBadge purpose={vessel?.purpose} loadDischarge={vessel?.loadDischarge} />
                        </dd>
                      </div>
                      <div className="berthing-modal__vessel-row">
                        <dt>Commodity</dt>
                        <dd>{vessel?.commodity || '—'}</dd>
                      </div>
                    </dl>
                  </section>

                  <section className="berthing-modal__card">
                    <h3 className="berthing-modal__card-title">Vessel pipeline</h3>
                    <p className="phase-stepper__current-text">Current: {currentPhaseLabel}</p>
                    <p className="phase-stepper__hint" aria-label="Phase status legend">
                      <span className="phase-stepper__hint-item phase-stepper__hint-item--completed">Done</span>
                      <span className="phase-stepper__hint-item phase-stepper__hint-item--in-progress">In progress</span>
                      <span className="phase-stepper__hint-item phase-stepper__hint-item--not-started">Not started</span>
                    </p>
                    <div className="phase-stepper" role="list" aria-label="Current phase steps">
                      {phases.map((label, index) => {
                        const isCompleted = index < currentPhaseIndex
                        const isCurrent = index === currentPhaseIndex
                        const state = isCompleted ? 'completed' : isCurrent ? 'in-progress' : 'not-started'
                        const isClearance = label === 'Clearance'
                        const to = label === 'Shipping Instruction' ? null : getPhaseLink(label, vessel)
                        const disabled =
                          // At-Berth deep link requires an operation id.
                          (label === 'At-Berth' && !vessel?.operationId) ||
                          // Clearance should not be clickable until ready to sail.
                          (isClearance && !readyToSail && !hasSailed) ||
                          // If we couldn't resolve a route, disable.
                          !to
                        const content = label === 'Shipping Instruction' ? (
                          <button
                            type="button"
                            className="phase-stepper__step-label phase-stepper__step-label--link phase-stepper__step-label--btn"
                            onClick={() => {
                              if (!vessel?.shippingInstructionId) return
                              openSiDocumentModal(vessel.shippingInstructionId)
                            }}
                            disabled={!vessel?.shippingInstructionId}
                            title={vessel?.shippingInstructionId ? 'Open shipping instruction document' : 'Shipping instruction not available'}
                          >
                            {label}
                          </button>
                        ) : label === 'At-Berth' || label === 'Clearance' ? (
                          <button
                            type="button"
                            className={`phase-stepper__step-label phase-stepper__step-label--link phase-stepper__step-label--btn${disabled ? ' disabled' : ''}`}
                            disabled={disabled}
                            title={disabled ? undefined : `Open ${label} activity in a popup`}
                            onClick={() => {
                              if (!disabled && to) setPipelineEmbed({ url: to, label })
                            }}
                          >
                            {label}
                          </button>
                        ) : (
                          <Link
                            to={disabled ? '#' : to}
                            className={`phase-stepper__step-label phase-stepper__step-label--link${disabled ? ' disabled' : ''}`}
                            aria-disabled={disabled}
                            onClick={(e) => {
                              if (disabled) e.preventDefault()
                            }}
                          >
                            {label}
                          </Link>
                        )
                        return (
                          <Fragment key={index}>
                            <div
                              className={`phase-stepper__step phase-stepper__step--${state}`}
                              role="listitem"
                              aria-current={isCurrent ? 'step' : undefined}
                            >
                              <span className="phase-stepper__circle" aria-hidden="true" />
                              {isCurrent && <span className="phase-stepper__current-mark" aria-hidden="true">●</span>}
                              {content}
                            </div>
                            {index < phases.length - 1 && (
                              <span
                                className={`phase-stepper__connector${index < currentPhaseIndex ? ' phase-stepper__connector--completed' : ''}${index === currentPhaseIndex ? ' phase-stepper__connector--current' : ''}`}
                                aria-hidden="true"
                              >
                                →
                              </span>
                            )}
                          </Fragment>
                        )
                      })}
                    </div>
                  </section>

                  {isPlanDetailMode ? (
                    <>
                      <section className="berthing-modal__card">
                        <h3 className="berthing-modal__card-title">
                          {tAlloc('planModalSiSection', { defaultValue: 'Shipping instructions on this plan' })}
                        </h3>
                        {vesselDetailPlanQueueRows.length === 0 ? (
                          <p className="text-steel">{tAlloc('planModalSiEmpty', { defaultValue: 'No queue rows for this plan in the current overview.' })}</p>
                        ) : (
                          <div className="table-wrap">
                            <table className="data-table vessel-detail-modal__si-table">
                              <thead>
                                <tr>
                                  <th>{tAlloc('colShippingInstruction')}</th>
                                  <th>{tAlloc('colJettyOperationId')}</th>
                                  <th>{tAlloc('colBerthingSequence')}</th>
                                  <th>{tAlloc('planModalColStatus', { defaultValue: 'Status' })}</th>
                                  <th>{tAlloc('colJetty')}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {vesselDetailPlanQueueRows.map((row) => (
                                  <tr key={row.vesselId || row.id}>
                                    <td>
                                      {row.shippingInstructionId ? (
                                        <a
                                          href="#"
                                          className="link"
                                          onClick={(e) => {
                                            e.preventDefault()
                                            openSiDocumentModal(row.shippingInstructionId)
                                          }}
                                        >
                                          {row.shippingInstruction || '—'}
                                        </a>
                                      ) : (
                                        row.shippingInstruction || '—'
                                      )}
                                    </td>
                                    <td>
                                      {row.shippingInstructionId ? (
                                        <a
                                          href="#"
                                          className="link"
                                          onClick={(e) => {
                                            e.preventDefault()
                                            openSiDetailModal(row.shippingInstructionId)
                                          }}
                                        >
                                          {row.jettyOperationCode || '—'}
                                        </a>
                                      ) : (
                                        row.jettyOperationCode || '—'
                                      )}
                                    </td>
                                    <td>—</td>
                                    <td>{row.status || '—'}</td>
                                    <td>{row.jetty || '—'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </section>
                      <section className="berthing-modal__card berthing-modal__card--vessel">
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                          <h3 className="berthing-modal__card-title" style={{ marginBottom: 0 }}>
                            {tAlloc('planModalPlanTimesSection', { defaultValue: 'Time & status (shipment plan)' })}
                          </h3>
                          {canEditAllocation && !planDetailLoading && planDetail ? (
                            planTimesEdit ? (
                              <span style={{ display: 'inline-flex', gap: 6 }}>
                                <button
                                  type="button"
                                  className="btn btn--small btn--secondary"
                                  onClick={() => {
                                    setPlanTimesEdit(null)
                                    setPlanTimesMsg(null)
                                  }}
                                  disabled={planTimesSaving}
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  className="btn btn--small btn--primary"
                                  onClick={() => savePlanTimes(vessel)}
                                  disabled={planTimesSaving}
                                >
                                  {planTimesSaving ? 'Saving…' : 'Save times'}
                                </button>
                              </span>
                            ) : (
                              <button
                                type="button"
                                className="btn btn--small btn--secondary"
                                onClick={() =>
                                  setPlanTimesEdit({
                                    eta: toDateTimeLocalValue(planDetail?.eta) || '',
                                    ta: toDateTimeLocalValue(planDetail?.ta) || '',
                                    etb: toDateTimeLocalValue(planDetail?.etb) || '',
                                    tb: toDateTimeLocalValue(planDetail?.tb ?? planDetail?.dockingStartTime) || '',
                                    etc: toDateTimeLocalValue(planDetail?.estimatedCompletionTime) || '',
                                    act: toDateTimeLocalValue(planDetail?.actualCompletionTime) || '',
                                  })
                                }
                              >
                                Edit times
                              </button>
                            )
                          ) : null}
                        </div>
                        {planTimesMsg ? (
                          <p className="allocation-arrival-save-msg allocation-arrival-save-msg--error" role="alert">
                            {planTimesMsg}
                          </p>
                        ) : null}
                        {planTimesEdit && !(vessel?.operationId || vessel?.shippingInstructionId) ? (
                          <p className="text-steel" style={{ fontSize: '0.8rem', margin: '4px 0' }}>
                            {tAlloc('planTimesPlanOnlyHint', {
                              defaultValue:
                                'Plan has no operation yet — only ETA and ETB can be updated here (actuals are set at berthing).',
                            })}
                          </p>
                        ) : null}
                        {planDetailLoading ? (
                          <p className="text-steel">{tAlloc('planModalPlanTimesLoading', { defaultValue: 'Loading plan times…' })}</p>
                        ) : planDetailError ? (
                          <p className="allocation-arrival-save-msg allocation-arrival-save-msg--error" role="alert">
                            {tAlloc('planModalPlanTimesError', {
                              defaultValue: 'Could not load plan times: {{message}}',
                              message: planDetailError,
                            })}
                          </p>
                        ) : (
                          <dl className="berthing-modal__vessel-dl">
                            <div className="berthing-modal__vessel-row">
                              <dt title={tAlloc('ttPlanEta')}>{tAlloc('planModalLblEta', { defaultValue: 'Estimated Time of Arrival (ETA)' })}</dt>
                              <dd>{planTimesEdit ? (
                                <input type="datetime-local" className="berthing-modal__input" value={planTimesEdit.eta} onChange={(e) => setPlanTimesEdit((f) => ({ ...f, eta: e.target.value }))} />
                              ) : (
                                planEta
                              )}</dd>
                            </div>
                            <div className="berthing-modal__vessel-row">
                              <dt title={tAlloc('ttPlanTa')}>{tAlloc('planModalLblTa', { defaultValue: 'Actual Time of Arrival (TA)' })}</dt>
                              <dd>{planTimesEdit && (vessel?.operationId || vessel?.shippingInstructionId) ? (
                                <input type="datetime-local" className="berthing-modal__input" value={planTimesEdit.ta} onChange={(e) => setPlanTimesEdit((f) => ({ ...f, ta: e.target.value }))} />
                              ) : (
                                planTa
                              )}</dd>
                            </div>
                            <div className="berthing-modal__vessel-row">
                              <dt title={tAlloc('ttPlanEtb')}>{tAlloc('planModalLblEtb', { defaultValue: 'Estimated Time of Berthing (ETB)' })}</dt>
                              <dd>{planTimesEdit ? (
                                <input type="datetime-local" className="berthing-modal__input" value={planTimesEdit.etb} onChange={(e) => setPlanTimesEdit((f) => ({ ...f, etb: e.target.value }))} />
                              ) : (
                                planEtb
                              )}</dd>
                            </div>
                            <div className="berthing-modal__vessel-row">
                              <dt title={tAlloc('ttPlanTb')}>{tAlloc('planModalLblTb', { defaultValue: 'Actual Time of Berthing (TB)' })}</dt>
                              <dd>{planTimesEdit && (vessel?.operationId || vessel?.shippingInstructionId) ? (
                                <input type="datetime-local" className="berthing-modal__input" value={planTimesEdit.tb} onChange={(e) => setPlanTimesEdit((f) => ({ ...f, tb: e.target.value }))} />
                              ) : (
                                planTb
                              )}</dd>
                            </div>
                            <div className="berthing-modal__vessel-row">
                              <dt title={tAlloc('ttPlanTimeSince')}>{tAlloc('planModalLblTimeSinceBerth', { defaultValue: 'Time Since Berthing' })}</dt>
                              <dd>{planTimeSinceBerthing}</dd>
                            </div>
                            <div className="berthing-modal__vessel-row">
                              <dt title={tAlloc('ttPlanEstCompletion')}>{tAlloc('planModalLblEstCompletion', { defaultValue: 'Est. Completion' })}</dt>
                              <dd>{planTimesEdit && (vessel?.operationId || vessel?.shippingInstructionId) ? (
                                <input type="datetime-local" className="berthing-modal__input" value={planTimesEdit.etc} onChange={(e) => setPlanTimesEdit((f) => ({ ...f, etc: e.target.value }))} />
                              ) : (
                                planEstCompletion
                              )}</dd>
                            </div>
                            <div className="berthing-modal__vessel-row">
                              <dt>{tAlloc('operationsCompleted')}</dt>
                              <dd>{planOpsCompleted || '—'}</dd>
                            </div>
                            <div className="berthing-modal__vessel-row">
                              <dt>{tAlloc('actualCompletion')}</dt>
                              <dd>{planTimesEdit && (vessel?.operationId || vessel?.shippingInstructionId) ? (
                                <input type="datetime-local" className="berthing-modal__input" value={planTimesEdit.act} onChange={(e) => setPlanTimesEdit((f) => ({ ...f, act: e.target.value }))} />
                              ) : (
                                formatModalDateTime(planDetail?.actualCompletionTime) || '—'
                              )}</dd>
                            </div>
                            <div className="berthing-modal__vessel-row">
                              <dt title={tAlloc('ttPlanEstRemaining')}>{tAlloc('planModalLblEstRemaining', { defaultValue: 'Est. Time Remaining' })}</dt>
                              <dd>{planEstTimeRemaining}</dd>
                            </div>
                          </dl>
                        )}
                      </section>
                      <p className="text-steel" style={{ fontSize: '0.9rem', margin: '0 0 0.75rem' }}>
                        {tAlloc('planModalRepresentativeOpsHint', {
                          defaultValue:
                            'Edit, NOR, operation times, documents, and berthing photos in the sections below follow the primary operation on this plan.',
                        })}
                      </p>
                    </>
                  ) : null}

                  <div className="vessel-detail-modal__meta-row" aria-live="polite">
                    <p
                      className="vessel-detail-modal__last-updated"
                      title={lastUpdatedText ? undefined : 'Shows when the operation (or SI) row was last saved. Run DB migration 044 and redeploy the API to include “by name” after edits.'}
                    >
                      {lastUpdatedText || 'Last updated —'}
                    </p>
                    {canVesselDetailEdit && !vesselDetailEditing ? (
                      <button
                        type="button"
                        className="vessel-detail-modal__icon-btn"
                        title="Edit"
                        aria-label="Edit"
                        onClick={() => openVesselDetailEdit(vessel)}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </button>
                    ) : null}
                  </div>
                  {vesselDetailEditing ? (
                    <p className="vessel-detail-modal__edit-hint">
                      Changes apply to calculated fields (e.g. time since berthing) after saving.
                    </p>
                  ) : null}
                  {vesselDetailEditing && vesselDetailEditError ? (
                    <p className="allocation-arrival-save-msg allocation-arrival-save-msg--error" role="alert">
                      {vesselDetailEditError}
                    </p>
                  ) : null}

                  {(!isPlanDetailMode || vesselDetailEditing) && (
                  <section className="berthing-modal__card berthing-modal__card--vessel">
                    <h3 className="berthing-modal__card-title">Times &amp; status</h3>
                    {vesselDetailEditing && d ? (
                      <div className="vessel-detail-modal__times-extras">
                        <div className="berthing-modal__field">
                          <label htmlFor="vessel-detail-priority" className="berthing-modal__label">Priority</label>
                          <select
                            id="vessel-detail-priority"
                            className="berthing-modal__input"
                            value={d.priority || ''}
                            onChange={(e) =>
                              setVesselDetailDraft((prev) => (prev ? { ...prev, priority: e.target.value } : prev))
                            }
                          >
                            <option value="">—</option>
                            {PRIORITY_OPTIONS.map((p) => (
                              <option key={p} value={p}>{p}</option>
                            ))}
                          </select>
                        </div>
                        <div className="berthing-modal__field">
                          <label htmlFor="vessel-detail-jetty" className="berthing-modal__label">Jetty</label>
                          <select
                            id="vessel-detail-jetty"
                            className="berthing-modal__input"
                            value={d.jetty || ''}
                            onChange={(e) =>
                              setVesselDetailDraft((prev) => (prev ? { ...prev, jetty: e.target.value } : prev))
                            }
                          >
                            <option value="">— Select jetty —</option>
                            {berthIds.map((jid) => {
                              const b = berthsState.find((bb) => bb.id === jid)
                              const cap = b?.capacity != null ? Number(b.capacity) : 1
                              const occList =
                                Array.isArray(b?.occupants) ? b.occupants : b?.currentVesselId ? [{ vesselId: b.currentVesselId }] : []
                              const occCount = occList.length
                              const label =
                                occCount > 0
                                  ? `${jid} – Occupied (${occCount}/${Math.max(1, cap)})`
                                  : `${jid} – Vacant (0/${Math.max(1, cap)})`
                              return (
                                <option key={jid} value={jid}>
                                  {label}
                                </option>
                              )
                            })}
                          </select>
                        </div>
                      </div>
                    ) : null}
                    <dl className="berthing-modal__vessel-dl">
                      <div className="berthing-modal__vessel-row">
                        <dt>Estimated Time of Arrival (ETA)</dt>
                        <dd>
                          {vesselDetailEditing && d ? (
                            <input
                              type="datetime-local"
                              className="berthing-modal__input"
                              value={d.etaDateTime}
                              onChange={(e) =>
                                setVesselDetailDraft((prev) => (prev ? { ...prev, etaDateTime: e.target.value } : prev))
                              }
                              aria-label="Estimated Time of Arrival"
                            />
                          ) : (
                            eta
                          )}
                        </dd>
                      </div>
                      <div className="berthing-modal__vessel-row">
                        <dt>Actual Time of Arrival (TA)</dt>
                        <dd>
                          {vesselDetailEditing && d ? (
                            <input
                              type="datetime-local"
                              className="berthing-modal__input"
                              value={d.taDateTime}
                              onChange={(e) =>
                                setVesselDetailDraft((prev) => (prev ? { ...prev, taDateTime: e.target.value } : prev))
                              }
                              aria-label="Actual Time of Arrival"
                            />
                          ) : (
                            ta
                          )}
                        </dd>
                      </div>
                      <div className="berthing-modal__vessel-row">
                        <dt>
                          Estimated Time of Berthing (ETB)
                          {vesselDetailEditing && isEtbRequiredForVesselDetailDraft(d) ? (
                            <span className="required-star"> *</span>
                          ) : null}
                        </dt>
                        <dd>
                          {vesselDetailEditing && d ? (
                            <>
                              <input
                                type="datetime-local"
                                className="berthing-modal__input"
                                value={d.etbDateTime}
                                onChange={(e) =>
                                  setVesselDetailDraft((prev) => (prev ? { ...prev, etbDateTime: e.target.value } : prev))
                                }
                                aria-label="Estimated Time of Berthing"
                                aria-required={isEtbRequiredForVesselDetailDraft(d) || undefined}
                              />
                              {isEtbRequiredForVesselDetailDraft(d) && !d.etbDateTime ? (
                                <p className="berthing-modal__jetty-hint berthing-modal__jetty-hint--error" role="alert">
                                  Required when assigning a jetty.
                                </p>
                              ) : null}
                            </>
                          ) : (
                            etb
                          )}
                        </dd>
                      </div>
                      <div className="berthing-modal__vessel-row">
                        <dt>Actual Time of Berthing (TB)</dt>
                        <dd>
                          {vesselDetailEditing && d ? (
                            <input
                              type="datetime-local"
                              className="berthing-modal__input"
                              value={d.tbDateTime}
                              onChange={(e) =>
                                setVesselDetailDraft((prev) => (prev ? { ...prev, tbDateTime: e.target.value } : prev))
                              }
                              aria-label="Actual Time of Berthing"
                            />
                          ) : (
                            tb
                          )}
                        </dd>
                      </div>
                      <div className="berthing-modal__vessel-row">
                        <dt>Pilot on Board (POB)</dt>
                        <dd>
                          {vesselDetailEditing && d ? (
                            <input
                              type="datetime-local"
                              className="berthing-modal__input"
                              value={d.pobDateTime}
                              onChange={(e) =>
                                setVesselDetailDraft((prev) => (prev ? { ...prev, pobDateTime: e.target.value } : prev))
                              }
                              aria-label="Pilot on Board"
                            />
                          ) : (
                            pob
                          )}
                        </dd>
                      </div>
                      <div className="berthing-modal__vessel-row">
                        <dt>Surveyor on Board (SOB)</dt>
                        <dd>
                          {vesselDetailEditing && d ? (
                            <input
                              type="datetime-local"
                              className="berthing-modal__input"
                              value={d.sobDateTime}
                              onChange={(e) =>
                                setVesselDetailDraft((prev) => (prev ? { ...prev, sobDateTime: e.target.value } : prev))
                              }
                              aria-label="Surveyor on Board"
                            />
                          ) : (
                            sob
                          )}
                        </dd>
                      </div>
                      <div className="berthing-modal__vessel-row">
                        <dt>Time Since Berthing</dt>
                        <dd>{timeSinceBerthing}</dd>
                      </div>
                      <div className="berthing-modal__vessel-row">
                        <dt>Est. Completion</dt>
                        <dd>
                          {vesselDetailEditing && d ? (
                            <input
                              type="datetime-local"
                              className="berthing-modal__input"
                              value={d.estimatedCompletionDateTime}
                              onChange={(e) =>
                                setVesselDetailDraft((prev) =>
                                  prev ? { ...prev, estimatedCompletionDateTime: e.target.value } : prev
                                )
                              }
                              aria-label="Estimated completion"
                            />
                          ) : (
                            estCompletion
                          )}
                        </dd>
                      </div>
                      <div className="berthing-modal__vessel-row">
                        <dt>{tAlloc('operationsCompleted')}</dt>
                        <dd>{operationsCompleted || '—'}</dd>
                      </div>
                      <div className="berthing-modal__vessel-row">
                        <dt>{tAlloc('actualCompletion')}</dt>
                        <dd>{actualCompletion || '—'}</dd>
                      </div>
                      <div className="berthing-modal__vessel-row">
                        <dt>Est. Time Remaining</dt>
                        <dd>{estTimeRemaining}</dd>
                      </div>
                    </dl>
                  </section>
                  )}

                  <section className="berthing-modal__card">
                    <h3 className="berthing-modal__card-title">Arrival documents</h3>
                    {vesselDetailEditing && d ? (
                      <div className="berthing-modal__form-section">
                        <div className="berthing-modal__field">
                          <label htmlFor="vessel-detail-no-pkk" className="berthing-modal__label">No PKK</label>
                          <input
                            id="vessel-detail-no-pkk"
                            type="text"
                            className="berthing-modal__input"
                            value={d.noPkk ?? ''}
                            onChange={(e) =>
                              setVesselDetailDraft((prev) => (prev ? { ...prev, noPkk: e.target.value } : prev))
                            }
                            placeholder="e.g. PKK-2026-001"
                          />
                        </div>
                        <div className="berthing-modal__field">
                          <label htmlFor="vessel-detail-nor-doc" className="berthing-modal__label">Notice of Readiness</label>
                          {Array.isArray(vessel?.norDocuments) && vessel.norDocuments.length > 0 ? (
                            <ul
                              className="berthing-modal__file-list"
                              style={{ marginTop: 'var(--spacing-1)', fontSize: 'var(--font-size-small)' }}
                            >
                              {vessel.norDocuments.map((doc) => (
                                <li key={doc.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <FilePreviewLink
                                    url={fileUrl(doc.url)}
                                    name={doc.name || 'NOR document'}
                                    mimeType={doc.mimeType ?? null}
                                    className="file-preview-link"
                                  />
                                  <button
                                    type="button"
                                    className="berthing-modal__nor-delete-btn"
                                    title="Delete NOR document"
                                    aria-label={`Delete NOR document: ${doc.name || 'document'}`}
                                    onClick={async () => {
                                      if (!window.confirm('Delete this NOR document?')) return
                                      try {
                                        await deleteOperationDocument(doc.id)
                                        await refreshOverview()
                                      } catch (err) {
                                        setVesselDetailEditError(err?.message || 'Delete failed')
                                      }
                                    }}
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                      <path d="M3 6h18" />
                                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                                      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                      <line x1="10" x2="10" y1="11" y2="17" />
                                      <line x1="14" x2="14" y1="11" y2="17" />
                                    </svg>
                                  </button>
                                </li>
                              ))}
                            </ul>
                          ) : null}
                          <label className="berthing-modal__file-zone" htmlFor="vessel-detail-nor-doc">
                            <span className="berthing-modal__file-zone-text">
                              {vesselDetailNorNewFiles.length > 0
                                ? `${vesselDetailNorNewFiles.length} new file(s) chosen`
                                : 'Choose NOR document'}
                            </span>
                            <input
                              id="vessel-detail-nor-doc"
                              type="file"
                              accept=".pdf,image/*"
                              multiple
                              onChange={(e) => addVesselDetailNorNewFiles(e.target.files)}
                              className="berthing-modal__file-input"
                            />
                          </label>
                          {vesselDetailNorNewFiles.length > 0 ? (
                            <ul className="berthing-modal__file-list" style={{ marginTop: 'var(--spacing-1)', fontSize: 'var(--font-size-small)', color: 'var(--color-text-steel)' }}>
                              {vesselDetailNorNewFiles.map((f, i) => (
                                <li key={i}>{f.name}</li>
                              ))}
                            </ul>
                          ) : null}
                        </div>
                        <div className="berthing-modal__field">
                          <label htmlFor="vessel-detail-nor-tendered" className="berthing-modal__label">NOR Tendered Date &amp; Time</label>
                          <input
                            id="vessel-detail-nor-tendered"
                            type="datetime-local"
                            className="berthing-modal__input"
                            value={d.norTenderedDateTime || ''}
                            onChange={(e) =>
                              setVesselDetailDraft((prev) =>
                                prev ? { ...prev, norTenderedDateTime: e.target.value } : prev
                              )
                            }
                          />
                        </div>
                        <div className="berthing-modal__field">
                          <label htmlFor="vessel-detail-nor-accepted" className="berthing-modal__label">NOR Accepted Date &amp; Time</label>
                          <input
                            id="vessel-detail-nor-accepted"
                            type="datetime-local"
                            className="berthing-modal__input"
                            value={d.norAcceptedDateTime || ''}
                            onChange={(e) =>
                              setVesselDetailDraft((prev) =>
                                prev ? { ...prev, norAcceptedDateTime: e.target.value } : prev
                              )
                            }
                          />
                        </div>
                        <div className="berthing-modal__field">
                          <label htmlFor="vessel-detail-demurrage" className="berthing-modal__label">Demurrage liability from</label>
                          <input
                            id="vessel-detail-demurrage"
                            type="datetime-local"
                            className="berthing-modal__input"
                            value={d.demurrageLiabilityFromDateTime || ''}
                            onChange={(e) =>
                              setVesselDetailDraft((prev) =>
                                prev ? { ...prev, demurrageLiabilityFromDateTime: e.target.value } : prev
                              )
                            }
                          />
                        </div>
                      </div>
                    ) : (
                      <dl className="berthing-modal__vessel-dl">
                        <div className="berthing-modal__vessel-row">
                          <dt>No PKK</dt>
                          <dd className="berthing-modal__vessel-dl--bold">{vessel?.noPkk || '—'}</dd>
                        </div>
                        <div className="berthing-modal__vessel-row">
                          <dt>Notice of Readiness (NOR)</dt>
                          <dd>
                            {Array.isArray(vessel?.norDocuments) && vessel.norDocuments.length > 0 ? (
                              <ul className="berthing-modal__docs-list">
                                {vessel.norDocuments.map((doc) => (
                                  <li key={doc.id || doc.url || doc.name}>
                                    <FilePreviewLink
                                      url={fileUrl(doc.url)}
                                      name={doc.name || 'NOR document'}
                                      mimeType={doc.mimeType ?? null}
                                      className="berthing-modal__doc-link file-preview-link"
                                    />
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              '—'
                            )}
                          </dd>
                        </div>
                        <div className="berthing-modal__vessel-row">
                          <dt>NOR Tendered Date &amp; Time</dt>
                          <dd>{norTendered}</dd>
                        </div>
                        <div className="berthing-modal__vessel-row">
                          <dt>NOR Accepted Date &amp; Time</dt>
                          <dd>{norAccepted}</dd>
                        </div>
                        <div className="berthing-modal__vessel-row">
                          <dt>Demurrage liability from</dt>
                          <dd>{demurrageFrom}</dd>
                        </div>
                      </dl>
                    )}
                  </section>

                  {(vesselDetailEditing || existingBerthPhotos.length > 0) && (
                    <section className="berthing-modal__card">
                      <h3 className="berthing-modal__card-title">Berthing details (vessel photo)</h3>
                      {existingBerthPhotos.length > 0 ? (
                        <ul className="vessel-detail-modal__photos">
                          {existingBerthPhotos.map((photo, i) => (
                            <li key={i} className="vessel-detail-modal__photo-item">
                              <AuthenticatedFileImage
                                url={photo.url}
                                alt={photo.name || 'Vessel'}
                                className="vessel-detail-modal__photo-img vessel-detail-modal__photo-img--clickable"
                                role="button"
                                tabIndex={0}
                                onClick={() =>
                                  openFilePreview({
                                    url: photo.url,
                                    name: photo.name || 'Vessel photo',
                                    mimeType: photo.mimeType || 'image/jpeg',
                                  })
                                }
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault()
                                    openFilePreview({
                                      url: photo.url,
                                      name: photo.name || 'Vessel photo',
                                      mimeType: photo.mimeType || 'image/jpeg',
                                    })
                                  }
                                }}
                              />
                              {photo.name ? <span className="vessel-detail-modal__photo-caption">{photo.name}</span> : null}
                            </li>
                          ))}
                        </ul>
                      ) : vesselDetailEditing ? (
                        <p className="berthing-modal__empty" style={{ marginTop: 0 }}>No vessel photos yet.</p>
                      ) : null}
                      {vesselDetailEditing ? (
                        <div className="berthing-modal__form-section" style={{ marginTop: 'var(--spacing-3)' }}>
                          <label className="berthing-modal__label">Add vessel photos (optional)</label>
                          <label htmlFor="vessel-detail-berthing-photos" className="berthing-modal__file-zone">
                            <span className="berthing-modal__file-zone-text">
                              {vesselDetailBerthingNewPhotos.length > 0
                                ? `${vesselDetailBerthingNewPhotos.length} new file(s) chosen`
                                : 'Choose files or drop here'}
                            </span>
                            <input
                              id="vessel-detail-berthing-photos"
                              type="file"
                              accept="image/*"
                              multiple
                              onChange={addVesselDetailBerthingNewPhotos}
                              className="berthing-modal__file-input"
                              aria-label="Upload vessel photos"
                            />
                          </label>
                          {vesselDetailBerthingNewPhotos.length > 0 ? (
                            <ul className="berthing-modal__photo-list" aria-label="New vessel photos">
                              {vesselDetailBerthingNewPhotos.map((p) => (
                                <li key={p.id} className="berthing-modal__photo-item">
                                  <img
                                    src={p.previewUrl}
                                    alt={p.file.name}
                                    className="berthing-modal__photo-thumb berthing-modal__photo-preview--clickable"
                                    role="button"
                                    tabIndex={0}
                                    onClick={() =>
                                      openFilePreview({
                                        url: p.previewUrl,
                                        name: p.file.name,
                                        mimeType: p.file.type || 'image/jpeg',
                                      })
                                    }
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault()
                                        openFilePreview({
                                          url: p.previewUrl,
                                          name: p.file.name,
                                          mimeType: p.file.type || 'image/jpeg',
                                        })
                                      }
                                    }}
                                  />
                                  <span className="berthing-modal__photo-name" title={p.file.name}>{p.file.name}</span>
                                  <button
                                    type="button"
                                    className="btn btn--small berthing-modal__photo-remove"
                                    onClick={() => removeVesselDetailBerthingNewPhoto(p.id)}
                                    aria-label={`Remove ${p.file.name}`}
                                  >
                                    Remove
                                  </button>
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </div>
                      ) : null}
                    </section>
                  )}

                  {vessel?.operationId ? (
                    <OperationalProgressSection
                      operationId={vessel.operationId}
                      totalQtyDisplay={vessel.totalQtyDisplay ?? null}
                      vesselId={vesselDetailModalVesselId}
                      basePath={
                        String(vessel?.purpose || '').trim() === 'Unloading' ? '/unloading' : '/loading'
                      }
                      scheduleTimezone={selectedPort?.scheduleTimezone ?? 'Asia/Jakarta'}
                    />
                  ) : null}

                  <section className="berthing-modal__card">
                    <h3 className="berthing-modal__card-title">Remarks</h3>
                    {vesselDetailEditing && d ? (
                      <textarea
                        id="vessel-detail-remarks"
                        className="berthing-modal__textarea"
                        rows={4}
                        value={d.remark ?? ''}
                        onChange={(e) =>
                          setVesselDetailDraft((prev) => (prev ? { ...prev, remark: e.target.value } : prev))
                        }
                        maxLength={MAX_REMARK_CHARS}
                        placeholder="Remarks"
                        aria-label="Remarks"
                      />
                    ) : (
                      <p className="berthing-modal__empty" style={{ marginTop: 0 }}>
                        {vessel?.remark || vessel?.remarks || '—'}
                      </p>
                    )}
                  </section>
                </div>
                <div className="modal__footer vessel-detail-modal__footer">
                  {vesselDetailEditing ? (
                    <>
                      <button
                        type="button"
                        className="btn btn--small"
                        onClick={cancelVesselDetailEdit}
                        disabled={vesselDetailEditSaving}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="btn btn--primary btn--small"
                        onClick={() => saveVesselDetailEdit(vessel)}
                        disabled={vesselDetailEditSaving}
                      >
                        {vesselDetailEditSaving ? 'Saving…' : 'Save changes'}
                      </button>
                      <button
                        type="button"
                        className="btn btn--small"
                        onClick={() => closeVesselDetailModal()}
                        disabled={vesselDetailEditSaving}
                      >
                        Close
                      </button>
                    </>
                  ) : (
                    <button type="button" className="btn btn--primary btn--small" onClick={() => closeVesselDetailModal()}>
                      Close
                    </button>
                  )}
                </div>
                </>
              )
            })()}
          </div>
        </div>
      )}

      <SiDetailModal
        isOpen={Boolean(siDetailId)}
        siId={siDetailId}
        onClose={() => setSiDetailId(null)}
      />
      <VesselInfoModal
        planId={vesselInfoPlanId}
        isOpen={vesselInfoPlanId != null}
        onClose={() => setVesselInfoPlanId(null)}
        onSaved={() => refreshOverview().catch(() => {})}
      />
      {pipelineEmbed ? (
        <div
          className="modal-overlay"
          onClick={() => {
            setPipelineEmbed(null)
            refreshOverview().catch(() => {})
          }}
          aria-hidden="true"
        >
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={`${pipelineEmbed.label} activity`}
            style={{ width: 'min(1280px, 96vw)', maxWidth: '96vw', height: '88vh', display: 'flex', flexDirection: 'column', padding: 0 }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 16px',
                borderBottom: '1px solid #e5e7eb',
              }}
            >
              <h2 className="modal__title" style={{ margin: 0, fontSize: '1.05rem' }}>
                {pipelineEmbed.label} — activity
              </h2>
              <span style={{ display: 'inline-flex', gap: 8 }}>
                <Link to={pipelineEmbed.url} className="btn btn--small btn--ghost" title="Open as full page">
                  Open full page ↗
                </Link>
                <button
                  type="button"
                  className="btn btn--small btn--secondary"
                  onClick={() => {
                    setPipelineEmbed(null)
                    refreshOverview().catch(() => {})
                  }}
                >
                  Close
                </button>
              </span>
            </div>
            <iframe
              src={pipelineEmbed.url}
              title={`${pipelineEmbed.label} activity`}
              style={{ border: 0, width: '100%', flex: 1, minHeight: 0 }}
            />
          </div>
        </div>
      ) : null}
      <SiDocumentModal
        isOpen={Boolean(siDocumentModalId)}
        siId={siDocumentModalId}
        onClose={() => setSiDocumentModalId(null)}
        allowPreApprovalPreview={isPlanCentric}
      />

      {/* Berthing confirmation modal (extended: jetty allocation, vessel photos, remarks) */}
      {berthingConfirmRow && (
        <div
          className="modal-overlay"
          onClick={closeBerthingConfirm}
          aria-hidden="true"
        >
          <div
            className="modal modal--wide"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-labelledby="berthing-confirm-title"
            aria-modal="true"
          >
            <h2 id="berthing-confirm-title" className="modal__title">
              Confirm Berthing
            </h2>

            <div className="berthing-modal__body">
              <div className="berthing-modal__col-vessel">
                <section className="berthing-modal__card berthing-modal__card--vessel">
                  <h3 className="berthing-modal__card-title">Vessel info</h3>
                  <dl className="berthing-modal__vessel-dl">
                    <div className="berthing-modal__vessel-row">
                      <dt>Vessel name</dt>
                      <dd className="berthing-modal__vessel-dl--bold">{berthingConfirmRow.vesselName || '—'}</dd>
                    </div>
                    <div className="berthing-modal__vessel-row">
                      <dt>SI No</dt>
                      <dd className="berthing-modal__vessel-dl--bold">{berthingConfirmRow.shippingInstruction || '—'}</dd>
                    </div>
                    <div className="berthing-modal__vessel-row">
                      <dt>Surveyor</dt>
                      <dd>{berthingConfirmRow.surveyor || '—'}</dd>
                    </div>
                    <div className="berthing-modal__vessel-row">
                      <dt>Current jetty</dt>
                      <dd>{getTargetJettyId(berthingConfirmRow) || '—'}</dd>
                    </div>
                  </dl>
                </section>
              </div>

              <div className="berthing-modal__col-form">
                <section className="berthing-modal__form-section">
                  <h3 className="berthing-modal__form-section-title">Berthing details</h3>
                  <JettyAllocationSelect
                    id="berthing-jetty"
                    label="Jetty allocation"
                    required
                    value={berthingSelectedJetty}
                    onChange={(e) => setBerthingSelectedJetty(e.target.value)}
                    berthIds={berthIds}
                    berthsState={berthsState}
                    jetties={portJetties}
                    jettyAdvice={berthingJettyAdvice}
                    showOccupancyLabels
                    placeholder="— Select jetty —"
                    ariaDescribedBy={berthingErrors.length > 0 ? 'berthing-errors' : undefined}
                  />
                  <div className="berthing-modal__field">
                    <label htmlFor="berthing-pob" className="berthing-modal__label">Pilot on Board (POB)</label>
                    <input
                      id="berthing-pob"
                      type="datetime-local"
                      className="berthing-modal__input"
                      value={berthingPob}
                      onChange={(e) => setBerthingPob(e.target.value)}
                      aria-label="Pilot on Board"
                    />
                  </div>
                  <div className="berthing-modal__field">
                    <label htmlFor="berthing-ta" className="berthing-modal__label">
                      Actual Time of Arrival (TA) <span className="required-star">*</span>
                    </label>
                    <input
                      id="berthing-ta"
                      type="datetime-local"
                      className="berthing-modal__input"
                      value={berthingTa}
                      onChange={(e) => setBerthingTa(e.target.value)}
                      aria-label="Actual Time of Arrival"
                      aria-required="true"
                    />
                  </div>
                  <div className="berthing-modal__field">
                    <label htmlFor="berthing-tb" className="berthing-modal__label">
                      Actual Time of Berthing (TB) <span className="required-star">*</span>
                    </label>
                    <input
                      id="berthing-tb"
                      type="datetime-local"
                      className="berthing-modal__input"
                      value={berthingTb}
                      onChange={(e) => setBerthingTb(e.target.value)}
                      aria-label="Actual Time of Berthing"
                      aria-required="true"
                    />
                  </div>
                  <div className="berthing-modal__field">
                    <label htmlFor="berthing-sob" className="berthing-modal__label">Surveyor on Board (SOB)</label>
                    <input
                      id="berthing-sob"
                      type="datetime-local"
                      className="berthing-modal__input"
                      value={berthingSob}
                      onChange={(e) => setBerthingSob(e.target.value)}
                      aria-label="Surveyor on Board"
                    />
                  </div>
                  <div className="berthing-modal__field">
                    <label htmlFor="berthing-estimated-completion" className="berthing-modal__label">
                      Estimated completion <span className="required-star">*</span>
                    </label>
                    <input
                      id="berthing-estimated-completion"
                      type="datetime-local"
                      className="berthing-modal__input"
                      value={berthingEstimatedCompletion}
                      onChange={(e) => setBerthingEstimatedCompletion(e.target.value)}
                      aria-label="Estimated completion"
                      aria-required="true"
                    />
                  </div>
                </section>

                <section className="berthing-modal__form-section">
                  <label className="berthing-modal__label">
                    Vessel photo <span className="required-star">*</span>
                  </label>
                  <label htmlFor="berthing-photos" className="berthing-modal__file-zone">
                    <span className="berthing-modal__file-zone-text">
                      {berthingPhotos.length > 0 ? `${berthingPhotos.length} file(s) chosen` : 'Choose files or drop here'}
                    </span>
                    <input
                      id="berthing-photos"
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={addBerthingPhotos}
                      className="berthing-modal__file-input"
                      aria-label="Upload vessel photos"
                      aria-required="true"
                    />
                  </label>
                  {berthingPhotos.length > 0 && (
                    <ul className="berthing-modal__photo-list" aria-label="Uploaded vessel photos">
                      {berthingPhotos.map((p) => (
                        <li key={p.id} className="berthing-modal__photo-item">
                          <img
                            src={p.previewUrl}
                            alt={p.file.name}
                            className="berthing-modal__photo-thumb berthing-modal__photo-preview--clickable"
                            role="button"
                            tabIndex={0}
                            onClick={() =>
                              openFilePreview({
                                url: p.previewUrl,
                                name: p.file.name,
                                mimeType: p.file.type || 'image/jpeg',
                              })
                            }
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault()
                                openFilePreview({
                                  url: p.previewUrl,
                                  name: p.file.name,
                                  mimeType: p.file.type || 'image/jpeg',
                                })
                              }
                            }}
                          />
                          <span className="berthing-modal__photo-name" title={p.file.name}>{p.file.name}</span>
                          <button
                            type="button"
                            className="btn btn--small berthing-modal__photo-remove"
                            onClick={() => removeBerthingPhoto(p.id)}
                            aria-label={`Remove ${p.file.name}`}
                          >
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="berthing-modal__form-section">
                  <label htmlFor="berthing-remarks" className="berthing-modal__label">
                    Remarks <span className="required-star">*</span>
                  </label>
                  <textarea
                    id="berthing-remarks"
                    className="berthing-modal__textarea"
                    rows={3}
                    value={berthingRemarks}
                    onChange={(e) => setBerthingRemarks(e.target.value)}
                    maxLength={MAX_REMARK_CHARS}
                    placeholder="Enter remark for this berthing"
                    aria-describedby={berthingErrors.length > 0 ? 'berthing-errors' : undefined}
                    aria-required="true"
                  />
                </section>
              </div>
            </div>

            {berthingErrors.length > 0 && (
              <div id="berthing-errors" className="berthing-modal__errors" role="alert">
                <p className="berthing-modal__errors-title">Please fix the following:</p>
                <ul className="berthing-modal__errors-list">
                  {berthingErrors.map((msg, i) => (
                    <li key={i}>{msg}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="modal__footer">
              <button type="button" className="btn btn--secondary btn--small" onClick={closeBerthingConfirm}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--primary btn--small"
                onClick={handleBerthingConfirm}
                disabled={berthingSaving}
              >
                {berthingSaving ? 'Saving…' : 'Confirm Berthing'}
              </button>
            </div>
          </div>
        </div>
      )}

      {reDockModal?.row ? (
        <div className="modal-overlay" onClick={closeReDockModal} aria-hidden="true">
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-labelledby="re-dock-modal-title"
            aria-modal="true"
          >
            <h2 id="re-dock-modal-title" className="modal__title">
              Re-dock — {reDockModal.row.vesselName || reDockModal.row.shippingInstruction || 'Vessel'}
            </h2>
            <p className="text-steel" style={{ marginBottom: '0.75rem', fontSize: '0.9rem' }}>
              Clears shift-out so this vessel is treated as at-berth again. Update the operation remark (required).
            </p>
            {reDockModalError ? (
              <p className="allocation-arrival-save-msg allocation-arrival-save-msg--error" role="alert" style={{ marginBottom: '0.75rem' }}>
                {reDockModalError}
              </p>
            ) : null}
            <div className="modal__section">
              <label htmlFor="re-dock-remark" className="modal__label">
                Remark
              </label>
              <textarea
                id="re-dock-remark"
                className="modal__textarea"
                rows={4}
                value={reDockRemarkDraft}
                onChange={(e) => setReDockRemarkDraft(e.target.value)}
                maxLength={MAX_REMARK_CHARS}
                disabled={Boolean(shiftSavingByOpId[reDockModal.row.operationId])}
              />
            </div>
            <div className="modal__footer" style={{ marginTop: '1rem' }}>
              <button type="button" className="btn btn--secondary btn--small" onClick={closeReDockModal}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--primary btn--small"
                onClick={() => confirmReDock()}
                disabled={Boolean(shiftSavingByOpId[reDockModal.row.operationId])}
              >
                {shiftSavingByOpId[reDockModal.row.operationId] ? 'Saving…' : 'Confirm re-dock'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Log arrival update modal (pre-filled from row) */}
      {arrivalUpdateForm && (
        <div
          className="modal-overlay"
          onClick={() => setArrivalUpdateForm(null)}
          aria-hidden="true"
        >
          <div
            className="modal modal--wide"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-labelledby="arrival-update-modal-title"
            aria-modal="true"
          >
            <h2 id="arrival-update-modal-title" className="modal__title">
              Log arrival update
            </h2>

            <div className="vessel-detail-modal__body">
              {isPlanCentric && showLateSiBerthingGateNotice(arrivalUpdateForm, { planCentric: true }) && (
                <AllocationLateSiNotice
                  title={tAlloc('lateSiSchedulingNoticeTitle')}
                  body={tAlloc('lateSiSchedulingNoticeBody')}
                />
              )}
              <section className="berthing-modal__card berthing-modal__card--vessel">
                <h3 className="berthing-modal__card-title">Vessel info</h3>
                <dl className="berthing-modal__vessel-dl">
                  <div className="berthing-modal__vessel-row">
                    <dt>Vessel name</dt>
                    <dd className="berthing-modal__vessel-dl--bold" aria-live="polite">{arrivalUpdateForm.vesselName || '—'}</dd>
                  </div>
                  <div className="berthing-modal__vessel-row">
                    <dt>SI No</dt>
                    <dd className="berthing-modal__vessel-dl--bold" aria-live="polite">{arrivalUpdateForm.shippingInstruction || '—'}</dd>
                  </div>
                  <div className="berthing-modal__vessel-row">
                    <dt>Commodity</dt>
                    <dd aria-live="polite">{arrivalUpdateForm.commodity || '—'}</dd>
                  </div>
                  <div className="berthing-modal__vessel-row">
                    <dt>Purpose</dt>
                    <dd aria-live="polite">
                      <PurposeBadge purpose={arrivalUpdateForm.purpose} loadDischarge={arrivalUpdateForm.loadDischarge} />
                    </dd>
                  </div>
                </dl>
              </section>

              {!isPlanOnlySchedulingRow(arrivalUpdateForm) && (
              <section className="berthing-modal__form-section">
                <h3 className="berthing-modal__form-section-title">Arrival Documents</h3>
                {arrivalSaveMsg && (
                  <p className="allocation-arrival-save-msg allocation-arrival-save-msg--error" role="alert">
                    {arrivalSaveMsg}
                  </p>
                )}
                <div className="berthing-modal__field">
                  <label htmlFor="arrival-noPkk" className="berthing-modal__label">No PKK</label>
                  <input
                    id="arrival-noPkk"
                    type="text"
                    className="berthing-modal__input"
                    value={arrivalUpdateForm.noPkk ?? ''}
                    onChange={(e) => setArrivalUpdateForm((f) => ({ ...f, noPkk: e.target.value }))}
                    placeholder="e.g. PKK-2026-001"
                  />
                </div>
                <div className="berthing-modal__field">
                  <label htmlFor="arrival-nor-doc" className="berthing-modal__label">Notice of Readiness</label>
                  {Array.isArray(arrivalUpdateForm.norDocuments) && arrivalUpdateForm.norDocuments.length > 0 && (
                    <ul
                      className="berthing-modal__file-list"
                      style={{ marginTop: 'var(--spacing-1)', fontSize: 'var(--font-size-small)' }}
                    >
                      {arrivalUpdateForm.norDocuments.map((d) => (
                        <li key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <FilePreviewLink
                            url={fileUrl(d.url)}
                            name={d.name || 'NOR document'}
                            mimeType={d.mimeType ?? null}
                            className="file-preview-link"
                          />
                          <button
                            type="button"
                            className="berthing-modal__nor-delete-btn"
                            title="Delete NOR document"
                            aria-label={`Delete NOR document: ${d.name || 'document'}`}
                            onClick={async () => {
                              if (!window.confirm('Delete this NOR document?')) return
                              try {
                                await deleteOperationDocument(d.id)
                                const q = await refreshOverview()
                                // Refresh the modal's row (so the list updates).
                                setArrivalUpdateForm((prev) => {
                                  const opId = prev?.operationId
                                  const siId = prev?.shippingInstructionId
                                  const nextRow =
                                    (opId && q.find((x) => x.operationId === opId)) ||
                                    (siId && q.find((x) => x.shippingInstructionId === siId)) ||
                                    prev
                                  return nextRow ? { ...prev, ...nextRow } : prev
                                })
                              } catch (e) {
                                setArrivalSaveMsg(e?.message || 'Delete failed')
                              }
                            }}
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              width="18"
                              height="18"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              aria-hidden
                            >
                              <path d="M3 6h18" />
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                              <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                              <line x1="10" x2="10" y1="11" y2="17" />
                              <line x1="14" x2="14" y1="11" y2="17" />
                            </svg>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <label className="berthing-modal__file-zone" htmlFor="arrival-nor-doc">
                    <span className="berthing-modal__file-zone-text">
                      {arrivalNorFiles.length > 0 ? `${arrivalNorFiles.length} file(s) chosen` : 'Choose NOR document'}
                    </span>
                    <input
                      id="arrival-nor-doc"
                      type="file"
                      accept=".pdf,image/*"
                      multiple
                      onChange={(e) => addArrivalNorFiles(e.target.files)}
                      className="berthing-modal__file-input"
                    />
                  </label>
                  {arrivalNorFiles.length > 0 && (
                    <ul className="berthing-modal__file-list" style={{ marginTop: 'var(--spacing-1)', fontSize: 'var(--font-size-small)', color: 'var(--color-text-steel)' }}>
                      {arrivalNorFiles.map((f, i) => (
                        <li key={i}>{f.name}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="berthing-modal__field">
                  <label htmlFor="arrival-nor-tendered" className="berthing-modal__label">NOR Tendered Date &amp; Time</label>
                  <input
                    id="arrival-nor-tendered"
                    type="datetime-local"
                    className="berthing-modal__input"
                    value={arrivalUpdateForm.norTenderedDateTime || ''}
                    onChange={(e) => setArrivalUpdateForm((f) => ({ ...f, norTenderedDateTime: e.target.value }))}
                  />
                </div>
                <div className="berthing-modal__field">
                  <label htmlFor="arrival-nor-accepted" className="berthing-modal__label">NOR Accepted Date &amp; Time</label>
                  <input
                    id="arrival-nor-accepted"
                    type="datetime-local"
                    className="berthing-modal__input"
                    value={arrivalUpdateForm.norAcceptedDateTime || ''}
                    onChange={(e) => setArrivalUpdateForm((f) => ({ ...f, norAcceptedDateTime: e.target.value }))}
                  />
                  <p className="loading-tab-hint" style={{ marginTop: 'var(--spacing-1)', marginBottom: 0 }}>
                    Starts counting Demurrage SLA.
                  </p>
                </div>
                <div className="berthing-modal__field">
                  <label htmlFor="arrival-demurrage-liability" className="berthing-modal__label">
                    Demurrage liability from
                  </label>
                  <input
                    id="arrival-demurrage-liability"
                    type="datetime-local"
                    className="berthing-modal__input"
                    value={arrivalUpdateForm.demurrageLiabilityFromDateTime || ''}
                    onChange={(e) =>
                      setArrivalUpdateForm((f) => ({ ...f, demurrageLiabilityFromDateTime: e.target.value }))
                    }
                  />
                  <p className="loading-tab-hint" style={{ marginTop: 'var(--spacing-1)', marginBottom: 0 }}>
                    Agreed time demurrage liability applies (often matches NOR accepted).
                  </p>
                </div>
              </section>
              )}

              <section className="berthing-modal__form-section">
                <h3 className="berthing-modal__form-section-title">Times & jetty</h3>
                {isPlanOnlySchedulingRow(arrivalUpdateForm) && (
                  <div className="berthing-modal__field">
                    <label htmlFor="arrival-noPkk-plan" className="berthing-modal__label">No PKK</label>
                    <input
                      id="arrival-noPkk-plan"
                      type="text"
                      className="berthing-modal__input"
                      value={arrivalUpdateForm.noPkk ?? ''}
                      onChange={(e) => setArrivalUpdateForm((f) => ({ ...f, noPkk: e.target.value }))}
                      placeholder="e.g. PKK-2026-001"
                    />
                  </div>
                )}
                <div className="berthing-modal__field">
                  <label htmlFor="arrival-priority" className="berthing-modal__label">Priority</label>
                  <select
                    id="arrival-priority"
                    className="berthing-modal__input"
                    value={arrivalUpdateForm.priority || ''}
                    onChange={(e) => setArrivalUpdateForm((f) => ({ ...f, priority: e.target.value }))}
                  >
                    <option value="">—</option>
                    {PRIORITY_OPTIONS.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>
                <div className="berthing-modal__field">
                  <label htmlFor="arrival-eta" className="berthing-modal__label">ETA</label>
                  <input
                    id="arrival-eta"
                    type="datetime-local"
                    className="berthing-modal__input"
                    value={arrivalUpdateForm.etaDateTime || ''}
                    onChange={(e) => setArrivalUpdateForm((f) => ({ ...f, etaDateTime: e.target.value }))}
                  />
                </div>
                {!isPlanOnlySchedulingRow(arrivalUpdateForm) && (
                <div className="berthing-modal__field">
                  <label htmlFor="arrival-ta" className="berthing-modal__label">TA</label>
                  <input
                    id="arrival-ta"
                    type="datetime-local"
                    className="berthing-modal__input"
                    value={arrivalUpdateForm.taDateTime || ''}
                    onChange={(e) => setArrivalUpdateForm((f) => ({ ...f, taDateTime: e.target.value }))}
                  />
                </div>
                )}
                <div className="berthing-modal__field">
                  <label htmlFor="arrival-etb" className="berthing-modal__label">
                    ETB
                    {isEtbRequiredForArrivalForm(arrivalUpdateForm) ? (
                      <span className="required-star"> *</span>
                    ) : null}
                  </label>
                  <input
                    id="arrival-etb"
                    type="datetime-local"
                    className="berthing-modal__input"
                    value={arrivalUpdateForm.etbDateTime || ''}
                    onChange={(e) => setArrivalUpdateForm((f) => ({ ...f, etbDateTime: e.target.value }))}
                    aria-required={isEtbRequiredForArrivalForm(arrivalUpdateForm) || undefined}
                  />
                  {isEtbRequiredForArrivalForm(arrivalUpdateForm) && !arrivalUpdateForm.etbDateTime ? (
                    <p className="berthing-modal__jetty-hint berthing-modal__jetty-hint--error" role="alert">
                      Required when assigning a jetty.
                    </p>
                  ) : null}
                </div>
                {!isPlanOnlySchedulingRow(arrivalUpdateForm) && (
                <div className="berthing-modal__field">
                  <label htmlFor="arrival-estimated-completion" className="berthing-modal__label">
                    Estimated completion
                  </label>
                  <input
                    id="arrival-estimated-completion"
                    type="datetime-local"
                    className="berthing-modal__input"
                    value={arrivalUpdateForm.estimatedCompletionDateTime || ''}
                    onChange={(e) =>
                      setArrivalUpdateForm((f) => ({ ...f, estimatedCompletionDateTime: e.target.value }))
                    }
                  />
                </div>
                )}
                <JettyAllocationSelect
                  id="arrival-jetty"
                  label="Jetty"
                  value={arrivalUpdateForm.jetty || ''}
                  onChange={(e) => setArrivalUpdateForm((f) => ({ ...f, jetty: e.target.value }))}
                  berthIds={berthIds}
                  berthsState={berthsState}
                  jetties={portJetties}
                  jettyAdvice={arrivalJettyAdvice}
                />
              </section>

              <section className="berthing-modal__form-section">
                <label htmlFor="arrival-remarks" className="berthing-modal__label">Remarks</label>
                <textarea
                  id="arrival-remarks"
                  className="berthing-modal__textarea"
                  rows={3}
                  value={arrivalUpdateForm.remark ?? arrivalUpdateForm.remarks ?? ''}
                  onChange={(e) => setArrivalUpdateForm((f) => ({ ...f, remark: e.target.value }))}
                  maxLength={MAX_REMARK_CHARS}
                  placeholder="e.g. Dropped anchor 12/02 01:10; ETB after BG. SMS 3000 at Jetty 2B; Source: WhatsApp"
                />
              </section>
            </div>

            <div className="modal__footer">
              {arrivalSaveMsg && (
                <p
                  className="allocation-arrival-save-msg allocation-arrival-save-msg--error"
                  role="alert"
                  style={{ margin: 0, marginRight: 'auto' }}
                >
                  {arrivalSaveMsg}
                </p>
              )}
              <button type="button" className="btn btn--secondary btn--small" onClick={() => setArrivalUpdateForm(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn--primary btn--small" onClick={() => saveArrivalUpdate()} disabled={arrivalSaving}>
                {arrivalSaving ? 'Saving…' : 'Save update'}
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="card" id="allocation-export-queue-table" ref={queueExportRef}>
        <h2 className="card__title" id="allocation-queue-section">
          {isPlanCentric ? tAlloc('incomingTitlePlan') : tAlloc('incomingTitle')}
        </h2>
        {queueKpiFilter ? (
          <p
            role="status"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              margin: '0 0 0.75rem',
              padding: '6px 12px',
              background: '#fef3c7',
              border: '1px solid #f59e0b',
              borderRadius: 6,
              fontSize: '0.875rem',
            }}
          >
            <span>
              Filtered by schematic KPI: <strong>{queueKpiFilter.label}</strong> ({queueKpiFilter.dateYmd})
            </span>
            <button type="button" className="btn btn--small btn--secondary" onClick={() => setQueueKpiFilter(null)}>
              Clear filter
            </button>
          </p>
        ) : null}
        <div className="allocation-plan-status-filter">
          <div className="allocation-plan-status-filter__row">
            <div className="allocation-plan-status-filter__left">
              <span className="allocation-plan-status-filter__label">{tAlloc('statusLabel')}</span>
              <div
                className="allocation-plan-status-filter__toggles"
                role="group"
                aria-label={isPlanCentric ? tAlloc('statusFilterAriaPlan') : tAlloc('statusFilterAria')}
              >
                <button
                  type="button"
                  className={`btn btn--small ${statusFilter.showIncoming && !etcBreachFilter ? 'btn--primary' : 'btn--ghost'}`}
                  aria-pressed={Boolean(statusFilter.showIncoming) && !etcBreachFilter}
                  disabled={etcBreachFilter}
                  onClick={() =>
                    setStatusFilter((prev) => ({ ...prev, showIncoming: !prev.showIncoming }))
                  }
                >
                  {isPlanCentric ? tAlloc('statusShowIncoming') : tAlloc('statusIncoming')}
                </button>
                <button
                  type="button"
                  className={`btn btn--small ${statusFilter.showBerthed || etcBreachFilter ? 'btn--primary' : 'btn--ghost'}`}
                  aria-pressed={Boolean(statusFilter.showBerthed) || etcBreachFilter}
                  onClick={() => {
                    if (etcBreachFilter) {
                      setEtcBreachFilter(false)
                      setStatusFilter((prev) => ({ ...prev, showBerthed: true, showIncoming: false }))
                      return
                    }
                    setStatusFilter((prev) => ({ ...prev, showBerthed: !prev.showBerthed }))
                  }}
                >
                  {tAlloc('statusBerthed')}
                </button>
                <button
                  type="button"
                  className={`btn btn--small ${etcBreachFilter ? 'btn--primary' : 'btn--ghost'}`}
                  aria-pressed={etcBreachFilter}
                  onClick={() => {
                    const next = !etcBreachFilter
                    setEtcBreachFilter(next)
                    if (next) {
                      setStatusFilter(
                        isPlanCentric
                          ? { ...ETC_BREACH_STATUS_FILTER_PLAN }
                          : { ...ETC_BREACH_STATUS_FILTER_LEGACY }
                      )
                    }
                  }}
                >
                  {tAlloc('statusEtcBreach')}
                </button>
              </div>
            </div>
            {isPlanCentric ? (
              <AllocationTableColumnMenu
                columns={allocationTableColumns}
                visibleKeys={visibleColumnKeys}
                onChange={setVisibleColumnKeys}
                getLabel={allocColLabel}
              />
            ) : null}
          </div>
        </div>
        {isPlanCentric && planSequenceSwapError ? (
          <p role="alert" style={{ color: 'var(--danger-600, #c00)', marginBottom: 'var(--spacing-2)' }}>
            {planSequenceSwapError}
          </p>
        ) : null}
        <div className="table-wrap allocation-table-desktop">
          <table className="data-table allocation-table">
            <thead>
              <tr>
                <th className="allocation-table__expand-col"></th>
                <th className="allocation-table__action-col">{tAlloc('action')}</th>
                {visibleAllocationTableColumns.map((col) => (
                  <th key={col.key} className="allocation-table__th">
                    <button
                      type="button"
                      className="allocation-table__sort"
                      onClick={() => handleSort(col.key)}
                      title={tAlloc('sortBy', { label: allocColLabel(col.key, col.label) })}
                    >
                      {allocColLabel(col.key, col.label)}
                      <span className="allocation-table__sort-icon">
                        {sortState.key === col.key ? (sortState.dir === 'asc' ? ' ↑' : ' ↓') : ' ⇅'}
                      </span>
                    </button>
                  </th>
                ))}
              </tr>
              <tr className="allocation-table__filter-row">
                <th className="allocation-table__expand-col"></th>
                <th className="allocation-table__action-col"></th>
                {visibleAllocationTableColumns.map((col) => (
                  <th key={col.key}>
                    <input
                      type="text"
                      className="allocation-table__filter"
                      placeholder={tAlloc('filterPlaceholder', { label: allocColLabel(col.key, col.label) })}
                      value={filters[col.key]}
                      onChange={(e) => updateFilter(col.key, e.target.value)}
                      aria-label={tAlloc('filterBy', { label: allocColLabel(col.key, col.label) })}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isPlanCentric && sortedPlanQueueList
                ? sortedPlanQueueList.map((r) => renderOneDesktopRow(r))
                : sortedList.map((r) => renderOneDesktopRow(r))}
            </tbody>
          </table>
        </div>
        {hasQueueRows && (
          <div className="allocation-mobile-cards" aria-label="Incoming vessel cards">
            {(isPlanCentric && sortedPlanQueueList ? sortedPlanQueueList : sortedList).map((r) => {
              const mobileBreach = getEtcBreach(r, breachNowMs)
              return (
              <article
                key={`mobile-${r.vesselId ?? r.id}`}
                className={`allocation-mobile-card${mobileBreach ? ' allocation-mobile-card--etc-breach' : ''}`}
              >
                <header className="allocation-mobile-card__header">
                  <strong>{r.vesselName || '—'}</strong>
                  <span className="text-steel">{r.jetty || '—'}</span>
                </header>
                <dl className="allocation-mobile-card__grid">
                  {allocationTableColumns.slice(0, 6).map((col) => (
                    <Fragment key={`mobile-col-${r.id}-${col.key}`}>
                      <dt>{allocColLabel(col.key, col.label)}</dt>
                      <dd>
                        {col.key === 'sequence' ? (
                          isPlanCentric &&
                          r.shipmentPlanId != null &&
                          canEditAllocation &&
                          sortedPlanQueueList ? (
                            (() => {
                              const displayList =
                                isPlanCentric && sortedPlanQueueList ? sortedPlanQueueList : sortedList
                              const idx = displayList.findIndex((x) => x.id === r.id)
                              const prevPlan = idx >= 0 ? findAdjacentPlanRowInDisplay(displayList, idx, -1) : null
                              const nextPlan = idx >= 0 ? findAdjacentPlanRowInDisplay(displayList, idx, 1) : null
                              const pid = Number(r.shipmentPlanId)
                              let busyThis = false
                              if (planSequenceBusyPair) {
                                const parts = planSequenceBusyPair.split('-').map((p) => parseInt(p, 10))
                                if (parts.length === 2 && parts.every((n) => Number.isFinite(n))) {
                                  const [ba, bb] = parts
                                  busyThis = pid === ba || pid === bb
                                }
                              }
                              return (
                                <span className="allocation-table__sequence-cell">
                                  <span className="allocation-table__sequence-btns">
                                    <button
                                      type="button"
                                      className="btn btn--small allocation-table__sequence-btn"
                                      onClick={() => {
                                        if (!prevPlan?.shipmentPlanId) return
                                        void swapPlanBerthingSequencePair(pid, Number(prevPlan.shipmentPlanId), pid)
                                      }}
                                      disabled={!prevPlan || busyThis}
                                      title="Move up"
                                      aria-label="Move berthing sequence up"
                                    >
                                      ↑
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn--small allocation-table__sequence-btn"
                                      onClick={() => {
                                        if (!nextPlan?.shipmentPlanId) return
                                        void swapPlanBerthingSequencePair(
                                          pid,
                                          Number(nextPlan.shipmentPlanId),
                                          Number(nextPlan.shipmentPlanId)
                                        )
                                      }}
                                      disabled={!nextPlan || busyThis}
                                      title="Move down"
                                      aria-label="Move berthing sequence down"
                                    >
                                      ↓
                                    </button>
                                  </span>
                                </span>
                              )
                            })()
                          ) : !isPlanCentric ? (
                            <span className="allocation-table__sequence-cell">
                              <span className="allocation-table__sequence-btns">
                                <button
                                  type="button"
                                  className="btn btn--small allocation-table__sequence-btn"
                                  onClick={(e) => moveSequenceUp(r, e)}
                                  disabled={sortedList.findIndex((x) => x.id === r.id) <= 0}
                                  title="Move up"
                                  aria-label="Move berthing sequence up"
                                >
                                  ↑
                                </button>
                                <button
                                  type="button"
                                  className="btn btn--small allocation-table__sequence-btn"
                                  onClick={(e) => moveSequenceDown(r, e)}
                                  disabled={sortedList.findIndex((x) => x.id === r.id) >= sortedList.length - 1}
                                  title="Move down"
                                  aria-label="Move berthing sequence down"
                                >
                                  ↓
                                </button>
                              </span>
                            </span>
                          ) : (
                            '—'
                          )
                        ) : col.key === 'planReference' ? (
                          r.shipmentPlanId != null ? (
                            <Link to={`/shipment-plans/${r.shipmentPlanId}`} className="link">
                              {r.planReference || `Plan #${r.shipmentPlanId}`}
                            </Link>
                          ) : (
                            '—'
                          )
                        ) : col.key === 'jettyOperationCode' ? (
                          r.shippingInstructionId ? (
                            <a
                              href="#"
                              onClick={(e) => {
                                e.preventDefault()
                                openSiDetailModal(r.shippingInstructionId)
                              }}
                              aria-label={tAlloc('openSiDetailFromJettyOp')}
                            >
                              {r.jettyOperationCode || '—'}
                            </a>
                          ) : (
                            r.jettyOperationCode || '—'
                          )
                        ) : col.key === 'shippingInstruction' ? (
                          Array.isArray(r.planQueueSiEntries) && r.planQueueSiEntries.length > 0 ? (
                            <div
                              style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '0.35rem',
                                alignItems: 'flex-start',
                              }}
                            >
                              {r.planQueueSiEntries.map((si) => (
                                <a
                                  key={si.shippingInstructionId}
                                  href="#"
                                  className="link"
                                  onClick={(e) => {
                                    e.preventDefault()
                                    openSiDocumentModal(si.shippingInstructionId)
                                  }}
                                  aria-label={tAlloc('openSiDocument')}
                                >
                                  {si.label}
                                </a>
                              ))}
                            </div>
                          ) : r.shippingInstructionId ? (
                            <a
                              href="#"
                              className="link"
                              onClick={(e) => {
                                e.preventDefault()
                                openSiDocumentModal(r.shippingInstructionId)
                              }}
                              aria-label={tAlloc('openSiDocument')}
                            >
                              {isPlanCentric ? planCentricSiColumnDisplay(r) : r.shippingInstruction || '—'}
                            </a>
                          ) : (
                            isPlanCentric ? planCentricSiColumnDisplay(r) : r.shippingInstruction || '—'
                          )
                        ) : col.key === 'commodityQty' ? (
                          renderCommodityQtyCell(r)
                        ) : col.key === 'vesselName' && r.shipmentPlanId != null ? (
                          <VesselNameButton
                            name={r.vesselName || '—'}
                            onClick={() => setVesselInfoPlanId(r.shipmentPlanId)}
                            strong
                          />
                        ) : (
                          col.getValue(r)
                        )}
                      </dd>
                    </Fragment>
                  ))}
                  <dt>{allocColLabel('etc', 'ETC')}</dt>
                  <dd>
                    {formatDateTimeDisplay(r.estimatedCompletionDateTime || r.estimationOfCompletion) || '—'}
                    {mobileBreach ? (
                      <span className="at-berth-etc-cell__badge">
                        <EtcBreachBadge overMs={mobileBreach.overMs} etcMs={mobileBreach.etcMs} size="sm" />
                      </span>
                    ) : null}
                  </dd>
                </dl>
                <div className="allocation-mobile-card__actions">
                  <button
                    type="button"
                    className="btn btn--small btn--ghost"
                    onClick={() => setExpandedMobileId((id) => (id === r.id ? null : r.id))}
                  >
                    {expandedMobileId === r.id ? 'Hide full detail' : 'Full detail'}
                  </button>
                  <button type="button" className="btn btn--primary btn--small" onClick={() => openArrivalUpdate(r)}>
                    {tAlloc('logArrivalUpdate')}
                  </button>
                  {r.shiftingOut && r.operationId != null ? (
                    <button
                      type="button"
                      className="btn btn--secondary btn--small"
                      onClick={(e) => openReDockModal(r, e)}
                      disabled={Boolean(shiftSavingByOpId[r.operationId])}
                    >
                      {shiftSavingByOpId[r.operationId] ? tAlloc('saving') : tAlloc('reDock')}
                    </button>
                  ) : (
                    <BerthingActionButton
                      row={r}
                      isPlanCentric={isPlanCentric}
                      label={tAlloc('berthing')}
                      onBerthing={openBerthingConfirm}
                    />
                  )}
                </div>
                {expandedMobileId === r.id ? (
                  <div className="allocation-mobile-card__detail">
                    <AllocationDetailPanel
                r={r}
                tAlloc={tAlloc}
                onOpenSiDetail={openSiDetailModal}
                queueList={list}
                nowMs={breachNowMs}
              />
                  </div>
                ) : null}
              </article>
              )
            })}
          </div>
        )}
        {!hasQueueRows && (
          <p className="allocation-plan-status-filter__empty">No vessels match the selected status/filter criteria.</p>
        )}
      </section>
    </div>
  )
}
