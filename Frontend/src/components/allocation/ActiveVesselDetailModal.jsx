/* eslint-disable react-hooks/exhaustive-deps */
import { Fragment, useState, useEffect, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  deleteOperationDocument,
  fetchOperationDocuments,
  saveArrivalUpdate as saveArrivalUpdateApi,
  uploadOperationDocuments,
} from '../../api/allocation'
import { fetchShipmentPlan } from '../../api/shipmentPlans'
import { ApiError, resolveUploadUrl } from '../../api/client'
import FilePreviewLink from '../FilePreviewLink'
import AuthenticatedFileImage from '../AuthenticatedFileImage'
import { useFilePreview } from '../../context/FilePreviewContext'
import { formatDateTimeDisplay } from '../../utils/formatDateTimeDisplay'
import {
  getScheduleEntryTimeZone,
  normalizeForApiOrEmpty,
  utcIsoToNaiveLocal,
} from '../../utils/scheduleDateTime'
import { isBerthOutOfService, jettyOosAllocationMessage, berthOtherOccupants } from '../../utils/jettyAvailability'
import PurposeBadge from '../PurposeBadge'
import SiDetailModal from '../SiDetailModal'
import SiDocumentModal from '../SiDocumentModal'
import OperationalProgressSection from '../OperationalProgressSection'
import { usePortScope } from '../../context/PortScopeContext'
import { useRbac } from '../../context/RbacContext'
import { MAX_REMARK_CHARS } from '../../constants/inputLimits'
import {
  currentPhaseLabelForVessel,
  deriveCurrentPhaseIndex,
  getPlanAlongsideEndMs,
  getVesselAlongsideEndMs,
  isPlanOrVesselSailed,
  isVesselReadyToSail,
  isVesselSailed,
} from '../../utils/allocationVesselPhase'
import { validateBerthingTimeline } from '../../utils/validateScheduleTimeline'
import '../../styles/allocation.css'
import '../../styles/modal.css'

const UNIFIED_PHASES = ['Shipping Instruction', 'Planned berthing', 'At-Berth', 'Clearance']
const PRIORITY_OPTIONS = ['Low', 'Moderate', 'High', 'Critical']

function getPhaseLink(label, vessel, plannedBerthingPath = '/allocation-plans', { embed = false } = {}) {
  const phaseRoutes = {
    'Shipping Instruction': '/shipment-plans',
    'Planned berthing': plannedBerthingPath,
    'Clearance': '/verification',
  }
  let path = null
  if (label === 'At-Berth') {
    const opId = vessel?.operationId
    if (!opId) return null
    const purpose = String(vessel?.purpose || '').trim()
    const base = purpose === 'Unloading' ? '/unloading' : '/loading'
    path = `${base}/op-${opId}/pre-checking`
  } else {
    path = phaseRoutes[label] || '#'
  }
  if (embed && path && path !== '#') {
    return path.includes('?') ? `${path}&embed=1` : `${path}?embed=1`
  }
  return path
}

function seqSortKey(row) {
  const n = row?.sequence != null ? Number(row.sequence) : NaN
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY
}

function parseDateMs(val) {
  if (!val) return null
  const t = new Date(val).getTime()
  return Number.isNaN(t) ? null : t
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

function getTargetJettyId(row) {
  const raw = (row?.jetty || '').trim()
  return raw.split('/')[0].trim() || null
}

/**
 * Active vessel detail modal (shared by Allocation & Berthing and Live Ops dashboard).
 */
export default function ActiveVesselDetailModal({
  vesselId,
  planId = null,
  onClose,
  readOnly = false,
  isPlanCentric = true,
  canEditAllocation = false,
  queueList = [],
  scheduleList = [],
  berthsState = [],
  onRefreshOverview,
  plannedBerthingPath = '/allocation-plans',
  activityLogPage = 'allocation-plan',
}) {
  const { openFilePreview } = useFilePreview()
  const { t: tAlloc } = useTranslation('allocation')
  const { selectedPort } = usePortScope()
  const { canView } = useRbac()
  const canViewMasterJetty = canView('master-jetties')
  const scheduleEntryTz = getScheduleEntryTimeZone()
  const toDateTimeLocalValue = useCallback(
    (iso) => utcIsoToNaiveLocal(iso, scheduleEntryTz),
    [scheduleEntryTz],
  )

  const [planDetail, setPlanDetail] = useState(null)
  const [planDetailLoading, setPlanDetailLoading] = useState(false)
  const [planDetailError, setPlanDetailError] = useState(null)
  const [planTimesEdit, setPlanTimesEdit] = useState(null)
  const [planTimesSaving, setPlanTimesSaving] = useState(false)
  const [planTimesMsg, setPlanTimesMsg] = useState(null)
  const [vesselDetailEditing, setVesselDetailEditing] = useState(false)
  const [vesselDetailDraft, setVesselDetailDraft] = useState(null)
  const [vesselDetailOriginalJetty, setVesselDetailOriginalJetty] = useState('')
  const [vesselDetailEditError, setVesselDetailEditError] = useState(null)
  const [vesselDetailEditSaving, setVesselDetailEditSaving] = useState(false)
  const [vesselDetailNorNewFiles, setVesselDetailNorNewFiles] = useState([])
  const [vesselDetailNorNewRaw, setVesselDetailNorNewRaw] = useState([])
  const [vesselDetailBerthingNewPhotos, setVesselDetailBerthingNewPhotos] = useState([])
  const [vesselPhotosByVesselId, setVesselPhotosByVesselId] = useState({})
  const [siDetailId, setSiDetailId] = useState(null)
  const [siDocumentModalId, setSiDocumentModalId] = useState(null)
  const [pipelineEmbed, setPipelineEmbed] = useState(null)

  const openSiDocumentModal = useCallback((id) => {
    setSiDetailId(null)
    setSiDocumentModalId(id)
  }, [])
  const openSiDetailModal = useCallback((id) => {
    setSiDocumentModalId(null)
    setSiDetailId(id)
  }, [])

  const berthIds = useMemo(
    () => (Array.isArray(berthsState) ? berthsState.map((b) => b.id).filter(Boolean) : []),
    [berthsState],
  )

  const vesselDetailRows = useMemo(() => {
    const byId = new Map()
    for (const r of queueList) {
      if (!r?.vesselId) continue
      if (!byId.has(r.vesselId)) byId.set(r.vesselId, r)
    }
    for (const r of scheduleList) {
      if (!r?.vesselId) continue
      if (!byId.has(r.vesselId)) byId.set(r.vesselId, r)
    }
    return Array.from(byId.values())
  }, [queueList, scheduleList])

  const vesselById = useMemo(() => {
    const map = {}
    for (const r of vesselDetailRows) {
      if (r?.vesselId) map[r.vesselId] = r
    }
    return map
  }, [vesselDetailRows])

  const getVesselName = useCallback(
    (id) => {
      if (!id) return '—'
      const v = vesselById?.[id]
      return v?.vesselName || String(id)
    },
    [vesselById],
  )

  const vesselDetailPlanQueueRows = useMemo(() => {
    if (!isPlanCentric || planId == null) return []
    const byKey = new Map()
    for (const r of [...queueList, ...scheduleList]) {
      if (Number(r?.shipmentPlanId) !== Number(planId)) continue
      const k = r.vesselId || r.id || String(r.shippingInstructionId ?? '')
      if (!k) continue
      if (!byKey.has(k)) byKey.set(k, r)
    }
    return [...byKey.values()].sort((a, b) => {
      const ds = seqSortKey(a) - seqSortKey(b)
      if (ds !== 0) return ds
      return (Number(a.shippingInstructionId) || 0) - (Number(b.shippingInstructionId) || 0)
    })
  }, [isPlanCentric, planId, queueList, scheduleList])

  const fileUrl = (p) => resolveUploadUrl(p)

  useEffect(() => {
    if (!isPlanCentric || planId == null) {
      setPlanDetail(null)
      setPlanDetailError(null)
      setPlanDetailLoading(false)
      return undefined
    }
    let cancelled = false
    setPlanDetailLoading(true)
    setPlanDetailError(null)
    fetchShipmentPlan(planId)
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
  }, [isPlanCentric, planId])

  useEffect(() => {
    if (!vesselId) return undefined
    const fromId = typeof vesselId === 'string' && vesselId.startsWith('op-')
      ? parseInt(vesselId.slice(3), 10)
      : null
    const vesselRow = vesselDetailRows.find((r) => r.vesselId === vesselId) || null
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
  }, [vesselId, vesselDetailRows, vesselPhotosByVesselId])

  useEffect(() => {
    if (!vesselId) {
      setVesselDetailEditing(false)
      setVesselDetailDraft(null)
      setVesselDetailEditError(null)
      setVesselDetailEditSaving(false)
      setVesselDetailNorNewFiles([])
      setVesselDetailNorNewRaw([])
      setPlanDetail(null)
      setPlanDetailError(null)
      setPlanDetailLoading(false)
      setPlanTimesEdit(null)
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
      onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [vesselId, siDetailId, siDocumentModalId, vesselDetailEditing, onClose])

  const savePlanTimes = async (vesselRow) => {
    if (readOnly || !planTimesEdit) return
    setPlanTimesSaving(true)
    setPlanTimesMsg(null)
    const hasOp = vesselRow?.operationId != null && vesselRow.operationId !== ''
    const hasSi = vesselRow?.shippingInstructionId != null && vesselRow.shippingInstructionId !== ''
    const payload = { activityLogPage }
    if (hasOp) payload.operationId = vesselRow.operationId
    if (hasSi) payload.shippingInstructionId = vesselRow.shippingInstructionId
    if (!hasOp && !hasSi) payload.shipmentPlanId = vesselRow?.shipmentPlanId
    const put = (key, raw) => {
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
    const timelineErr = validateBerthingTimeline({
      eta: planTimesEdit.eta,
      etb: planTimesEdit.etb,
      ta: hasOp || hasSi ? planTimesEdit.ta : null,
      tb: hasOp || hasSi ? planTimesEdit.tb : null,
      etc: hasOp || hasSi ? planTimesEdit.etc : null,
    })
    if (timelineErr) {
      setPlanTimesMsg(timelineErr)
      setPlanTimesSaving(false)
      return
    }
    try {
      await saveArrivalUpdateApi(payload)
      setPlanTimesEdit(null)
      if (vesselRow?.shipmentPlanId != null) {
        fetchShipmentPlan(vesselRow.shipmentPlanId)
          .then((d) => setPlanDetail(d))
          .catch(() => {})
      }
      await onRefreshOverview?.()
    } catch (e) {
      setPlanTimesMsg(e?.message || 'Save failed')
    } finally {
      setPlanTimesSaving(false)
    }
  }

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
    if (readOnly || !vessel?.operationId) return
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

  const isEtbRequiredForVesselDetailDraft = (draft) => {
    if (!draft) return false
    const currentJetty = (draft.jetty || '').trim().split('/')[0].trim()
    return Boolean(currentJetty) && currentJetty !== vesselDetailOriginalJetty
  }

  const saveVesselDetailEdit = async (vessel) => {
    if (readOnly || !vessel?.operationId || !vesselDetailDraft) return
    const targetJettyId = (vesselDetailDraft.jetty || '').trim().split('/')[0].trim()
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
      const others = berthOtherOccupants(berth, vessel.vesselId)
      const isFull = others.length >= Math.max(1, capacity)
      if (isFull) {
        const firstOccId = others[0]?.vesselId
        const occupantName = firstOccId ? getVesselName(firstOccId) : 'another vessel'
        const candidateArrivalMs = getArrivalMsForJettyValidation({
          ...vessel,
          etaDateTime: vesselDetailDraft.etaDateTime || vessel.etaDateTime,
          etbDateTime: vesselDetailDraft.etbDateTime || vessel.etbDateTime,
          taDateTime: vesselDetailDraft.taDateTime || vessel.taDateTime,
        })
        const completionCandidates = others
          .map((o) => queueList.find((x) => x.vesselId === o.vesselId))
          .map((row) => getCompletionMsForJettyValidation(row))
          .filter((x) => x != null)
        const earliestFreeMs = completionCandidates.length ? Math.min(...completionCandidates) : null
        const canAllocateAfterCompletion =
          candidateArrivalMs != null && earliestFreeMs != null && candidateArrivalMs >= earliestFreeMs
        if (!canAllocateAfterCompletion) {
          setVesselDetailEditError(
            `Jetty ${targetJettyId} is full. Example occupant: ${occupantName}.`,
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
      await saveArrivalUpdateApi({
        activityLogPage,
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
          scheduleEntryTz,
        ),
        norTenderedDateTime: normalizeForApiOrEmpty(vesselDetailDraft.norTenderedDateTime, scheduleEntryTz),
        norAcceptedDateTime: normalizeForApiOrEmpty(vesselDetailDraft.norAcceptedDateTime, scheduleEntryTz),
        demurrageLiabilityFromDateTime: normalizeForApiOrEmpty(
          vesselDetailDraft.demurrageLiabilityFromDateTime,
          scheduleEntryTz,
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
      await onRefreshOverview?.()
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

  if (!vesselId) return null

  return (
    <>
        <div
          className="modal-overlay"
          onClick={() => onClose()}
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
              {isPlanCentric && planId != null ? (
                <span>
                  {tAlloc('planModalTitleWithVessel', {
                    defaultValue: 'Active vessel - {{name}}',
                    name: getVesselName(vesselId) || '—',
                  })}
                </span>
              ) : (
                <>
                  ⚓ {tAlloc('activeVesselDetailTitle', { defaultValue: 'Active Vessel Detail' })}:{' '}
                  {getVesselName(vesselId)}
                </>
              )}
            </h2>
            {(() => {
              const vesselRow = vesselDetailRows.find((r) => r.vesselId === vesselId)
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
              const isPlanDetailMode = Boolean(isPlanCentric && planId != null)
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
              const canVesselDetailEdit = Boolean(canEditAllocation && !readOnly && vessel?.operationId)
              const d = vesselDetailDraft
              const lastUpdatedText = formatVesselRecordLastUpdatedLine(vessel)
              const existingBerthPhotos = vesselPhotosByVesselId[vesselId] || []
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
                              if (!disabled && to) {
                                setPipelineEmbed({
                                  embedUrl: getPhaseLink(label, vessel, plannedBerthingPath, { embed: true }),
                                  fullUrl: to,
                                  label,
                                })
                              }
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
                          {canEditAllocation && !readOnly && !planDetailLoading && planDetail ? (
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
                              // Multi-jetty berthing: `occupiedCount` also counts a vessel spanning in
                              // from an adjacent jetty (see `berthOtherOccupants`) — don't recompute
                              // from `occList.length` alone or a spanned-into jetty looks fully vacant.
                              const occCount = b?.occupiedCount != null ? Number(b.occupiedCount) : occList.length
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
                                        await onRefreshOverview?.()
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
                      vesselId={vesselId}
                      jettyName={vessel?.jettyOperationCode ?? null}
                      vesselName={vessel?.vesselName ?? getVesselName(vesselId) ?? null}
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
                        onClick={() => onClose()}
                        disabled={vesselDetailEditSaving}
                      >
                        Close
                      </button>
                    </>
                  ) : (
                    <button type="button" className="btn btn--primary btn--small" onClick={() => onClose()}>
                      Close
                    </button>
                  )}
                </div>
                </>
              )
            })()}
          </div>
        </div>
      <SiDetailModal
        isOpen={Boolean(siDetailId)}
        siId={siDetailId}
        onClose={() => setSiDetailId(null)}
      />
      <SiDocumentModal
        isOpen={Boolean(siDocumentModalId)}
        siId={siDocumentModalId}
        onClose={() => setSiDocumentModalId(null)}
      />
      {pipelineEmbed ? (
        <div
          className="modal-overlay"
          onClick={() => {
            setPipelineEmbed(null)
            onRefreshOverview?.()
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
                <Link to={pipelineEmbed.fullUrl} className="btn btn--small btn--ghost" title="Open as full page">
                  Open full page ↗
                </Link>
                <button
                  type="button"
                  className="btn btn--small btn--secondary"
                  onClick={() => {
                    setPipelineEmbed(null)
                    onRefreshOverview?.()
                  }}
                >
                  Close
                </button>
              </span>
            </div>
            <iframe
              src={pipelineEmbed.embedUrl}
              title={`${pipelineEmbed.label} activity`}
              style={{ border: 0, width: '100%', flex: 1, minHeight: 0 }}
            />
          </div>
        </div>
      ) : null}
    </>
  )
}
