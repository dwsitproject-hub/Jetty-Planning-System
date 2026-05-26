import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Link, useParams, Navigate, useLocation, useSearchParams, useNavigate } from 'react-router-dom'
import {
  vessels,
  getAtBerthOperations,
  LOADING_STEP_IDS,
  initialLoadingStepsByVesselId,
  initialLoadingOperationByVesselId,
  getLoadingOperationCargo,
  LOADING_ACTIVITY_CATEGORIES,
  UNLOADING_ACTIVITY_CATEGORIES,
  getArrivalNor,
  setArrivalNor,
  defaultPreCheckingSection,
  defaultPostCheckingSection,
} from '../data/mockData'
import { useLoading } from '../context/LoadingContext'
import {
  fetchOperation,
  fetchSubProcesses,
  upsertSubProcess,
  fetchSubProcessDocuments,
  uploadSubProcessDocuments,
  deleteSubProcessDocument,
  fetchOperationalActivities,
  fetchNorDetails,
  updateNorDetails,
  signoffRequest,
} from '../api/operations'
import { resolveUploadUrl } from '../api/client'
import FilePreviewLink from '../components/FilePreviewLink'
import { useFilePreview } from '../context/FilePreviewContext'
import {
  fetchAllocationOverview,
  saveArrivalUpdate as saveArrivalUpdateApi,
  uploadOperationDocuments,
  fetchOperationDocuments,
  deleteOperationDocument,
} from '../api/allocation'
import { formatDateTimeDisplay } from '../utils/formatDateTimeDisplay'
import { getScheduleEntryTimeZone, normalizeForApi } from '../utils/scheduleDateTime.js'
import { usePortScope } from '../context/PortScopeContext'
import FlowPill from '../components/FlowPill'
import OperationalMilestoneWorkspace from '../components/OperationalMilestoneWorkspace'
import OperationActivityTimeline from '../components/OperationActivityTimeline'
import { operationalMilestoneDoneCount, viewModelFromOperationalEntries } from '../data/operationalMilestones'
import {
  computeProcessStagesNumbers,
  inferPrecheckStatus,
  inferPostcheckStatus,
  getPreCheckStageKeys,
  POST_CHECK_SUB_TABS,
  POST_CHECK_STAGE_IDS,
  isoOrDatetimeToLocal,
} from '../utils/loadingHubProcessStagesFromApi'
import { mergeDistinctLines } from '../utils/mergeHydrationLines.js'
import '../styles/allocation.css'
import { useRbac } from '../context/RbacContext'
import { term } from '../i18n/term'
import {
  MAX_POSTCHECK_RESULT_CHARS,
  MAX_REMARK_CHARS,
  MAX_SAMPLING_PALKA_FIELD_CHARS,
} from '../constants/inputLimits'

function readBool(key, fallback = false) {
  try {
    const v = localStorage.getItem(key)
    if (v === '1') return true
    if (v === '0') return false
    return fallback
  } catch {
    return fallback
  }
}

function writeBool(key, value) {
  try {
    localStorage.setItem(key, value ? '1' : '0')
  } catch {
    /* ignore */
  }
}

const SECTIONS = [
  { id: 'pre-checking', label: 'Pre-Checking', description: 'Survey, Quality Check, Quantity Check (A1, A2, A3)', stepIds: ['A1', 'A2', 'A3'] },
  { id: 'loading', label: 'Operational', description: 'Cargo loading (B)', stepIds: ['B'] },
  { id: 'post-checking', label: 'Post-Checking', description: 'Final Quality Check, Final Quantity Check (C1, C2)', stepIds: ['C1', 'C2'] },
]

/** Later of two timestamps (ISO); null if both missing */
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

/** Allocation / at-berth queue uses `op-<operationId>` as vessel_id for berthed operations */
function parseOperationIdFromRouteVesselId(vid) {
  if (!vid || typeof vid !== 'string') return null
  const m = /^op-(\d+)$/i.exec(vid.trim())
  return m ? parseInt(m[1], 10) : null
}

function normalizeApiPurpose(p) {
  return p === 'Unloading' ? 'Unloading' : 'Loading'
}

/** Minimal cargo card when vessel comes from API (no mock `vessels` entry) */
function cargoFromApiOp(op) {
  if (!op) return null
  const jettyRaw = op.jettyName || '—'
  const jetty = String(jettyRaw).replace(/^Jetty\s+/i, '').trim() || '—'
  return {
    vesselName: op.vesselName || '—',
    commodity: op.commodity || '—',
    quantity: '—',
    quantityNum: null,
    stowage: '—',
    loadPort: '—',
    dischPort: '—',
    shipper: '—',
    consignee: '—',
    surveyor: '—',
    agent: '—',
    jettyName: jetty,
    jettyId: op.jettyId ?? null,
  }
}

/** Aligns with stage tabs (7/7, 4/4, 3/3) for operation sign-off CTA visibility. */
function computeAllStagesComplete({
  vesselId,
  purpose,
  operationId,
  apiOperationalVm,
  getPreChecking,
  getPostChecking,
  getLoadingOperation,
}) {
  if (!vesselId) return false
  const preData = getPreChecking(vesselId) || {}
  const preKeys = getPreCheckStageKeys(purpose)
  const preDone = preKeys.filter((k) => inferPrecheckStatus(k, preData[k] || {}) === 'Done').length
  if (preDone < preKeys.length) return false

  const milestoneList = purpose === 'Unloading' ? UNLOADING_ACTIVITY_CATEGORIES : LOADING_ACTIVITY_CATEGORIES
  const loadingOpProgress = getLoadingOperation(vesselId) || { activities: [], milestoneNa: {} }
  const operationalDone = operationId
    ? operationalMilestoneDoneCount(purpose, apiOperationalVm.activities, apiOperationalVm.naByLabel)
    : (() => {
        const naProgress = loadingOpProgress.milestoneNa || {}
        return milestoneList.filter((cat) => {
          if (naProgress[cat]?.reason) return true
          return (loadingOpProgress.activities || []).some((a) => a.category === cat)
        }).length
      })()
  if (operationalDone < milestoneList.length) return false

  const postData = getPostChecking(vesselId) || {}
  const postDone = POST_CHECK_STAGE_IDS.filter(
    (k) => inferPostcheckStatus(k, postData[k] || {}) === 'Done'
  ).length
  return postDone >= POST_CHECK_STAGE_IDS.length
}

function OperationSignoffBanner({
  apiOp,
  operationId,
  allStagesComplete,
  incompletePlanPeers,
  basePath,
  canEditLoading,
  canApproveLoading,
  onOperationUpdated,
}) {
  const [requestOpen, setRequestOpen] = useState(false)
  const [remark, setRemark] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  if (!apiOp || !operationId) return null
  const st = String(apiOp.status || '')
  if (st === 'SIGNOFF_APPROVED' || st === 'SAILED') return null
  if (!['DOCKED', 'IN_PROGRESS', 'POST_OPS', 'SIGNOFF_REQUESTED'].includes(st)) return null

  const pending = st === 'SIGNOFF_REQUESTED' || Boolean(apiOp.signoffRequestedAt)
  const showPeersBlockingCard =
    st === 'POST_OPS' && !pending && allStagesComplete && incompletePlanPeers.length > 0
  const showRequestCta =
    st === 'POST_OPS' && allStagesComplete && incompletePlanPeers.length === 0 && !pending && canEditLoading
  const showApproveCta = pending && canApproveLoading

  const parseApiError = (e) => (e?.body && typeof e.body === 'object' && e.body.error) || e?.message || 'Request failed'

  const submitRequest = async () => {
    setErr(null)
    setBusy(true)
    try {
      const updated = await signoffRequest(operationId, remark)
      onOperationUpdated?.(updated)
      setRequestOpen(false)
      setRemark('')
    } catch (e) {
      setErr(parseApiError(e))
    } finally {
      setBusy(false)
    }
  }

  if (showPeersBlockingCard) {
    return (
      <section
        className="card"
        style={{
          marginTop: 'var(--spacing-3)',
          borderLeft: '4px solid var(--color-border-medium, #ccc)',
        }}
      >
        <h2 className="card__title" style={{ fontSize: '1.05rem' }}>
          Operation sign-off
        </h2>
        <p className="text-steel" style={{ marginBottom: 'var(--spacing-2)' }}>
          This instruction is complete through Post-Checking, but <strong>every</strong> instruction on this vessel call
          must finish Pre-Checking, Operational, and Post-Checking (and meet completion rules) before sign-off can be
          requested.
        </p>
        <p style={{ marginBottom: 'var(--spacing-2)', fontSize: 'var(--font-size-small)' }}>
          Still in progress or not ready:
        </p>
        <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: 'var(--font-size-small)' }}>
          {incompletePlanPeers.map((row) => (
            <li key={row.operationId} style={{ marginBottom: 'var(--spacing-1)' }}>
              <Link to={`${basePath}/op-${row.operationId}/post-checking`}>
                {row.shippingInstruction || row.jettyOperationCode || `Operation ${row.operationId}`}
              </Link>
              <span className="text-steel">
                {' '}
                · {row.status || '—'}
                {row.completionPercent != null ? ` · ${Number(row.completionPercent)}%` : ''}
              </span>
            </li>
          ))}
        </ul>
      </section>
    )
  }

  if (!showRequestCta && !pending && !showApproveCta) {
    if (allStagesComplete && !canEditLoading && incompletePlanPeers.length === 0) {
      return (
        <section className="card" style={{ marginTop: 'var(--spacing-3)' }}>
          <p className="text-steel">
            All stages are complete. Your role cannot submit a sign-off request (Loading / Unloading <strong>Edit</strong> required).
          </p>
        </section>
      )
    }
    return null
  }

  return (
    <>
      <section
        className="card"
        style={{
          marginTop: 'var(--spacing-3)',
          borderLeft: '4px solid var(--accent-500, #c45c26)',
        }}
      >
        <h2 className="card__title" style={{ fontSize: '1.05rem' }}>
          Operation sign-off
        </h2>
        {pending ? (
          <div>
            <p>
              <strong>Sign-off requested</strong>
              {apiOp.signoffRequestedAt ? ` · ${formatDateTimeDisplay(apiOp.signoffRequestedAt)}` : ''}
              {apiOp.signoffRequestedByUsername ? ` · ${apiOp.signoffRequestedByUsername}` : ''}
            </p>
            {apiOp.signoffRequestRemark ? (
              <p className="text-steel" style={{ marginTop: 'var(--spacing-1)' }}>
                Remark: {apiOp.signoffRequestRemark}
              </p>
            ) : null}
            <p className="text-steel" style={{ marginTop: 'var(--spacing-2)' }}>
              An approver with <strong>Approve operation sign-off</strong> on Loading / Unloading must sign off before the vessel appears under Ready to Sail on Clearance.
            </p>
            <div style={{ marginTop: 'var(--spacing-2)', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <Link to="/verification" className="btn btn--ghost btn--small">
                Open Clearance
              </Link>
            </div>
            {!showApproveCta ? (
              <p className="text-steel" style={{ marginTop: 'var(--spacing-2)' }}>
                You do not have approval permission for this action.
              </p>
            ) : null}
          </div>
        ) : (
          <div>
            <p className="text-steel" style={{ marginBottom: 'var(--spacing-2)' }}>
              Post-checking and earlier stages are complete. Request sign-off to hand the operation to an approver; after approval the vessel will appear on Clearance (Ready to Sail).
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <button type="button" className="btn btn--primary" onClick={() => { setErr(null); setRequestOpen(true) }}>
                Request operation sign-off
              </button>
              <Link to="/verification" className="btn btn--ghost btn--small">
                Clearance
              </Link>
            </div>
          </div>
        )}
      </section>

      {requestOpen && (
        <div className="modal-overlay" onClick={() => !busy && setRequestOpen(false)} aria-hidden="true">
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="signoff-req-title"
          >
            <h2 id="signoff-req-title" className="modal__title">
              Request operation sign-off
            </h2>
            <p className="text-steel">
              This notifies approvers. The operation must still meet completion rules (e.g. completion 100%, QC) — the server will reject the request if not eligible. If this vessel call has more than one shipping instruction, every instruction must be ready for sign-off before the request is accepted.
            </p>
            <div className="modal__section">
              <label htmlFor="signoff-req-remark" className="modal__label">
                Remark (optional)
              </label>
              <textarea
                id="signoff-req-remark"
                className="modal__textarea"
                rows={3}
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                maxLength={MAX_REMARK_CHARS}
                disabled={busy}
              />
            </div>
            {err ? <p style={{ color: 'var(--danger-600, #c00)' }}>{err}</p> : null}
            <div className="modal__footer" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button type="button" className="btn btn--secondary" onClick={() => setRequestOpen(false)} disabled={busy}>
                Cancel
              </button>
              <button type="button" className="btn btn--primary" onClick={submitRequest} disabled={busy}>
                {busy ? 'Submitting…' : 'Submit request'}
              </button>
            </div>
          </div>
        </div>
      )}

    </>
  )
}

function VesselDetailCard({ detail }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <section className="berthing-modal__card loading-tab-card loading-card--collapsible vessel-detail-card">
      <button
        type="button"
        className="loading-card__header"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="berthing-modal__card-title">Vessel Detail</span>
        <span className="loading-card__chevron" aria-hidden>{expanded ? '▼' : '▶'}</span>
      </button>
      {expanded && (
        <dl className="allocation-detail__grid">
          <dt>Vessel Name</dt>
          <dd>{detail.vesselName || '—'}</dd>
          <dt>Shipping Instruction</dt>
          <dd>{detail.shippingInstruction || '—'}</dd>
          <dt>No PKK</dt>
          <dd>{detail.noPkk ?? '—'}</dd>
          <dt>Priority</dt>
          <dd>{detail.priority || '—'}</dd>
          <dt>Number of Palka</dt>
          <dd>{detail.numberOfPalka ?? '—'}</dd>
          <dt>Purpose</dt>
          <dd>{detail.purpose || '—'}</dd>
          <dt>Shipper</dt>
          <dd>{detail.shipper || '—'}</dd>
          <dt>Agent</dt>
          <dd>{detail.agent || '—'}</dd>
          <dt>Surveyor</dt>
          <dd>{detail.surveyor || '—'}</dd>
          <dt>Jetty</dt>
          <dd>{detail.jetty || '—'}</dd>
          <dt>ETA</dt>
          <dd>{formatDateTimeDisplay(detail.etaDateTime || detail.eta)}</dd>
          <dt>TA</dt>
          <dd>{formatDateTimeDisplay(detail.taDateTime)}</dd>
          <dt>ETB</dt>
          <dd>{formatDateTimeDisplay(detail.etbDateTime || detail.etb)}</dd>
          <dt>TB</dt>
          <dd>{formatDateTimeDisplay(detail.tbDateTime)}</dd>
          <dt>Remark</dt>
          <dd>{detail.remark || detail.remarks || '—'}</dd>
        </dl>
      )}
    </section>
  )
}

function Loading() {
  const { vesselId, section } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const isUnloading = location.pathname.startsWith('/unloading')
  const purpose = isUnloading ? 'Unloading' : 'Loading'
  const basePath = isUnloading ? '/unloading' : '/loading'
  const purposeLower = purpose.toLowerCase()
  const { t } = useTranslation('pages')
  const purposeLabel = isUnloading ? t('unloading') : t('loading')
  const operations = getAtBerthOperations(purpose)
  const {
    getSteps,
    setStepData,
    loadingOpsByVesselId,
    getLoadingOperation,
    addLoadingActivity,
    setOperationalMilestoneNa,
    getPreChecking,
    setPreCheckingSection,
    getPostChecking,
    setPostCheckingSection,
  } = useLoading()
  const { selectedPort } = usePortScope()
  const scheduleEntryTz = getScheduleEntryTimeZone()
  const [stepPhotos, setStepPhotos] = useState({})
  const [allocationDetailRow, setAllocationDetailRow] = useState(null)
  const [allocationQueue, setAllocationQueue] = useState([])

  const mockVessel = vesselId ? vessels[vesselId] : null
  const mockMatchesRoutePurpose = Boolean(mockVessel && mockVessel.purpose === purpose)
  const opNumericId = vesselId ? parseOperationIdFromRouteVesselId(vesselId) : null
  const shouldFetchOp = Boolean(vesselId && !mockMatchesRoutePurpose && opNumericId != null)

  const [apiOp, setApiOp] = useState(null)
  const [apiLoading, setApiLoading] = useState(false)
  const [apiError, setApiError] = useState(null)

  useEffect(() => {
    if (!vesselId || mockMatchesRoutePurpose) {
      setApiOp(null)
      setApiLoading(false)
      setApiError(null)
      return
    }
    if (opNumericId == null) {
      setApiOp(null)
      setApiLoading(false)
      setApiError(null)
      return
    }
    let cancelled = false
    setApiLoading(true)
    setApiError(null)
    fetchOperation(opNumericId)
      .then((op) => {
        if (cancelled) return
        setApiOp(op)
        setApiLoading(false)
      })
      .catch((e) => {
        if (cancelled) return
        setApiOp(null)
        setApiError(e?.message || 'Failed to load operation')
        setApiLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [vesselId, mockMatchesRoutePurpose, opNumericId])

  const apiPurpose = apiOp ? normalizeApiPurpose(apiOp.purpose) : null
  const purposeMismatch = Boolean(apiOp && apiPurpose !== purpose)
  const operationId = apiOp?.id ?? (shouldFetchOp ? opNumericId : null)

  const mergeApiOpPatch = useCallback((patch) => {
    if (patch == null || typeof patch !== 'object') return
    setApiOp((prev) => {
      if (!prev) return patch
      const next = { ...prev }
      for (const [k, v] of Object.entries(patch)) {
        // Do not let `undefined` wipe fields (e.g. `{ ...fullOp, ...partial }` from callers).
        if (v !== undefined) next[k] = v
      }
      return next
    })
  }, [])

  const resolvedCargoSiQty = useMemo(() => {
    const v = apiOp?.cargoSiQty ?? apiOp?.cargo_si_qty
    if (v == null || v === '') return null
    if (typeof v === 'number' && Number.isFinite(v)) return v
    const n = Number(String(v).trim().replace(/\s/g, '').replace(/,/g, '.'))
    return Number.isFinite(n) ? n : null
  }, [apiOp])

  const resolvedCargoSiMetricCode = apiOp?.cargoSiMetricCode ?? apiOp?.cargo_si_metric_code ?? null
  const resolvedCargoSiMetricName = apiOp?.cargoSiMetricName ?? apiOp?.cargo_si_metric_name ?? null

  /** Option A: stage counts stay "unknown" until persisted fetch has run (avoids misleading 0/n). */
  const [preCheckPersistHydrated, setPreCheckPersistHydrated] = useState(true)
  const [postCheckPersistHydrated, setPostCheckPersistHydrated] = useState(true)
  const [operationalPersistHydrated, setOperationalPersistHydrated] = useState(true)

  useEffect(() => {
    if (!operationId || mockMatchesRoutePurpose) {
      setPreCheckPersistHydrated(true)
      setPostCheckPersistHydrated(true)
      setOperationalPersistHydrated(true)
      return
    }
    setPreCheckPersistHydrated(false)
    setPostCheckPersistHydrated(false)
    setOperationalPersistHydrated(false)
  }, [operationId, vesselId, mockMatchesRoutePurpose])

  const operationIdRef = useRef(operationId)
  operationIdRef.current = operationId

  const onPreCheckPersistHydrated = useCallback((loadedForOpId) => {
    if (loadedForOpId != null && loadedForOpId === operationIdRef.current) {
      setPreCheckPersistHydrated(true)
    }
  }, [])
  const onPostCheckPersistHydrated = useCallback((loadedForOpId) => {
    if (loadedForOpId != null && loadedForOpId === operationIdRef.current) {
      setPostCheckPersistHydrated(true)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    if (!operationId || !vesselId || mockMatchesRoutePurpose) return () => { cancelled = true }

    fetchSubProcesses(operationId, 'Post-Checking')
      .then((subRows) => {
        if (cancelled) return
        const rows = Array.isArray(subRows) ? subRows : []
        if (rows.length === 0) return

        const current = getPostChecking(vesselId) || {}
        const bySection = {
          finalInspection: { ...(current.finalInspection || {}) },
          finalCargoChecking: { ...(current.finalCargoChecking || {}) },
          finalSounding: { ...(current.finalSounding || {}) }, // legacy fallback only
        }
        const commodityType = apiOp?.commodityType === 'Solid' ? 'Solid' : 'Liquid'

        for (const row of rows) {
          const key = String(row?.subProcessKey || '').toLowerCase()
          if (key === 'final_inspection' || key === 'final_tank_inspection' || key === 'final_hold_inspection') {
            bySection.finalInspection = mergeFinalInspectionHydration(bySection.finalInspection || {}, row, commodityType)
            continue
          }
          if (key === 'final_sounding') {
            bySection.finalCargoChecking = mergeFinalCargoCheckingHydration(bySection.finalCargoChecking || {}, row, commodityType)
          }
        }

        Object.entries(bySection).forEach(([section, val]) => {
          if (!val || Object.keys(val).length === 0) return
          setPostCheckingSection(vesselId, section, val)
        })
      })
      .catch(() => {})
      .finally(() => {
        if (cancelled) return
        onPostCheckPersistHydrated(operationId)
      })

    return () => { cancelled = true }
  }, [
    operationId,
    vesselId,
    mockMatchesRoutePurpose,
    getPostChecking,
    setPostCheckingSection,
    onPostCheckPersistHydrated,
    apiOp?.commodityType,
  ])

  useEffect(() => {
    let cancelled = false
    if (!operationId || !vesselId || mockMatchesRoutePurpose) return () => { cancelled = true }

    fetchSubProcesses(operationId, 'Pre-Checking')
      .then((subRows) => {
        if (cancelled) return
        const rows = Array.isArray(subRows) ? subRows : []
        const current = getPreChecking(vesselId) || {}
        const bySection = {}

        for (const row of rows) {
          const section = PRECHECK_KEY_TO_SECTION[row.subProcessKey]
          if (!section) continue
          const cur = bySection[section] || current[section] || {}

          if (section === 'inspection') {
            bySection[section] = mergeInspectionHydration(cur, row)
            continue
          }
          if (section === 'initialCargoChecking') {
            bySection[section] = mergeInitialCargoHydration(cur, row)
            continue
          }

          const p = row.payload && typeof row.payload === 'object' ? row.payload : {}
          const next = {
            ...cur,
            remark: mergeDistinctLines(cur.remark, row.remark) || row.remark || cur.remark || '',
            status:
              precheckStatusRank(row.status) >= precheckStatusRank(cur.status) ? row.status || cur.status : cur.status,
            lastSavedAt: laterIso(row.updatedAt, cur.lastSavedAt),
          }
          if (row.startAt || row.occurredAt) {
            const st = isoOrDatetimeToLocal(row.startAt || row.occurredAt)
            if (st) next.startTime = next.startTime || st
          }
          if (row.endAt) {
            const en = isoOrDatetimeToLocal(row.endAt)
            if (en) next.endTime = next.endTime || en
          }
          if (section === 'sampling') {
            next.records = Array.isArray(p.records) ? p.records : cur.records || []
          }
          if (section === 'norAccepted') {
            if (p.norTenderedDateTime) {
              next.norTenderedDateTime = next.norTenderedDateTime || isoOrDatetimeToLocal(p.norTenderedDateTime)
            }
            if (p.norAcceptedDateTime) {
              next.norAcceptedDateTime = next.norAcceptedDateTime || isoOrDatetimeToLocal(p.norAcceptedDateTime)
            }
          }
          bySection[section] = next
        }

        const opTendered = isoOrDatetimeToLocal(apiOp?.norTenderedAt)
        const opAccepted = isoOrDatetimeToLocal(apiOp?.norAcceptedAt)
        const norCurrent = bySection.norAccepted || current.norAccepted || {}
        bySection.norAccepted = {
          ...norCurrent,
          norTenderedDateTime: opTendered || norCurrent.norTenderedDateTime || '',
          norAcceptedDateTime: opAccepted || norCurrent.norAcceptedDateTime || '',
        }

        Object.entries(bySection).forEach(([section, val]) => {
          if (!val || Object.keys(val).length === 0) return
          setPreCheckingSection(vesselId, section, val)
        })
      })
      .catch(() => {})
      .finally(() => {
        if (cancelled) return
        onPreCheckPersistHydrated(operationId)
      })

    return () => { cancelled = true }
  }, [
    operationId,
    vesselId,
    mockMatchesRoutePurpose,
    getPreChecking,
    setPreCheckingSection,
    onPreCheckPersistHydrated,
    apiOp?.norTenderedAt,
    apiOp?.norAcceptedAt,
  ])

  const { canEdit, canApprove } = useRbac()
  const canEditLoading = canEdit('loading')
  const canApproveLoading = canApprove('loading')

  const [activityLogRefresh, setActivityLogRefresh] = useState(0)
  const bumpActivityLogRefresh = useCallback(() => setActivityLogRefresh((x) => x + 1), [])

  useEffect(() => {
    if (activityLogRefresh === 0) return
    if (!vesselId || mockMatchesRoutePurpose || opNumericId == null) return
    let cancelled = false
    fetchOperation(opNumericId)
      .then((op) => {
        if (cancelled) return
        setApiOp(op)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [activityLogRefresh, vesselId, mockMatchesRoutePurpose, opNumericId])

  const [apiOperationalVm, setApiOperationalVm] = useState({ activities: [], naByLabel: {} })
  useEffect(() => {
    let cancelled = false
    if (!operationId) {
      setApiOperationalVm({ activities: [], naByLabel: {} })
      setOperationalPersistHydrated(true)
      return () => { cancelled = true }
    }
    setOperationalPersistHydrated(false)
    fetchOperationalActivities(operationId)
      .then((res) => {
        if (cancelled) return
        setApiOperationalVm(viewModelFromOperationalEntries(res?.entries || [], purpose))
      })
      .catch(() => {
        if (cancelled) return
        setApiOperationalVm({ activities: [], naByLabel: {} })
      })
      .finally(() => {
        if (cancelled) return
        setOperationalPersistHydrated(true)
      })
    return () => { cancelled = true }
  }, [operationId, purpose, activityLogRefresh])

  const allStagesComplete = useMemo(
    () =>
      computeAllStagesComplete({
        vesselId,
        purpose,
        operationId,
        apiOperationalVm,
        getPreChecking,
        getPostChecking,
        getLoadingOperation,
      }),
    [vesselId, purpose, operationId, apiOperationalVm, getPreChecking, getPostChecking, getLoadingOperation]
  )

  useEffect(() => {
    if (!vesselId) return
    const done = operationId
      ? operationalMilestoneDoneCount(purpose, apiOperationalVm.activities, apiOperationalVm.naByLabel)
      : (() => {
        const milestoneList = purpose === 'Unloading' ? UNLOADING_ACTIVITY_CATEGORIES : LOADING_ACTIVITY_CATEGORIES
        const raw =
          loadingOpsByVesselId[vesselId] ??
          initialLoadingOperationByVesselId[vesselId] ??
          { activities: [], milestoneNa: {} }
        const activities = raw.activities || []
        const na = raw.milestoneNa || {}
        return milestoneList.filter((cat) => {
          if (na[cat]?.reason) return true
          return activities.some((a) => a.category === cat)
        }).length
      })()
    const milestoneList = purpose === 'Unloading' ? UNLOADING_ACTIVITY_CATEGORIES : LOADING_ACTIVITY_CATEGORIES
    let status = 'not_started'
    if (done >= milestoneList.length) status = 'completed'
    else if (done > 0) status = 'in_progress'
    setStepData(vesselId, 'B', { status })
  }, [vesselId, purpose, loadingOpsByVesselId, setStepData, operationId, apiOperationalVm])

  const vessel = useMemo(() => {
    if (mockMatchesRoutePurpose) return mockVessel
    if (apiOp && !purposeMismatch) {
      return {
        id: vesselId,
        vesselName: apiOp.vesselName || '—',
        siId: apiOp.referenceNumber || (apiOp.shippingInstructionId != null ? `SI-${apiOp.shippingInstructionId}` : '—'),
        product: apiOp.commodity || '—',
        purpose: apiPurpose,
      }
    }
    return null
  }, [mockMatchesRoutePurpose, mockVessel, apiOp, purposeMismatch, vesselId, apiPurpose])

  const cargoForTabs = useMemo(() => {
    if (!vesselId) return null
    const mockCargo = getLoadingOperationCargo(vesselId)
    if (mockCargo) return mockCargo
    return cargoFromApiOp(apiOp)
  }, [vesselId, apiOp])

  useEffect(() => {
    let cancelled = false
    if (!operationId) {
      setAllocationDetailRow(null)
      return () => { cancelled = true }
    }
    fetchAllocationOverview()
      .then((res) => {
        if (cancelled) return
        const q = Array.isArray(res?.queue) ? res.queue : []
        const row = q.find((x) => Number(x.operationId) === Number(operationId)) || null
        setAllocationDetailRow(row)
        setAllocationQueue(q)
      })
      .catch(() => {
        if (cancelled) return
        setAllocationDetailRow(null)
        setAllocationQueue([])
      })
    return () => { cancelled = true }
  }, [operationId, activityLogRefresh])

  const vesselDetail = useMemo(() => {
    const fallback = {
      vesselName: vessel?.vesselName || '—',
      shippingInstruction: vessel?.siId || '—',
      noPkk: '—',
      priority: '—',
      numberOfPalka: vessel?.numberOfPalkas ?? '—',
      purpose: purpose,
      shipper: cargoForTabs?.shipper || '—',
      agent: cargoForTabs?.agent || '—',
      surveyor: cargoForTabs?.surveyor || '—',
      jetty: cargoForTabs?.jettyName || '—',
      etaDateTime: null,
      taDateTime: null,
      etbDateTime: null,
      tbDateTime: null,
      remark: '—',
    }
    if (!allocationDetailRow) return fallback
    return {
      ...fallback,
      vesselName: allocationDetailRow.vesselName || fallback.vesselName,
      shippingInstruction: allocationDetailRow.shippingInstruction || fallback.shippingInstruction,
      noPkk: allocationDetailRow.noPkk ?? fallback.noPkk,
      priority: allocationDetailRow.priority || fallback.priority,
      numberOfPalka: allocationDetailRow.numberOfPalka ?? fallback.numberOfPalka,
      purpose: allocationDetailRow.purpose || fallback.purpose,
      shipper: allocationDetailRow.shipper || fallback.shipper,
      agent: allocationDetailRow.agent || fallback.agent,
      surveyor: allocationDetailRow.surveyor || fallback.surveyor,
      jetty: allocationDetailRow.jetty || fallback.jetty,
      eta: allocationDetailRow.eta || null,
      etaDateTime: allocationDetailRow.etaDateTime || null,
      taDateTime: allocationDetailRow.taDateTime || null,
      etb: allocationDetailRow.etb || null,
      etbDateTime: allocationDetailRow.etbDateTime || null,
      tbDateTime: allocationDetailRow.tbDateTime || null,
      remark: allocationDetailRow.remark || allocationDetailRow.remarks || fallback.remark,
      remarks: allocationDetailRow.remarks || null,
    }
  }, [allocationDetailRow, vessel, cargoForTabs, purpose])

  const siblingOpsOnPlan = useMemo(() => {
    if (!apiOp?.shipmentPlanId || !allocationQueue.length) return []
    const pid = Number(apiOp.shipmentPlanId)
    if (Number.isNaN(pid)) return []
    return allocationQueue
      .filter((x) => x?.operationId != null && Number(x.shipmentPlanId) === pid)
      .sort((a, b) => Number(a.operationId) - Number(b.operationId))
  }, [apiOp?.shipmentPlanId, allocationQueue])

  /** Same shipment plan: peers not yet ready for sign-off (status from allocation queue). */
  const incompletePlanPeers = useMemo(() => {
    if (mockMatchesRoutePurpose) return []
    if (siblingOpsOnPlan.length <= 1) return []
    const terminal = new Set(['SIGNOFF_REQUESTED', 'SIGNOFF_APPROVED', 'POST_OPS'])
    return siblingOpsOnPlan.filter((row) => {
      if (Number(row.operationId) === Number(operationId)) return false
      const st = String(row.status || '')
      if (terminal.has(st)) return false
      return true
    })
  }, [mockMatchesRoutePurpose, siblingOpsOnPlan, operationId])

  const steps = vesselId ? getSteps(vesselId) : null
  const stepsOrInitial = steps ?? (vesselId ? initialLoadingStepsByVesselId[vesselId] : null) ?? (vesselId ? Object.fromEntries(LOADING_STEP_IDS.map((id) => [id, { status: 'not_started', startTime: '', endTime: '', quantityResult: null, documents: [] }])) : null)

  useEffect(() => {
    if (!vesselId || !steps) return
    const next = {}
    LOADING_STEP_IDS.forEach((stepId) => {
      const docs = steps[stepId]?.documents
      if (docs?.length) next[`${vesselId}-${stepId}`] = docs.map((d) => ({ url: d.url || '', name: d.name || 'File' }))
    })
    if (Object.keys(next).length) setStepPhotos((prev) => ({ ...prev, ...next }))
  }, [vesselId, steps])

  const handleSaveStep = useCallback(
    (stepId, data) => {
      if (!vesselId) return
      const docs = stepPhotos[`${vesselId}-${stepId}`] ?? []
      setStepData(vesselId, stepId, {
        ...data,
        status: data.status || 'completed',
        documents: docs.map((d) => ({ url: d.url, name: d.name })),
      })
    },
    [vesselId, setStepData, stepPhotos]
  )

  const addStepPhoto = useCallback((stepId, files) => {
    if (!vesselId) return
    const key = `${vesselId}-${stepId}`
    const newOnes = Array.from(files).map((file) => ({ url: URL.createObjectURL(file), name: file.name }))
    setStepPhotos((prev) => ({ ...prev, [key]: [...(prev[key] || []), ...newOnes] }))
  }, [vesselId])

  const c1Done = stepsOrInitial?.C1?.status === 'completed'
  const c2Done = stepsOrInitial?.C2?.status === 'completed'
  const canProceedToClearance = c1Done && c2Done

  // List: no vesselId
  if (!vesselId) {
    return (
      <div className="allocation-page loading-page">
        <h1 className="page-title">{purposeLabel}</h1>
        <p className="allocation-page__intro">{t('loadingPageListIntro', { purpose: purposeLower })}</p>
        <section className="card">
          <h2 className="card__title">{t('loadingOpsHeading', { purpose: purposeLabel })}</h2>
          {operations.length === 0 ? (
            <p className="text-steel">{t('loadingNoOps', { purpose: purposeLower })}</p>
          ) : (
            <ul className="loading-list">
              {operations.map((op) => (
                <li key={op.vesselId}>
                  <Link to={`${basePath}/${op.vesselId}`} className="loading-list__link">
                    <span className="loading-list__badge loading-list__badge--purpose" data-purpose={purpose}>{purpose}</span>
                    <span className="loading-list__main">
                      <span className="loading-list__name">{op.vesselName}</span>
                      <span className="loading-list__meta">SI: {op.siId} · {op.product}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    )
  }

  if (shouldFetchOp && apiLoading) {
    return (
      <div className="allocation-page loading-page">
        <h1 className="page-title">{purposeLabel}</h1>
        <p className="text-steel">{t('loadingOperationLoading')}</p>
        <Link to="/at-berth" className="loading-back-link">{t('loadingBackOverview')}</Link>
      </div>
    )
  }

  if (shouldFetchOp && apiError) {
    return (
      <div className="allocation-page loading-page">
        <h1 className="page-title">{purposeLabel}</h1>
        <p className="text-steel" style={{ color: 'var(--danger-600, #c00)' }}>
          {apiError}
        </p>
        <Link to="/at-berth" className="loading-back-link">{t('loadingBackOverview')}</Link>
      </div>
    )
  }

  if (purposeMismatch && apiOp) {
    const correctBase = apiPurpose === 'Unloading' ? '/unloading' : '/loading'
    const apiPurposeLabel = apiPurpose === 'Unloading' ? t('unloading') : t('loading')
    return (
      <div className="allocation-page loading-page">
        <h1 className="page-title">{purposeLabel}</h1>
        <p className="text-steel">
          <Trans
            ns="pages"
            i18nKey="loadingPurposeMismatch"
            values={{ apiPurpose: apiPurposeLabel }}
            components={{ bold: <strong /> }}
          />
        </p>
        <p>
          <Link to={`${correctBase}/${encodeURIComponent(vesselId)}`} className="btn btn--primary">
            {t('loadingGoToPurpose', { purpose: apiPurposeLabel })}
          </Link>
        </p>
        <Link to="/at-berth" className="loading-back-link">{t('loadingBackOverview')}</Link>
      </div>
    )
  }

  // Vessel not found
  if (!vessel) {
    return (
      <div className="allocation-page loading-page">
        <h1 className="page-title">{purposeLabel}</h1>
        <p className="text-steel">{t('loadingVesselNotFound')}</p>
        <Link to="/at-berth" className="loading-back-link">{t('loadingBackOverview')}</Link>
      </div>
    )
  }

  // Invalid section → redirect to hub
  if (section && !SECTIONS.some((s) => s.id === section)) {
    return <Navigate to={`${basePath}/${vesselId}`} replace />
  }

  // Hub: vesselId, no section → show 3 sub-page links
  if (!section) {
    return (
      <div className="allocation-page loading-page">
        <div style={{ marginBottom: 'var(--spacing-2)' }}>
          <Link to="/at-berth" className="loading-back-link">{t('loadingBackOverview')}</Link>
        </div>
        <h1 className="page-title page-title-row">
          <span>{purposeLabel}: {vessel.vesselName}</span>
          <FlowPill purpose={purpose} />
        </h1>
        {!mockMatchesRoutePurpose && siblingOpsOnPlan.length > 1 ? (
          <div className="loading-si-switcher">
            <label className="loading-si-switcher__label" htmlFor="loading-si-operation-select">
              Shipping instruction
            </label>
            <select
              id="loading-si-operation-select"
              className="loading-si-switcher__select"
              value={String(operationId ?? '')}
              onChange={(e) => {
                const nextId = e.target.value
                const path = section ? `${basePath}/op-${nextId}/${section}` : `${basePath}/op-${nextId}`
                navigate(path)
              }}
            >
              {siblingOpsOnPlan.map((row) => (
                <option key={row.operationId} value={String(row.operationId)}>
                  {row.shippingInstruction || row.jettyOperationCode || `Operation ${row.operationId}`}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <VesselDetailCard detail={vesselDetail} />

        {!mockMatchesRoutePurpose && operationId && apiOp ? (
          <OperationSignoffBanner
            apiOp={apiOp}
            operationId={operationId}
            allStagesComplete={allStagesComplete}
            incompletePlanPeers={incompletePlanPeers}
            basePath={basePath}
            canEditLoading={canEditLoading}
            canApproveLoading={canApproveLoading}
            onOperationUpdated={mergeApiOpPatch}
          />
        ) : null}

        <nav className="loading-section-tabs" aria-label="At-berth sections">
          {SECTIONS.map((sec) => (
            <Link
              key={sec.id}
              to={`${basePath}/${vesselId}/${sec.id}`}
              className={`loading-section-tabs__tab ${section === sec.id ? 'loading-section-tabs__tab--active' : ''}`}
            >
              {sec.label}
            </Link>
          ))}
        </nav>

        {canProceedToClearance && (
          <section className="card" style={{ marginTop: 'var(--spacing-4)' }}>
            <Link to="/verification" className="btn btn--primary">Proceed to Clearance →</Link>
          </section>
        )}
      </div>
    )
  }

  // Sub-page: Pre-Checking / Loading / Post-Checking
  const sectionConfig = SECTIONS.find((s) => s.id === section)
  const stepIds = sectionConfig?.stepIds ?? []
  const stagesObj = computeProcessStagesNumbers({
    purpose,
    preData: getPreChecking(vesselId) || {},
    postData: getPostChecking(vesselId) || {},
    apiOperationalVm,
    operationId,
    mockMatchesRoutePurpose,
    loadingOpProgress: vesselId ? getLoadingOperation(vesselId) : { activities: [], milestoneNa: {} },
    preCheckPersistHydrated,
    operationalPersistHydrated,
    postCheckPersistHydrated,
  })
  const processStages = [
    {
      id: 'pre-checking',
      label: 'Pre-Checking',
      done: stagesObj.pre.done,
      total: stagesObj.pre.total,
      countUnknown: stagesObj.pre.countUnknown,
    },
    {
      id: 'loading',
      label: 'Operational',
      done: stagesObj.operational.done,
      total: stagesObj.operational.total,
      countUnknown: stagesObj.operational.countUnknown,
    },
    {
      id: 'post-checking',
      label: 'Post-Checking',
      done: stagesObj.post.done,
      total: stagesObj.post.total,
      countUnknown: stagesObj.post.countUnknown,
    },
  ]

  return (
    <div className="allocation-page loading-page">
      <div style={{ marginBottom: 'var(--spacing-2)' }}>
        <Link to="/at-berth" className="loading-back-link">{t('loadingBackAtBerth')}</Link>
      </div>
      <h1 className="page-title page-title-row">
        <span>{sectionConfig?.label ?? section}: {vessel.vesselName}</span>
        <FlowPill purpose={purpose} />
      </h1>

      {!mockMatchesRoutePurpose && siblingOpsOnPlan.length > 1 ? (
        <div className="loading-si-switcher">
          <label className="loading-si-switcher__label" htmlFor="loading-si-operation-select-section">
            Shipping instruction
          </label>
          <select
            id="loading-si-operation-select-section"
            className="loading-si-switcher__select"
            value={String(operationId ?? '')}
            onChange={(e) => {
              const nextId = e.target.value
              navigate(`${basePath}/op-${nextId}/${section}`)
            }}
          >
            {siblingOpsOnPlan.map((row) => (
              <option key={row.operationId} value={String(row.operationId)}>
                {row.shippingInstruction || row.jettyOperationCode || `Operation ${row.operationId}`}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <VesselDetailCard detail={vesselDetail} />

      <StageTabs processStages={processStages} section={section} basePath={basePath} vesselId={vesselId} />

      {!mockMatchesRoutePurpose && operationId && apiOp ? (
        <OperationSignoffBanner
          apiOp={apiOp}
          operationId={operationId}
          allStagesComplete={allStagesComplete}
          incompletePlanPeers={incompletePlanPeers}
          basePath={basePath}
          canEditLoading={canEditLoading}
          canApproveLoading={canApproveLoading}
          onOperationUpdated={mergeApiOpPatch}
        />
      ) : null}

      <div className="vessel-detail-modal__body loading-process-content">
        {section === 'pre-checking' && (
          <>
            <PreCheckingSections
              vesselId={vesselId}
              basePath={basePath}
              operationId={operationId}
              purpose={purpose}
              commodityType={apiOp?.commodityType === 'Solid' ? 'Solid' : 'Liquid'}
              operationNorTenderedAt={apiOp?.norTenderedAt ?? null}
              operationNorAcceptedAt={apiOp?.norAcceptedAt ?? null}
              operationDemurrageLiabilityFromAt={apiOp?.demurrageLiabilityFromAt ?? null}
              getPreChecking={getPreChecking}
              setPreCheckingSection={setPreCheckingSection}
              getArrivalNor={getArrivalNor}
              setArrivalNor={setArrivalNor}
              formatDateTimeDisplay={formatDateTimeDisplay}
              stageRailCollapsed={false}
              onActivityLogRefresh={bumpActivityLogRefresh}
              activityLogRefresh={activityLogRefresh}
              onPersistedHydrationDone={onPreCheckPersistHydrated}
              scheduleEntryTz={scheduleEntryTz}
            />
          </>
        )}

        {section === 'post-checking' && (
          <>
            <PostCheckingSections
              vesselId={vesselId}
              basePath={basePath}
              operationId={operationId}
              commodityType={apiOp?.commodityType === 'Solid' ? 'Solid' : 'Liquid'}
              getPostChecking={getPostChecking}
              setPostCheckingSection={setPostCheckingSection}
              formatDateTimeDisplay={formatDateTimeDisplay}
              stageRailCollapsed={false}
              onActivityLogRefresh={bumpActivityLogRefresh}
              activityLogRefresh={activityLogRefresh}
              onPersistedHydrationDone={onPostCheckPersistHydrated}
              scheduleEntryTz={scheduleEntryTz}
            />
          </>
        )}

        {section === 'loading' && stepIds.map((stepId) => {
          const loadingOp = getLoadingOperation(vesselId)
          return (
            <OperationalMilestoneWorkspace
              key={stepId}
              vesselId={vesselId}
              basePath={basePath}
              loadingOp={loadingOp}
              purpose={purpose}
              operationId={operationId}
              commodityType={apiOp?.commodityType === 'Solid' ? 'Solid' : 'Liquid'}
              cargoCommodity={apiOp?.commodity ?? null}
              cargoSiQty={resolvedCargoSiQty}
              cargoSiMetricCode={resolvedCargoSiMetricCode}
              cargoSiMetricName={resolvedCargoSiMetricName}
              addActivity={addLoadingActivity}
              setOperationalMilestoneNa={setOperationalMilestoneNa}
              onOperationalSaved={bumpActivityLogRefresh}
              activityLogRefresh={activityLogRefresh}
              scheduleIana={scheduleEntryTz}
            />
          )
        })}

        {section === 'post-checking' && canProceedToClearance && (
          <section className="card">
            <Link to="/verification" className="btn btn--primary">Proceed to Clearance →</Link>
          </section>
        )}
      </div>
    </div>
  )
}

function StageTabs({ processStages, section, basePath, vesselId }) {
  return (
    <nav className="loading-stage-tabs" aria-label="Process stages">
      {processStages.map((s) => {
        const unknown = Boolean(s.countUnknown)
        const done = Number(s.done) || 0
        const total = Number(s.total) || 0
        const statusClass = unknown ? 'not-started' : done >= total ? 'done' : done > 0 ? 'in-progress' : 'not-started'
        const countLabel = unknown ? `— / ${total}` : `${done} / ${total}`
        return (
        <Link
          key={s.id}
          to={`${basePath}/${vesselId}/${s.id}`}
          className={`loading-stage-tabs__tab loading-stage-tabs__tab--${statusClass} ${section === s.id ? 'loading-stage-tabs__tab--active' : ''}`}
          title={unknown ? `${s.label} (open tab to load progress)` : `${s.label} (${done}/${total} complete)`}
          aria-label={unknown ? `${s.label}, progress not loaded yet` : `${s.label} (${done} of ${total} complete)`}
        >
          <span className="loading-stage-tabs__topline">
            <span className={`loading-stage-tabs__dot loading-stage-tabs__dot--${statusClass}`} aria-hidden />
            <span className="loading-stage-tabs__label">{s.label}</span>
          </span>
          <span className="loading-stage-tabs__meta">
            {countLabel} complete
          </span>
        </Link>
        )
      })}
    </nav>
  )
}

function getPreCheckSubTabs(purpose) {
  const head = [
    { id: 'keyMeeting', label: 'KEY MEETING' },
    { id: 'norAccepted', label: 'NOR' },
  ]
  const inspection = purpose === 'Loading' ? [{ id: 'inspection', label: 'INSPECTION' }] : []
  const tail = [
    { id: 'sampling', label: 'SAMPLING' },
    { id: 'initialCargoChecking', label: 'INITIAL CARGO CHECKING' },
  ]
  return [...head, ...inspection, ...tail]
}

const PRECHECK_SHORT_CODE = {
  keyMeeting: 'KM',
  norAccepted: 'NOR',
  inspection: 'INSP',
  sampling: 'SAMP',
  initialCargoChecking: 'ICC',
}

const PRECHECK_RAIL_COLLAPSED_KEY = 'jps_precheck_section_rail_collapsed'

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

function mergeInitialCargoHydration(current, row) {
  const p = row.payload && typeof row.payload === 'object' ? row.payload : {}
  const typeFromKey =
    row.subProcessKey === 'initial_draft_survey'
      ? 'Draft Survey'
      : row.subProcessKey === 'initial_sounding'
        ? 'Sounding'
        : null
  const remarkResult = row.remark || p.result || ''
  const next = {
    ...current,
    remark: mergeDistinctLines(current.remark, remarkResult) || remarkResult || current.remark || '',
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
  next.cargoCheckingType = typeFromKey || p.cargoCheckingType || current.cargoCheckingType
  return next
}

function precheckStatusRank(s) {
  const x = String(s || '').trim()
  if (x === 'Done') return 3
  if (x === 'In Progress') return 2
  return 1
}

function mergeInspectionHydration(current, row) {
  const p = row.payload && typeof row.payload === 'object' ? row.payload : {}
  const typeFromKey =
    row.subProcessKey === 'hold_inspection' ? 'Hold' : row.subProcessKey === 'tank_inspection' ? 'Tank' : null
  const next = {
    ...current,
    remark: mergeDistinctLines(current.remark, row.remark) || row.remark || current.remark || '',
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

const POSTCHECK_RAIL_COLLAPSED_KEY = 'jps_postcheck_section_rail_collapsed'

const POSTCHECK_SHORT_CODE = {
  finalInspection: 'FIN',
  finalCargoChecking: 'FCC',
}

const POSTCHECK_SECTION_TO_KEY = {
  finalInspection: 'final_inspection',
  finalCargoChecking: 'final_sounding',
}

const POSTCHECK_KEY_TO_SECTION = {
  final_inspection: 'finalInspection',
  final_tank_inspection: 'finalInspection',
  final_hold_inspection: 'finalInspection',
  final_sounding: 'finalCargoChecking',
}

/** Edit-form labels per post-check section (read-only rows use simpler labels in situ). */
const POSTCHECK_RESULT_LABEL = {
  finalInspection: 'Final Inspection Result',
  finalCargoChecking: 'Final Cargo Checking Result',
}

const POSTCHECK_START_LABEL = {
  finalInspection: 'Final Inspection Start Time',
  finalCargoChecking: 'Final Cargo Checking Start Time',
}

const POSTCHECK_END_LABEL = {
  finalInspection: 'Final Inspection End Time',
  finalCargoChecking: 'Final Cargo Checking End Time',
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
    result: mergeDistinctLines(current.result, row.remark) || row.remark || current.result || '',
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
    result: mergeDistinctLines(current.result, row.remark) || row.remark || current.result || '',
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

function precheckDocumentHref(url) {
  if (url == null || url === '') return '#'
  const u = String(url)
  if (u.startsWith('blob:')) return u
  return resolveUploadUrl(u)
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

/** Same trash icon as Log arrival update → Notice of Readiness (Allocation.jsx) */
function NorTrashIcon() {
  return (
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
  )
}

/** Open in new tab (external link) */
function OpenDocumentIcon() {
  return (
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
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  )
}

/** Edit mode: pick files, list pending + saved; remove uses NOR modal trash icon */
function PrecheckDocumentsEdit({ sectionKey, documents, onAddFiles, onRemoveIndex, removingKey }) {
  const { openFilePreview } = useFilePreview()
  const list = documents || []
  return (
    <div className="berthing-modal__field">
      <label className="berthing-modal__label">Upload document</label>
      <label className="berthing-modal__file-zone">
        <span className="berthing-modal__file-zone-text">
          {list.length ? `${list.length} file(s) selected` : 'Choose files'}
        </span>
        <input
          type="file"
          multiple
          accept="image/*,.pdf"
          className="berthing-modal__file-input"
          onChange={(e) => {
            onAddFiles(e.target.files)
            e.target.value = ''
          }}
        />
      </label>
      {list.length > 0 && (
        <ul className="precheck-doc-list">
          {list.map((f, i) => (
            <li key={f.id != null ? `doc-${f.id}` : `local-${i}-${f.name}`} className="precheck-doc-list__item">
              <span className="precheck-doc-list__name">{f.name}</span>
              {f.url ? (
                <button
                  type="button"
                  className="berthing-modal__doc-open-btn"
                  title="Open document in new tab"
                  aria-label={`Open document: ${f.name || 'file'}`}
                  onClick={() => {
                    const href = precheckDocumentHref(f.url)
                    if (href && href !== '#') {
                      openFilePreview({ url: href, name: f.name, mimeType: f.mimeType ?? null })
                    }
                  }}
                >
                  <OpenDocumentIcon />
                </button>
              ) : null}
              <button
                type="button"
                className="berthing-modal__nor-delete-btn"
                title="Remove document"
                aria-label={`Remove document: ${f.name || 'file'}`}
                disabled={f.id != null && removingKey === `${sectionKey}-${f.id}`}
                onClick={() => onRemoveIndex(i)}
              >
                <NorTrashIcon />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** View mode: links only (no delete — use Edit to remove documents) */
function PrecheckDocumentsRead({ documents }) {
  const list = documents || []
  return (
    <div className="precheck-section__row precheck-section__row--block">
      <span className="precheck-section__label">Documents</span>
      <div className="precheck-section__value">
        {list.length === 0 ? (
          '—'
        ) : (
          <ul className="precheck-doc-list">
            {list.map((f, i) => (
              <li key={f.id ?? `rv-${i}-${f.name}`} className="precheck-doc-list__item">
                <FilePreviewLink
                  url={precheckDocumentHref(f.url)}
                  name={f.name}
                  mimeType={f.mimeType ?? null}
                  className="precheck-doc-list__link file-preview-link"
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/** Pre-Checking sections: KEY MEETING, NOR ACCEPTED, INSPECTION (Loading only), SAMPLING, INITIAL SOUNDING, INITIAL DRAFT SURVEY */
function PreCheckingSections({
  vesselId,
  basePath,
  operationId,
  purpose,
  commodityType = 'Liquid',
  operationNorTenderedAt,
  operationNorAcceptedAt,
  operationDemurrageLiabilityFromAt,
  getPreChecking,
  setPreCheckingSection,
  getArrivalNor,
  setArrivalNor,
  formatDateTimeDisplay,
  stageRailCollapsed,
  onActivityLogRefresh,
  activityLogRefresh = 0,
  onPersistedHydrationDone,
  scheduleEntryTz,
}) {
  const preCheckTabs = useMemo(() => getPreCheckSubTabs(purpose), [purpose])
  const [searchParams, setSearchParams] = useSearchParams()
  const [activeSubTab, setActiveSubTab] = useState('keyMeeting')
  const [listCollapsed, setListCollapsed] = useState(() => readBool(PRECHECK_RAIL_COLLAPSED_KEY, false))
  const [autoCollapseAfterSelect, setAutoCollapseAfterSelect] = useState(false)
  const [editingSection, setEditingSection] = useState(null)
  const [formModalOpen, setFormModalOpen] = useState(false)
  const [draft, setDraft] = useState(() => defaultPreCheckingSection())
  const [editingSamplingRecordId, setEditingSamplingRecordId] = useState(null)
  const [samplingForm, setSamplingForm] = useState({ noPalka: '', ffa: '', moisture: '' })
  const [loadingPersisted, setLoadingPersisted] = useState(false)
  const [persistError, setPersistError] = useState(null)
  const [savingSection, setSavingSection] = useState(null)
  const [saveSuccessMessage, setSaveSuccessMessage] = useState(null)
  const [removingDoc, setRemovingDoc] = useState(null)

  const data = getPreChecking(vesselId)
  const norFromArrival = getArrivalNor(vesselId)

  useEffect(() => {
    writeBool(PRECHECK_RAIL_COLLAPSED_KEY, listCollapsed)
  }, [listCollapsed])

  useEffect(() => {
    if (purpose === 'Unloading' && activeSubTab === 'inspection') {
      setActiveSubTab('keyMeeting')
    }
  }, [purpose, activeSubTab])

  const toggleList = () => {
    setListCollapsed((cur) => {
      const next = !cur
      // If user expands the list while in compact navigation mode, auto-collapse after selecting a step.
      if (cur === true && next === false && stageRailCollapsed) {
        setAutoCollapseAfterSelect(true)
      }
      return next
    })
  }

  const selectTab = (tabId) => {
    setActiveSubTab(tabId)
    if (autoCollapseAfterSelect) {
      setListCollapsed(true)
      setAutoCollapseAfterSelect(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    if (!operationId) {
      setLoadingPersisted(false)
      setPersistError(null)
      return () => { cancelled = true }
    }
    setLoadingPersisted(true)
    setPersistError(null)
    const opIdForFetch = operationId
    let shouldSignalPersistHydration = false
    Promise.all([
      fetchSubProcesses(operationId, 'Pre-Checking'),
      fetchNorDetails(operationId),
      fetchOperationDocuments(operationId, 'NOR').catch(() => []),
    ])
      .then(async ([subRows, nor, norDocsFromOperation]) => {
        if (cancelled) return
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
        Object.entries(bySection).forEach(([section, val]) => {
          if (section === 'norAccepted') return
          setPreCheckingSection(vesselId, section, { ...val, documents: docBySection[section] || [] })
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

        setArrivalNor(vesselId, {
          norTenderedDateTime:
            isoOrDatetimeToLocal(operationNorTenderedAt) || norFromSub.norTenderedDateTime || '',
          norAcceptedDateTime:
            isoOrDatetimeToLocal(operationNorAcceptedAt) || norFromSub.norAcceptedDateTime || '',
        })
        setPreCheckingSection(vesselId, 'norAccepted', {
          ...norFromSub,
          demurrageLiabilityFromDateTime:
            isoOrDatetimeToLocal(operationDemurrageLiabilityFromAt) ||
            norFromSub.demurrageLiabilityFromDateTime ||
            '',
          remark: nor?.remark ?? norFromSub.remark ?? '',
          documents: mergedNorDocs,
          sourceModule: inferredSource,
          lastSavedAt: laterIso(nor?.updatedAt, norFromSub.lastSavedAt),
        })
        shouldSignalPersistHydration = true
        if (!cancelled) setLoadingPersisted(false)
      })
      .catch((e) => {
        if (cancelled) return
        setPersistError(e?.message || 'Failed to load pre-checking data')
        setLoadingPersisted(false)
        shouldSignalPersistHydration = true
      })
      .finally(() => {
        if (opIdForFetch != null && shouldSignalPersistHydration) {
          onPersistedHydrationDone?.(opIdForFetch)
        }
      })
    return () => { cancelled = true }
  }, [
    operationId,
    vesselId,
    operationNorTenderedAt,
    operationNorAcceptedAt,
    operationDemurrageLiabilityFromAt,
    setArrivalNor,
    setPreCheckingSection,
    onPersistedHydrationDone,
    scheduleEntryTz,
  ])

  useEffect(() => {
    if (!saveSuccessMessage) return undefined
    const t = setTimeout(() => setSaveSuccessMessage(null), 6500)
    return () => clearTimeout(t)
  }, [saveSuccessMessage])

  const startEdit = (sectionKey) => {
    const current = getPreChecking(vesselId)
    const merged = { ...defaultPreCheckingSection(), ...current }
    if (sectionKey === 'norAccepted') {
      const nor = getArrivalNor(vesselId)
      merged.norAccepted = {
        ...(current.norAccepted || {}),
        norTenderedDateTime: nor.norTenderedDateTime || '',
        norAcceptedDateTime: nor.norAcceptedDateTime || '',
        demurrageLiabilityFromDateTime: current.norAccepted?.demurrageLiabilityFromDateTime ?? '',
        documents: current.norAccepted?.documents ?? [],
        remark: current.norAccepted?.remark ?? '',
      }
    }
    if (sectionKey === 'inspection') {
      const ti = current.tankInspection || {}
      const hi = current.holdInspection || {}
      const ins = current.inspection || {}
      merged.inspection = {
        ...ins,
        startTime: ins.startTime || ti.startTime || hi.startTime,
        endTime: ins.endTime || ti.endTime || hi.endTime,
        remark: ins.remark || [ti.remark, hi.remark].filter(Boolean).join('\n'),
        documents:
          ins.documents?.length ? ins.documents : [...(ti.documents || []), ...(hi.documents || [])],
        inspectionType: ins.inspectionType || (commodityType === 'Solid' ? 'Hold' : 'Tank'),
      }
    }
    if (sectionKey === 'initialCargoChecking') {
      const snd = current.initialSounding || {}
      const dr = current.initialDraftSurvey || {}
      const icc = current.initialCargoChecking || {}
      merged.initialCargoChecking = {
        ...icc,
        startTime: icc.startTime || snd.startTime || dr.startTime,
        endTime: icc.endTime || snd.endTime || dr.endTime,
        remark: icc.remark || [snd.remark, dr.remark].filter(Boolean).join('\n'),
        documents:
          icc.documents?.length ? icc.documents : [...(snd.documents || []), ...(dr.documents || [])],
        cargoCheckingType: icc.cargoCheckingType || (commodityType === 'Solid' ? 'Draft Survey' : 'Sounding'),
      }
    }
    if (sectionKey === 'sampling') {
      merged.sampling = { ...(current.sampling || {}), records: current.sampling?.records ?? [] }
      setSamplingForm({ noPalka: '', ffa: '', moisture: '' })
      setEditingSamplingRecordId(null)
    }
    setDraft(merged)
    setEditingSection(sectionKey)
  }

  useEffect(() => {
    const focus = searchParams.get('focus')
    if (!focus) return
    const tab =
      preCheckTabs.find((t) => t.id === focus) ||
      (focus === 'tankInspection' || focus === 'holdInspection'
        ? preCheckTabs.find((t) => t.id === 'inspection')
        : null) ||
      (focus === 'initialSounding' || focus === 'initialDraftSurvey'
        ? preCheckTabs.find((t) => t.id === 'initialCargoChecking')
        : null)
    if (!tab) return
    setActiveSubTab(tab.id)
    if (searchParams.get('edit') === '1') {
      queueMicrotask(() => startEdit(tab.id))
      setFormModalOpen(true)
    }
    const next = new URLSearchParams(searchParams)
    next.delete('focus')
    next.delete('edit')
    setSearchParams(next, { replace: true })
    // URL handoff only; startEdit reads latest context inside microtask
    // eslint-disable-next-line react-hooks/exhaustive-deps -- avoid re-running when startEdit identity changes every render
  }, [searchParams, setSearchParams, preCheckTabs])

  const buildSubProcessPayload = (sectionKey, sectionDraft) => {
    const startTime = sectionDraft?.startTime || sectionDraft?.dateTime || null
    const endTime = sectionDraft?.endTime || sectionDraft?.dateTime || null
    if (sectionKey === 'inspection') {
      const inspectionType = commodityType === 'Solid' ? 'Hold' : 'Tank'
      return {
        status: 'Done',
        occurredAt: startTime,
        startAt: startTime,
        endAt: endTime,
        remark: sectionDraft?.remark || '',
        payload: { inspectionType },
      }
    }
    if (sectionKey === 'sampling') {
      return {
        status: 'Done',
        occurredAt: startTime,
        startAt: startTime,
        endAt: endTime,
        remark: sectionDraft?.remark || '',
        payload: { records: sectionDraft?.records || [] },
      }
    }
    if (sectionKey === 'initialCargoChecking') {
      const cargoCheckingType = commodityType === 'Solid' ? 'Draft Survey' : 'Sounding'
      return {
        status: 'Done',
        occurredAt: startTime,
        startAt: startTime,
        endAt: endTime,
        remark: sectionDraft?.remark || sectionDraft?.result || '',
        payload: { cargoCheckingType },
      }
    }
    return {
      status: 'Done',
      occurredAt: startTime,
      startAt: startTime,
      endAt: endTime,
      remark: sectionDraft?.remark || '',
      payload: null,
    }
  }

  const saveSection = async (sectionKey, mode = 'final', goNext = false) => {
    const isDraft = mode === 'draft'
    const nextStatus = isDraft ? 'In Progress' : 'Done'
    setPersistError(null)
    setSaveSuccessMessage(null)
    setSavingSection(`${sectionKey}:${mode}`)
    if (sectionKey === 'norAccepted') {
      const toIsoOrNull = (raw) => {
        if (!raw) return null
        try {
          return normalizeForApi(raw, scheduleEntryTz)
        } catch {
          return null
        }
      }
      const norTenderedIso = toIsoOrNull(draft.norAccepted.norTenderedDateTime)
      const norAcceptedIso = toIsoOrNull(draft.norAccepted.norAcceptedDateTime)
      setArrivalNor(vesselId, {
        norTenderedDateTime: draft.norAccepted.norTenderedDateTime || '',
        norAcceptedDateTime: draft.norAccepted.norAcceptedDateTime || '',
      })
      let demurrageIso = null
      if (draft.norAccepted.demurrageLiabilityFromDateTime) {
        try {
          demurrageIso = normalizeForApi(draft.norAccepted.demurrageLiabilityFromDateTime, scheduleEntryTz)
        } catch {
          demurrageIso = null
        }
      }
      setPreCheckingSection(vesselId, 'norAccepted', {
        documents: draft.norAccepted.documents || [],
        remark: draft.norAccepted.remark || '',
        demurrageLiabilityFromDateTime: draft.norAccepted.demurrageLiabilityFromDateTime || '',
        status: nextStatus,
        sourceModule: 'nor_accepted_tab',
      })
      try {
        if (operationId) {
          await saveArrivalUpdateApi({
            operationId,
            norTenderedDateTime: norTenderedIso ?? '',
            norAcceptedDateTime: norAcceptedIso ?? '',
          })
          const norDet = await updateNorDetails(
            operationId,
            {
              remark: draft.norAccepted.remark || '',
              payload: {
                norStage: 'at_berth',
                norSource: 'nor_accepted_tab',
                updatedVia: 'loading.pre-checking.nor_accepted',
              },
              demurrageLiabilityFromAt: demurrageIso,
            },
            { scheduleIana: scheduleEntryTz }
          )
          const subNor = await upsertSubProcess(
            operationId,
            'nor_accepted',
            {
              phase: 'Pre-Checking',
              status: nextStatus,
              occurredAt: norAcceptedIso || norTenderedIso || null,
              startAt: norAcceptedIso || norTenderedIso || null,
              endAt: null,
              remark: draft.norAccepted.remark || '',
              payload: {
                norTenderedDateTime: norTenderedIso,
                norAcceptedDateTime: norAcceptedIso,
                saveMode: isDraft ? 'draft' : 'final',
              },
            },
            { scheduleIana: scheduleEntryTz }
          )
          const norLastSaved = laterIso(norDet?.updatedAt, subNor?.updatedAt)
          if (norLastSaved) {
            setPreCheckingSection(vesselId, 'norAccepted', {
              lastSavedAt: norLastSaved,
              demurrageLiabilityFromDateTime: draft.norAccepted.demurrageLiabilityFromDateTime || '',
            })
          }
          const pendingNorDocs = (draft.norAccepted.documents || []).filter((d) => d?.file)
          if (pendingNorDocs.length > 0) {
            const upload = await uploadOperationDocuments(operationId, 'NOR', pendingNorDocs.map((d) => d.file))
            const saved = Array.isArray(upload?.items)
              ? upload.items.map((x) => ({ id: x.id, name: x.name, url: x.url, source: 'nor_accepted_tab' }))
              : []
            setPreCheckingSection(vesselId, 'norAccepted', {
              documents: [
                ...(draft.norAccepted.documents || []).filter((d) => !d?.file),
                ...saved,
              ],
              remark: draft.norAccepted.remark || '',
              demurrageLiabilityFromDateTime: draft.norAccepted.demurrageLiabilityFromDateTime || '',
              status: nextStatus,
              sourceModule: 'nor_accepted_tab',
              ...(norLastSaved ? { lastSavedAt: norLastSaved } : {}),
            })
          }
        }
      } catch (e) {
        const msg =
          (e?.body && typeof e.body === 'object' && e.body.error) || e?.message || 'Failed to save NOR Accepted'
        setPersistError(msg)
        setSavingSection(null)
        return
      }
    } else {
      const sectionDraft = draft[sectionKey] || {}
      setPreCheckingSection(vesselId, sectionKey, { ...sectionDraft, status: nextStatus })
      try {
        if (operationId) {
          const subKey = PRECHECK_SECTION_TO_KEY[sectionKey]
          const payload = buildSubProcessPayload(sectionKey, sectionDraft)
          const sent = await upsertSubProcess(
            operationId,
            subKey,
            { phase: 'Pre-Checking', ...payload, status: nextStatus },
            { scheduleIana: scheduleEntryTz }
          )
          if (sent?.updatedAt) {
            setPreCheckingSection(vesselId, sectionKey, { lastSavedAt: sent.updatedAt })
          }
          const pendingDocs = (sectionDraft.documents || []).filter((d) => d?.file)
          if (pendingDocs.length > 0) {
            const upload = await uploadSubProcessDocuments(operationId, subKey, 'Pre-Checking', pendingDocs.map((d) => d.file))
            const saved = Array.isArray(upload?.items)
              ? upload.items.map((x) => ({ id: x.id, name: x.name, url: x.url }))
              : []
            setPreCheckingSection(vesselId, sectionKey, {
              ...sectionDraft,
              status: nextStatus,
              documents: [
                ...(sectionDraft.documents || []).filter((d) => !d?.file),
                ...saved,
              ],
              ...(sent?.updatedAt ? { lastSavedAt: sent.updatedAt } : {}),
            })
          }
        }
      } catch (e) {
        setPersistError(e?.message || `Failed to save ${sectionKey}`)
        setSavingSection(null)
        return
      }
    }
    setSavingSection(null)
    setEditingSection(null)
    const tabLabel = preCheckTabs.find((t) => t.id === sectionKey)?.label || sectionKey
    let successMsg = ''
    if (operationId) {
      if (isDraft) {
        successMsg = `${tabLabel} draft saved.`
      } else {
        successMsg = `${tabLabel} saved.`
      }
    } else {
      successMsg = isDraft
        ? `${tabLabel} draft saved on this device only. Open the vessel from At-Berth to sync to the server.`
        : `${tabLabel} saved on this device only. Open the vessel from At-Berth to sync to the server.`
    }
    if (goNext) {
      const idx = preCheckTabs.findIndex((t) => t.id === sectionKey)
      const next = preCheckTabs[idx + 1]
      if (next) {
        setActiveSubTab(next.id)
        if (operationId) {
          successMsg = isDraft
            ? `${tabLabel} draft saved. Next: ${next.label}.`
            : `${tabLabel} saved. Next: ${next.label}.`
        } else {
          successMsg = isDraft
            ? `${tabLabel} draft saved locally. Next: ${next.label}.`
            : `${tabLabel} saved locally. Next: ${next.label}.`
        }
      }
    }
    if (!goNext) setFormModalOpen(false)
    setSaveSuccessMessage(successMsg)
    if (operationId) onActivityLogRefresh?.()
  }

  const addSectionDocuments = (sectionKey, files) => {
    const newOnes = Array.from(files || []).map((f) => ({ name: f.name, url: URL.createObjectURL(f), file: f }))
    setDraft((prev) => ({
      ...prev,
      [sectionKey]: { ...(prev[sectionKey] || {}), documents: [...(prev[sectionKey]?.documents || []), ...newOnes] },
    }))
  }

  const removePrecheckDocumentAt = async (sectionKey, index) => {
    const subKey = PRECHECK_SECTION_TO_KEY[sectionKey]
    if (!subKey) return
    const docs = [...(draft[sectionKey]?.documents || [])]
    const doc = docs[index]
    if (!doc) return

    const revokeBlob = (d) => {
      if (d?.url && String(d.url).startsWith('blob:')) {
        try {
          URL.revokeObjectURL(d.url)
        } catch {
          /* ignore */
        }
      }
    }

    if (doc.file) {
      revokeBlob(doc)
      docs.splice(index, 1)
      setDraft((prev) => ({
        ...prev,
        [sectionKey]: { ...(prev[sectionKey] || {}), documents: docs },
      }))
      return
    }

    if (doc.id == null) {
      docs.splice(index, 1)
      setDraft((prev) => ({
        ...prev,
        [sectionKey]: { ...(prev[sectionKey] || {}), documents: docs },
      }))
      return
    }

    if (!window.confirm('Remove this document from the operation?')) return

    const rk = `${sectionKey}-${doc.id}`
    setRemovingDoc(rk)
    setPersistError(null)
    try {
      if (operationId) {
        if (sectionKey === 'norAccepted' && doc?.source !== 'precheck_subprocess') {
          await deleteOperationDocument(doc.id)
        } else {
          await deleteSubProcessDocument(operationId, subKey, doc.id, 'Pre-Checking')
        }
      }
      docs.splice(index, 1)
      setDraft((prev) => ({
        ...prev,
        [sectionKey]: { ...(prev[sectionKey] || {}), documents: docs },
      }))
      setPreCheckingSection(vesselId, sectionKey, { documents: docs })
    } catch (e) {
      setPersistError(e?.message || 'Failed to remove document')
    } finally {
      setRemovingDoc(null)
    }
  }

  const cancelEdit = () => {
    setEditingSection(null)
    setEditingSamplingRecordId(null)
    setSamplingForm({ noPalka: '', ffa: '', moisture: '' })
    setFormModalOpen(false)
  }

  const openFormModal = (tabId = activeSubTab) => {
    setActiveSubTab(tabId)
    startEdit(tabId)
    setFormModalOpen(true)
  }

  const samplingRecords = (editingSection === 'sampling' ? draft.sampling?.records : data.sampling?.records) ?? []
  const formatSamplingMetric = (value) => {
    if (value == null || value === '') return '—'
    const n = Number(value)
    if (Number.isNaN(n)) return String(value)
    return n.toFixed(2)
  }
  const samplingSummary = (() => {
    const rows = samplingRecords
      .map((r) => ({
        ffa: Number(r?.ffa),
        moisture: Number(r?.moisture),
      }))
      .filter((r) => Number.isFinite(r.ffa) || Number.isFinite(r.moisture))
    if (rows.length === 0) {
      return { count: samplingRecords.length, avgFfa: null, avgMoisture: null }
    }
    const ffaVals = rows.map((r) => r.ffa).filter((v) => Number.isFinite(v))
    const moistureVals = rows.map((r) => r.moisture).filter((v) => Number.isFinite(v))
    const avg = (vals) => (vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null)
    return {
      count: samplingRecords.length,
      avgFfa: avg(ffaVals),
      avgMoisture: avg(moistureVals),
    }
  })()

  const addSamplingRecord = () => {
    const { noPalka, ffa, moisture } = samplingForm
    if (!noPalka.trim()) return
    const id = `sampling-${Date.now()}-${Math.random().toString(36).slice(2)}`
    setDraft((prev) => ({
      ...prev,
      sampling: {
        ...prev.sampling,
        records: [...(prev.sampling?.records || []), { id, noPalka: noPalka.trim(), ffa: (ffa || '').trim(), moisture: (moisture || '').trim() }],
      },
    }))
    setSamplingForm({ noPalka: '', ffa: '', moisture: '' })
  }

  const startEditSamplingRecord = (record) => {
    setEditingSamplingRecordId(record.id)
    setSamplingForm({ noPalka: record.noPalka || '', ffa: record.ffa || '', moisture: record.moisture || '' })
  }

  const updateSamplingRecord = () => {
    if (!editingSamplingRecordId) return
    setDraft((prev) => ({
      ...prev,
      sampling: {
        ...prev.sampling,
        records: (prev.sampling?.records || []).map((r) =>
          r.id === editingSamplingRecordId ? { ...r, noPalka: samplingForm.noPalka.trim(), ffa: samplingForm.ffa.trim(), moisture: samplingForm.moisture.trim() } : r
        ),
      },
    }))
    setSamplingForm({ noPalka: '', ffa: '', moisture: '' })
    setEditingSamplingRecordId(null)
  }

  const cancelEditSamplingRecord = () => {
    setSamplingForm({ noPalka: '', ffa: '', moisture: '' })
    setEditingSamplingRecordId(null)
  }

  const deleteSamplingRecord = (id) => {
    if (!window.confirm('Delete this record?')) return
    setDraft((prev) => ({
      ...prev,
      sampling: { ...prev.sampling, records: (prev.sampling?.records || []).filter((r) => r.id !== id) },
    }))
    if (editingSamplingRecordId === id) {
      setSamplingForm({ noPalka: '', ffa: '', moisture: '' })
      setEditingSamplingRecordId(null)
    }
  }

  const updateDraft = (sectionKey, field, value) => {
    setDraft((prev) => ({
      ...prev,
      [sectionKey]: { ...(prev[sectionKey] || {}), [field]: value },
    }))
  }

  const stepStatuses = useMemo(() => {
    const map = {}
    preCheckTabs.forEach((t) => {
      map[t.id] = inferPrecheckStatus(t.id, data?.[t.id] || {})
    })
    return map
  }, [data, preCheckTabs])

  return (
    <div className="precheck-sections">
      {saveSuccessMessage && (
        <div
          className="toast toast--success"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <span className="toast__icon" aria-hidden>
            ✓
          </span>
          <p className="toast__message">{saveSuccessMessage}</p>
          <button
            type="button"
            className="toast__close"
            onClick={() => setSaveSuccessMessage(null)}
            aria-label="Dismiss notification"
          >
            ×
          </button>
        </div>
      )}
      {loadingPersisted && <p className="text-steel">Loading saved pre-checking data…</p>}
      {persistError && (
        <p className="text-steel" style={{ color: 'var(--danger-600, #c00)' }}>
          {persistError}
        </p>
      )}
      {savingSection && (
        <p className="text-steel">
          {savingSection.endsWith(':draft') ? 'Saving draft…' : 'Saving…'}
        </p>
      )}
      <div className="precheck-master-detail">
        <aside className={`precheck-master-detail__list ${listCollapsed ? 'precheck-master-detail__list--collapsed' : ''}`}>
          <div className="precheck-checklist-header">
            <span className="precheck-checklist-header__title">Pre‑Checking</span>
            <button
              type="button"
              className="btn btn--secondary btn--small loading-process-rail__collapse precheck-checklist-header__collapse"
              onClick={toggleList}
              aria-label={listCollapsed ? 'Expand sections navigation' : 'Collapse sections navigation'}
              title={listCollapsed ? 'Expand sections' : 'Collapse sections'}
            >
              <span className="rail-chevron" aria-hidden>
                {listCollapsed ? '›' : '‹'}
              </span>
            </button>
          </div>

          <div className={`precheck-checklist ${listCollapsed ? 'precheck-checklist--collapsed' : ''}`} role="tablist" aria-label="Pre-Checking sections">
            {preCheckTabs.map((tab) => {
              const status = String(stepStatuses[tab.id] || '').toLowerCase()
              const statusClass = status.replace(/\s+/g, '-')
              const code = PRECHECK_SHORT_CODE[tab.id] || tab.label.slice(0, 4)
              const title = `${tab.label} · ${stepStatuses[tab.id] || '—'}${data[tab.id]?.lastSavedAt ? ` · Last saved ${formatDateTimeDisplay(data[tab.id].lastSavedAt)}` : ''}`
              return (
                <div
                  key={tab.id}
                  className={`precheck-checklist__item ${activeSubTab === tab.id ? 'precheck-checklist__item--active' : ''}`}
                  title={title}
                >
                  {listCollapsed ? (
                    <button
                      type="button"
                      className="precheck-checklist__compact-btn"
                      onClick={() => selectTab(tab.id)}
                      aria-label={title}
                    >
                      <span className={`precheck-status-dot precheck-status-dot--${statusClass}`} aria-hidden />
                      <span className="precheck-checklist__code" aria-hidden>{code}</span>
                    </button>
                  ) : (
                    <>
                      <div className="precheck-checklist__left">
                        <div className="precheck-checklist__topline">
                          <span className="precheck-checklist__title">{tab.label}</span>
                          <span className={`precheck-checklist__status precheck-checklist__status--${statusClass}`}>
                            {stepStatuses[tab.id]}
                          </span>
                        </div>
                        {data[tab.id]?.lastSavedAt ? (
                          <span className="precheck-checklist__saved">
                            Last saved {formatDateTimeDisplay(data[tab.id].lastSavedAt)}
                          </span>
                        ) : null}
                      </div>
                      <button type="button" className="btn btn--small" onClick={() => openFormModal(tab.id)}>
                        Open
                      </button>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </aside>
        <div className="precheck-master-detail__panel" role="tabpanel" aria-label="Pre-Checking detail">
          <OperationActivityTimeline
            operationId={operationId}
            refreshToken={activityLogRefresh}
            vesselId={vesselId}
            basePath={basePath}
            onActivityLogRefresh={onActivityLogRefresh}
          />
          {formModalOpen ? (
            <div className="modal-overlay" onClick={cancelEdit} aria-hidden="true">
              <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Pre-Checking form">
      {activeSubTab === 'keyMeeting' && (
      <PreCheckSectionCard
        title="KEY MEETING"
        isEditing={editingSection === 'keyMeeting'}
        onEdit={() => startEdit('keyMeeting')}
        onSave={() => saveSection('keyMeeting', 'final')}
        onSaveDraft={() => saveSection('keyMeeting', 'draft')}
        onSaveNext={() => saveSection('keyMeeting', 'final', true)}
        onCancel={cancelEdit}
      >
        {editingSection === 'keyMeeting' ? (
          <>
            <div className="berthing-modal__field">
              <label className="berthing-modal__label">Start Time</label>
              <input
                type="datetime-local"
                className="berthing-modal__input"
                value={draft.keyMeeting?.startTime || ''}
                onChange={(e) => updateDraft('keyMeeting', 'startTime', e.target.value)}
              />
            </div>
            <div className="berthing-modal__field">
              <label className="berthing-modal__label">End Time</label>
              <input
                type="datetime-local"
                className="berthing-modal__input"
                value={draft.keyMeeting?.endTime || ''}
                onChange={(e) => updateDraft('keyMeeting', 'endTime', e.target.value)}
              />
            </div>
            <PrecheckDocumentsEdit
              sectionKey="keyMeeting"
              documents={draft.keyMeeting?.documents}
              onAddFiles={(files) => addSectionDocuments('keyMeeting', files)}
              onRemoveIndex={(i) => removePrecheckDocumentAt('keyMeeting', i)}
              removingKey={removingDoc}
            />
            <div className="berthing-modal__field">
              <label className="berthing-modal__label">Remark</label>
              <textarea
                className="berthing-modal__input berthing-modal__textarea"
                value={draft.keyMeeting?.remark || ''}
                onChange={(e) => updateDraft('keyMeeting', 'remark', e.target.value)}
                maxLength={MAX_REMARK_CHARS}
                rows={4}
                placeholder="Optional remark"
              />
            </div>
          </>
        ) : (
          <>
            <div className="precheck-section__row">
              <span className="precheck-section__label">Start Time</span>
              <span className="precheck-section__value">
                {data.keyMeeting?.startTime || data.keyMeeting?.dateTime
                  ? formatDateTimeDisplay(data.keyMeeting?.startTime || data.keyMeeting?.dateTime)
                  : '—'}
              </span>
            </div>
            <div className="precheck-section__row">
              <span className="precheck-section__label">End Time</span>
              <span className="precheck-section__value">
                {data.keyMeeting?.endTime ? formatDateTimeDisplay(data.keyMeeting.endTime) : '—'}
              </span>
            </div>
            <PrecheckDocumentsRead documents={data.keyMeeting?.documents} />
            <div className="precheck-section__row precheck-section__row--block">
              <span className="precheck-section__label">Remark</span>
              <span className="precheck-section__value">{data.keyMeeting?.remark || '—'}</span>
            </div>
          </>
        )}
      </PreCheckSectionCard>
      )}
      {activeSubTab === 'norAccepted' && (
      <PreCheckSectionCard
        title="NOR"
        isEditing={editingSection === 'norAccepted'}
        onEdit={() => startEdit('norAccepted')}
        onSave={() => saveSection('norAccepted', 'final')}
        onSaveDraft={() => saveSection('norAccepted', 'draft')}
        onSaveNext={() => saveSection('norAccepted', 'final', true)}
        onCancel={cancelEdit}
      >
        {editingSection === 'norAccepted' ? (
          <>
            <div className="berthing-modal__field">
              <label className="berthing-modal__label">Date &amp; Time (NOR Tendered)</label>
              <input
                type="datetime-local"
                className="berthing-modal__input"
                value={draft.norAccepted?.norTenderedDateTime ?? norFromArrival.norTenderedDateTime ?? ''}
                onChange={(e) => updateDraft('norAccepted', 'norTenderedDateTime', e.target.value)}
              />
            </div>
            <div className="berthing-modal__field">
              <label className="berthing-modal__label">Date &amp; Time (NOR Accepted)</label>
              <input
                type="datetime-local"
                className="berthing-modal__input"
                value={draft.norAccepted?.norAcceptedDateTime ?? norFromArrival.norAcceptedDateTime ?? ''}
                onChange={(e) => updateDraft('norAccepted', 'norAcceptedDateTime', e.target.value)}
              />
            </div>
            <div className="berthing-modal__field">
              <label className="berthing-modal__label">Laytime</label>
              <input
                type="datetime-local"
                className="berthing-modal__input"
                value={draft.norAccepted?.demurrageLiabilityFromDateTime ?? ''}
                onChange={(e) => updateDraft('norAccepted', 'demurrageLiabilityFromDateTime', e.target.value)}
              />
            </div>
            <PrecheckDocumentsEdit
              sectionKey="norAccepted"
              documents={draft.norAccepted?.documents}
              onAddFiles={(files) => addSectionDocuments('norAccepted', files)}
              onRemoveIndex={(i) => removePrecheckDocumentAt('norAccepted', i)}
              removingKey={removingDoc}
            />
            <div className="berthing-modal__field">
              <label className="berthing-modal__label">Remark</label>
              <textarea
                className="berthing-modal__input berthing-modal__textarea"
                value={draft.norAccepted?.remark || ''}
                onChange={(e) => updateDraft('norAccepted', 'remark', e.target.value)}
                maxLength={MAX_REMARK_CHARS}
                rows={4}
                placeholder="Optional remark"
              />
            </div>
          </>
        ) : (
          <>
            <div className="precheck-section__row">
              <span className="precheck-section__label">Date &amp; Time (NOR Tendered)</span>
              <span className="precheck-section__value">{norFromArrival.norTenderedDateTime ? formatDateTimeDisplay(norFromArrival.norTenderedDateTime) : '—'}</span>
            </div>
            <div className="precheck-section__row">
              <span className="precheck-section__label">Date &amp; Time (NOR Accepted)</span>
              <span className="precheck-section__value">{norFromArrival.norAcceptedDateTime ? formatDateTimeDisplay(norFromArrival.norAcceptedDateTime) : '—'}</span>
            </div>
            <div className="precheck-section__row">
              <span className="precheck-section__label">{term('laytime')}</span>
              <span className="precheck-section__value">
                {data.norAccepted?.demurrageLiabilityFromDateTime
                  ? formatDateTimeDisplay(data.norAccepted.demurrageLiabilityFromDateTime)
                  : '—'}
              </span>
            </div>
            <PrecheckDocumentsRead documents={data.norAccepted?.documents} />
            <div className="precheck-section__row precheck-section__row--block">
              <span className="precheck-section__label">Remark</span>
              <span className="precheck-section__value">{data.norAccepted?.remark || '—'}</span>
            </div>
            <div className="precheck-section__row">
              <span className="precheck-section__label">Last Updated Via</span>
              <span className="precheck-section__value">
                {data.norAccepted?.sourceModule === 'allocation_log_arrival'
                  ? 'Allocation & Berthing'
                  : data.norAccepted?.sourceModule === 'nor_accepted_tab'
                    ? 'NOR Accepted Tab'
                    : '—'}
              </span>
            </div>
          </>
        )}
      </PreCheckSectionCard>
      )}
      {activeSubTab === 'inspection' && (
      <PreCheckSectionCard
        title="INSPECTION"
        isEditing={editingSection === 'inspection'}
        onEdit={() => startEdit('inspection')}
        onSave={() => saveSection('inspection', 'final')}
        onSaveDraft={() => saveSection('inspection', 'draft')}
        onSaveNext={() => saveSection('inspection', 'final', true)}
        onCancel={cancelEdit}
      >
        {editingSection === 'inspection' ? (
          <>
            <div className="berthing-modal__field">
              <label className="berthing-modal__label">Inspection type</label>
              <input
                type="text"
                className="berthing-modal__input"
                readOnly
                value={commodityType === 'Solid' ? 'Hold' : 'Tank'}
                title="Derived from shipping instruction commodity type"
              />
            </div>
            <div className="berthing-modal__field">
              <label className="berthing-modal__label">Start Time</label>
              <input
                type="datetime-local"
                className="berthing-modal__input"
                value={draft.inspection?.startTime || ''}
                onChange={(e) => updateDraft('inspection', 'startTime', e.target.value)}
              />
            </div>
            <div className="berthing-modal__field">
              <label className="berthing-modal__label">End Time</label>
              <input
                type="datetime-local"
                className="berthing-modal__input"
                value={draft.inspection?.endTime || ''}
                onChange={(e) => updateDraft('inspection', 'endTime', e.target.value)}
              />
            </div>
            <PrecheckDocumentsEdit
              sectionKey="inspection"
              documents={draft.inspection?.documents}
              onAddFiles={(files) => addSectionDocuments('inspection', files)}
              onRemoveIndex={(i) => removePrecheckDocumentAt('inspection', i)}
              removingKey={removingDoc}
            />
            <div className="berthing-modal__field">
              <label className="berthing-modal__label">Remark</label>
              <textarea
                className="berthing-modal__input berthing-modal__textarea"
                value={draft.inspection?.remark || ''}
                onChange={(e) => updateDraft('inspection', 'remark', e.target.value)}
                maxLength={MAX_REMARK_CHARS}
                rows={4}
                placeholder="Optional remark"
              />
            </div>
          </>
        ) : (
          <>
            <div className="precheck-section__row">
              <span className="precheck-section__label">Inspection type</span>
              <span className="precheck-section__value">
                {data.inspection?.inspectionType || (commodityType === 'Solid' ? 'Hold' : 'Tank')}
              </span>
            </div>
            <div className="precheck-section__row">
              <span className="precheck-section__label">Start Time</span>
              <span className="precheck-section__value">
                {data.inspection?.startTime || data.inspection?.dateTime
                  ? formatDateTimeDisplay(data.inspection?.startTime || data.inspection?.dateTime)
                  : '—'}
              </span>
            </div>
            <div className="precheck-section__row">
              <span className="precheck-section__label">End Time</span>
              <span className="precheck-section__value">
                {data.inspection?.endTime ? formatDateTimeDisplay(data.inspection.endTime) : '—'}
              </span>
            </div>
            <PrecheckDocumentsRead documents={data.inspection?.documents} />
            <div className="precheck-section__row precheck-section__row--block">
              <span className="precheck-section__label">Remark</span>
              <span className="precheck-section__value">{data.inspection?.remark || '—'}</span>
            </div>
          </>
        )}
      </PreCheckSectionCard>
      )}
      {activeSubTab === 'sampling' && (
      <PreCheckSectionCard
        title="SAMPLING"
        isEditing={editingSection === 'sampling'}
        onEdit={() => startEdit('sampling')}
        onSave={() => saveSection('sampling', 'final')}
        onSaveDraft={() => saveSection('sampling', 'draft')}
        onSaveNext={() => saveSection('sampling', 'final', true)}
        onCancel={cancelEdit}
      >
        {editingSection === 'sampling' ? (
          <>
            <div className="berthing-modal__field">
              <label className="berthing-modal__label">Start Time</label>
              <input
                type="datetime-local"
                className="berthing-modal__input"
                value={draft.sampling?.startTime || ''}
                onChange={(e) => updateDraft('sampling', 'startTime', e.target.value)}
              />
            </div>
            <div className="berthing-modal__field">
              <label className="berthing-modal__label">End Time</label>
              <input
                type="datetime-local"
                className="berthing-modal__input"
                value={draft.sampling?.endTime || ''}
                onChange={(e) => updateDraft('sampling', 'endTime', e.target.value)}
              />
            </div>
            <PrecheckDocumentsEdit
              sectionKey="sampling"
              documents={draft.sampling?.documents}
              onAddFiles={(files) => addSectionDocuments('sampling', files)}
              onRemoveIndex={(i) => removePrecheckDocumentAt('sampling', i)}
              removingKey={removingDoc}
            />
            <div className="berthing-modal__field">
              <label className="berthing-modal__label">Remark</label>
              <textarea
                className="berthing-modal__input berthing-modal__textarea"
                value={draft.sampling?.remark || ''}
                onChange={(e) => updateDraft('sampling', 'remark', e.target.value)}
                maxLength={MAX_REMARK_CHARS}
                rows={4}
                placeholder="Optional remark"
              />
            </div>
            <section className="sampling-entry-block">
              <h4 className="sampling-entry-block__title">Sampling Entries (Per Palka)</h4>
              <div className="sampling-entry-block__grid">
                <div className="berthing-modal__field">
                  <label className="berthing-modal__label">No. Palka</label>
                  <input
                    type="text"
                    className="berthing-modal__input"
                    value={samplingForm.noPalka}
                    onChange={(e) => setSamplingForm((f) => ({ ...f, noPalka: e.target.value }))}
                    maxLength={MAX_SAMPLING_PALKA_FIELD_CHARS}
                    placeholder="e.g. 1P, 2P, 3P"
                  />
                </div>
                <div className="berthing-modal__field">
                  <label className="berthing-modal__label">(%), FFA</label>
                  <input
                    type="text"
                    className="berthing-modal__input"
                    value={samplingForm.ffa}
                    onChange={(e) => setSamplingForm((f) => ({ ...f, ffa: e.target.value }))}
                    maxLength={MAX_SAMPLING_PALKA_FIELD_CHARS}
                    placeholder="e.g. 4.91"
                  />
                </div>
                <div className="berthing-modal__field">
                  <label className="berthing-modal__label">(%), Moisture</label>
                  <input
                    type="text"
                    className="berthing-modal__input"
                    value={samplingForm.moisture}
                    onChange={(e) => setSamplingForm((f) => ({ ...f, moisture: e.target.value }))}
                    maxLength={MAX_SAMPLING_PALKA_FIELD_CHARS}
                    placeholder="e.g. 0.25"
                  />
                </div>
                <div className="sampling-entry-block__actions loading-step-card__actions">
                  {editingSamplingRecordId ? (
                    <>
                      <button type="button" className="btn btn--primary btn--small" onClick={updateSamplingRecord}>
                        Update
                      </button>
                      <button type="button" className="btn btn--small btn--secondary" onClick={cancelEditSamplingRecord}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="btn btn--primary btn--small"
                      onClick={addSamplingRecord}
                      title="Press Enter in field, then Add"
                    >
                      Add
                    </button>
                  )}
                </div>
              </div>
              <p className="sampling-entry-block__hint">Enter per-palka FFA and Moisture values, then add to the list.</p>
            </section>
            <div className="sampling-summary-chips" role="status" aria-live="polite">
              <span className="sampling-summary-chip">Total Palka sampled: {samplingSummary.count}</span>
              <span className="sampling-summary-chip">Avg FFA: {samplingSummary.avgFfa == null ? '—' : samplingSummary.avgFfa.toFixed(2)}</span>
              <span className="sampling-summary-chip">Avg Moisture: {samplingSummary.avgMoisture == null ? '—' : samplingSummary.avgMoisture.toFixed(2)}</span>
            </div>
            <div className="loading-detail-activity-table-wrap">
              <h4 className="sampling-entry-block__title sampling-entry-block__title--table">Recorded Samples</h4>
              <table className="loading-detail-activity-table">
                <thead>
                  <tr>
                    <th>No. Palka</th>
                    <th>(%), FFA</th>
                    <th>(%), Moisture</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {samplingRecords.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="loading-detail-activity-empty">
                        No sampling records yet. Add one above.
                      </td>
                    </tr>
                  ) : (
                    samplingRecords.map((rec) => (
                      <tr key={rec.id}>
                        <td>{rec.noPalka || '—'}</td>
                        <td className="sampling-cell--numeric">{formatSamplingMetric(rec.ffa)}</td>
                        <td className="sampling-cell--numeric">{formatSamplingMetric(rec.moisture)}</td>
                        <td>
                          <button type="button" className="btn btn--small" onClick={() => startEditSamplingRecord(rec)}>
                            Edit
                          </button>
                          <button type="button" className="btn btn--small btn--secondary" onClick={() => deleteSamplingRecord(rec.id)}>
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <>
            <div className="precheck-section__row">
              <span className="precheck-section__label">Start Time</span>
              <span className="precheck-section__value">
                {data.sampling?.startTime || data.sampling?.dateTime
                  ? formatDateTimeDisplay(data.sampling?.startTime || data.sampling?.dateTime)
                  : '—'}
              </span>
            </div>
            <div className="precheck-section__row">
              <span className="precheck-section__label">End Time</span>
              <span className="precheck-section__value">
                {data.sampling?.endTime ? formatDateTimeDisplay(data.sampling.endTime) : '—'}
              </span>
            </div>
            <PrecheckDocumentsRead documents={data.sampling?.documents} />
            <div className="precheck-section__row precheck-section__row--block">
              <span className="precheck-section__label">Remark</span>
              <span className="precheck-section__value">{data.sampling?.remark || '—'}</span>
            </div>
            <div className="sampling-summary-chips" role="status" aria-live="polite">
              <span className="sampling-summary-chip">Total Palka sampled: {samplingSummary.count}</span>
              <span className="sampling-summary-chip">Avg FFA: {samplingSummary.avgFfa == null ? '—' : samplingSummary.avgFfa.toFixed(2)}</span>
              <span className="sampling-summary-chip">Avg Moisture: {samplingSummary.avgMoisture == null ? '—' : samplingSummary.avgMoisture.toFixed(2)}</span>
            </div>
            {!samplingRecords.length ? (
              <p className="text-steel precheck-section__placeholder">No sampling records.</p>
            ) : (
              <div className="loading-detail-activity-table-wrap">
                <h4 className="sampling-entry-block__title sampling-entry-block__title--table">Sampling Entries</h4>
                <table className="loading-detail-activity-table">
                  <thead>
                    <tr>
                      <th>No. Palka</th>
                      <th>(%), FFA</th>
                      <th>(%), Moisture</th>
                    </tr>
                  </thead>
                  <tbody>
                    {samplingRecords.map((rec) => (
                      <tr key={rec.id}>
                        <td>{rec.noPalka || '—'}</td>
                        <td className="sampling-cell--numeric">{formatSamplingMetric(rec.ffa)}</td>
                        <td className="sampling-cell--numeric">{formatSamplingMetric(rec.moisture)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </PreCheckSectionCard>
      )}
      {activeSubTab === 'initialCargoChecking' && (
      <PreCheckSectionCard
        title="INITIAL CARGO CHECKING"
        isEditing={editingSection === 'initialCargoChecking'}
        onEdit={() => startEdit('initialCargoChecking')}
        onSave={() => saveSection('initialCargoChecking', 'final')}
        onSaveDraft={() => saveSection('initialCargoChecking', 'draft')}
        onSaveNext={() => saveSection('initialCargoChecking', 'final', true)}
        onCancel={cancelEdit}
      >
        {editingSection === 'initialCargoChecking' ? (
          <>
            <div className="berthing-modal__field">
              <label className="berthing-modal__label">Checking type</label>
              <input
                type="text"
                className="berthing-modal__input"
                readOnly
                value={commodityType === 'Solid' ? 'Draft Survey' : 'Sounding'}
                title="Derived from shipping instruction commodity type"
              />
            </div>
            <div className="berthing-modal__field">
              <label className="berthing-modal__label">Start Time</label>
              <input
                type="datetime-local"
                className="berthing-modal__input"
                value={draft.initialCargoChecking?.startTime || ''}
                onChange={(e) => updateDraft('initialCargoChecking', 'startTime', e.target.value)}
              />
            </div>
            <div className="berthing-modal__field">
              <label className="berthing-modal__label">End Time</label>
              <input
                type="datetime-local"
                className="berthing-modal__input"
                value={draft.initialCargoChecking?.endTime || ''}
                onChange={(e) => updateDraft('initialCargoChecking', 'endTime', e.target.value)}
              />
            </div>
            <PrecheckDocumentsEdit
              sectionKey="initialCargoChecking"
              documents={draft.initialCargoChecking?.documents}
              onAddFiles={(files) => addSectionDocuments('initialCargoChecking', files)}
              onRemoveIndex={(i) => removePrecheckDocumentAt('initialCargoChecking', i)}
              removingKey={removingDoc}
            />
            <div className="berthing-modal__field">
              <label className="berthing-modal__label">Remark</label>
              <textarea
                className="berthing-modal__input berthing-modal__textarea"
                value={draft.initialCargoChecking?.remark || ''}
                onChange={(e) => updateDraft('initialCargoChecking', 'remark', e.target.value)}
                maxLength={MAX_REMARK_CHARS}
                rows={4}
                placeholder="Optional remark"
              />
            </div>
          </>
        ) : (
          <>
            <div className="precheck-section__row">
              <span className="precheck-section__label">Checking type</span>
              <span className="precheck-section__value">
                {data.initialCargoChecking?.cargoCheckingType || (commodityType === 'Solid' ? 'Draft Survey' : 'Sounding')}
              </span>
            </div>
            <div className="precheck-section__row">
              <span className="precheck-section__label">Start Time</span>
              <span className="precheck-section__value">
                {data.initialCargoChecking?.startTime || data.initialCargoChecking?.dateTime
                  ? formatDateTimeDisplay(data.initialCargoChecking?.startTime || data.initialCargoChecking?.dateTime)
                  : '—'}
              </span>
            </div>
            <div className="precheck-section__row">
              <span className="precheck-section__label">End Time</span>
              <span className="precheck-section__value">
                {data.initialCargoChecking?.endTime ? formatDateTimeDisplay(data.initialCargoChecking.endTime) : '—'}
              </span>
            </div>
            <PrecheckDocumentsRead documents={data.initialCargoChecking?.documents} />
            <div className="precheck-section__row precheck-section__row--block">
              <span className="precheck-section__label">Remark</span>
              <span className="precheck-section__value">{data.initialCargoChecking?.remark || '—'}</span>
            </div>
          </>
        )}
      </PreCheckSectionCard>
      )}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function PreCheckSectionCard({ title, isEditing, onEdit, onSave, onSaveDraft, onSaveNext, onCancel, children }) {
  return (
    <section className={`precheck-section-card ${isEditing ? 'precheck-section-card--editing' : 'precheck-section-card--disabled'}`}>
      <h3 className="berthing-modal__card-title">{title}</h3>
      <div className="precheck-section-card__body">{children}</div>
      {!isEditing ? (
        <div className="precheck-section-card__actions precheck-section-card__actions--footer">
          <button type="button" className="btn btn--small" onClick={onEdit}>
            Edit
          </button>
        </div>
      ) : (
        <div className="precheck-section-card__actions precheck-section-card__actions--footer loading-step-card__actions">
          {onSaveDraft && (
            <button type="button" className="btn btn--small btn--soft" onClick={onSaveDraft}>
              Save Draft
            </button>
          )}
          <button type="button" className="btn btn--primary btn--small" onClick={onSave}>
            Save
          </button>
          {onSaveNext && (
            <button type="button" className="btn btn--primary btn--small" onClick={onSaveNext}>
              Save &amp; Next
            </button>
          )}
          <button type="button" className="btn btn--small btn--ghost" onClick={onCancel}>
            Cancel
          </button>
        </div>
      )}
    </section>
  )
}

/** Post-Checking: same shell as Pre-Checking (master-detail rail + `operation_sub_processes` when operationId). */
function PostCheckingSections({
  vesselId,
  basePath,
  operationId,
  commodityType = 'Liquid',
  getPostChecking,
  setPostCheckingSection,
  formatDateTimeDisplay,
  stageRailCollapsed,
  onActivityLogRefresh,
  activityLogRefresh = 0,
  onPersistedHydrationDone,
  scheduleEntryTz,
}) {
  const [searchParams, setSearchParams] = useSearchParams()
  const [activeSubTab, setActiveSubTab] = useState('finalInspection')
  const [listCollapsed, setListCollapsed] = useState(() => readBool(POSTCHECK_RAIL_COLLAPSED_KEY, false))
  const [autoCollapseAfterSelect, setAutoCollapseAfterSelect] = useState(false)
  const [editingSection, setEditingSection] = useState(null)
  const [formModalOpen, setFormModalOpen] = useState(false)
  const [draft, setDraft] = useState(() => defaultPostCheckingSection())
  const [loadingPersisted, setLoadingPersisted] = useState(false)
  const [persistError, setPersistError] = useState(null)
  const [savingSection, setSavingSection] = useState(null)
  const [saveSuccessMessage, setSaveSuccessMessage] = useState(null)
  const [removingDoc, setRemovingDoc] = useState(null)

  const data = getPostChecking(vesselId)

  useEffect(() => {
    writeBool(POSTCHECK_RAIL_COLLAPSED_KEY, listCollapsed)
  }, [listCollapsed])

  const toggleList = () => {
    setListCollapsed((cur) => {
      const next = !cur
      if (cur === true && next === false && stageRailCollapsed) {
        setAutoCollapseAfterSelect(true)
      }
      return next
    })
  }

  const selectTab = (tabId) => {
    setActiveSubTab(tabId)
    if (autoCollapseAfterSelect) {
      setListCollapsed(true)
      setAutoCollapseAfterSelect(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    if (!operationId) {
      setLoadingPersisted(false)
      setPersistError(null)
      return () => {
        cancelled = true
      }
    }
    setLoadingPersisted(true)
    setPersistError(null)
    const opIdForFetch = operationId
    let shouldSignalPersistHydration = false
    fetchSubProcesses(operationId, 'Post-Checking')
      .then(async (subRows) => {
        if (cancelled) return
        const rows = Array.isArray(subRows) ? subRows : []
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
        const bySection = {}
        loaded.forEach(({ row, section, docs }) => {
          const current = bySection[section] || {}
          if (section === 'finalInspection') {
            bySection[section] = mergeFinalInspectionHydration(current, row, commodityType)
          } else if (section === 'finalCargoChecking') {
            bySection[section] = mergeFinalCargoCheckingHydration(current, row, commodityType)
          } else {
            bySection[section] = {
              ...current,
              result: mergeDistinctLines(current.result, row.remark) || row.remark || current.result || '',
              status:
                precheckStatusRank(row.status) >= precheckStatusRank(current.status) ? row.status || current.status : current.status,
              lastSavedAt: laterIso(row.updatedAt, current.lastSavedAt),
              ...(row.startAt || row.occurredAt ? { startTime: current.startTime || isoOrDatetimeToLocal(row.startAt || row.occurredAt) } : {}),
              ...(row.endAt ? { endTime: current.endTime || isoOrDatetimeToLocal(row.endAt) } : {}),
            }
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
        Object.entries(bySection).forEach(([section, val]) => setPostCheckingSection(vesselId, section, val))
        shouldSignalPersistHydration = true
        if (!cancelled) setLoadingPersisted(false)
      })
      .catch((e) => {
        if (cancelled) return
        setPersistError(e?.message || 'Failed to load post-checking data')
        setLoadingPersisted(false)
        shouldSignalPersistHydration = true
      })
      .finally(() => {
        if (opIdForFetch != null && shouldSignalPersistHydration) {
          onPersistedHydrationDone?.(opIdForFetch)
        }
      })
    return () => {
      cancelled = true
    }
  }, [commodityType, operationId, vesselId, setPostCheckingSection, onPersistedHydrationDone])

  useEffect(() => {
    if (!saveSuccessMessage) return undefined
    const t = setTimeout(() => setSaveSuccessMessage(null), 6500)
    return () => clearTimeout(t)
  }, [saveSuccessMessage])

  const stepStatuses = useMemo(() => {
    const map = {}
    POST_CHECK_SUB_TABS.forEach((t) => {
      map[t.id] = inferPostcheckStatus(t.id, data?.[t.id] || {})
    })
    return map
  }, [data])

  const startEdit = (sectionKey) => {
    setDraft({ ...defaultPostCheckingSection(), ...getPostChecking(vesselId) })
    setEditingSection(sectionKey)
  }

  useEffect(() => {
    const focus = searchParams.get('focus')
    if (!focus) return
    const tab = POST_CHECK_SUB_TABS.find((t) => t.id === focus)
    if (!tab) return
    setActiveSubTab(focus)
    if (searchParams.get('edit') === '1') {
      queueMicrotask(() => startEdit(focus))
      setFormModalOpen(true)
    }
    const next = new URLSearchParams(searchParams)
    next.delete('focus')
    next.delete('edit')
    setSearchParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- URL handoff only
  }, [searchParams, setSearchParams])

  const updateDraft = (sectionKey, field, value) => {
    setDraft((prev) => ({
      ...prev,
      [sectionKey]: { ...(prev[sectionKey] || {}), [field]: value },
    }))
  }

  const addPostSectionDocuments = (sectionKey, files) => {
    const newOnes = Array.from(files || []).map((f) => ({ name: f.name, url: URL.createObjectURL(f), file: f }))
    setDraft((prev) => ({
      ...prev,
      [sectionKey]: { ...(prev[sectionKey] || {}), documents: [...(prev[sectionKey]?.documents || []), ...newOnes] },
    }))
  }

  const removePostDocumentAt = async (sectionKey, index) => {
    const subKey = POSTCHECK_SECTION_TO_KEY[sectionKey]
    if (!subKey) return
    const docs = [...(draft[sectionKey]?.documents || [])]
    const doc = docs[index]
    if (!doc) return

    const revokeBlob = (d) => {
      if (d?.url && String(d.url).startsWith('blob:')) {
        try {
          URL.revokeObjectURL(d.url)
        } catch {
          /* ignore */
        }
      }
    }

    if (doc.file) {
      revokeBlob(doc)
      docs.splice(index, 1)
      setDraft((prev) => ({
        ...prev,
        [sectionKey]: { ...(prev[sectionKey] || {}), documents: docs },
      }))
      return
    }

    if (doc.id == null) {
      docs.splice(index, 1)
      setDraft((prev) => ({
        ...prev,
        [sectionKey]: { ...(prev[sectionKey] || {}), documents: docs },
      }))
      return
    }

    if (!window.confirm('Remove this document from the operation?')) return

    const rk = `${sectionKey}-${doc.id}`
    setRemovingDoc(rk)
    setPersistError(null)
    try {
      if (operationId) {
        const targetSubKey = doc.subProcessKey || subKey
        await deleteSubProcessDocument(operationId, targetSubKey, doc.id, 'Post-Checking')
      }
      docs.splice(index, 1)
      setDraft((prev) => ({
        ...prev,
        [sectionKey]: { ...(prev[sectionKey] || {}), documents: docs },
      }))
      setPostCheckingSection(vesselId, sectionKey, { documents: docs })
    } catch (e) {
      setPersistError(e?.message || 'Failed to remove document')
    } finally {
      setRemovingDoc(null)
    }
  }

  const saveSection = async (sectionKey, mode = 'final', goNext = false) => {
    const isDraft = mode === 'draft'
    const nextStatus = isDraft ? 'In Progress' : 'Done'
    setPersistError(null)
    setSaveSuccessMessage(null)
    setSavingSection(`${sectionKey}:${mode}`)
    const sectionDraft = draft[sectionKey] || {}
    const finalInspectionType = commodityType === 'Solid' ? 'Hold' : 'Tank'
    const finalCargoCheckingType = commodityType === 'Solid' ? 'Draft Survey' : 'Sounding'
    const st = (sectionDraft?.startTime && String(sectionDraft.startTime).trim()) || ''
    const en = (sectionDraft?.endTime && String(sectionDraft.endTime).trim()) || ''
    const dt = (sectionDraft?.dateTime && String(sectionDraft.dateTime).trim()) || ''
    let occurredAt = null
    let startAt = null
    let endAt = null
    if (st || en || dt) {
      startAt = st || dt || null
      endAt = en || dt || null
      occurredAt = startAt
    }
    if (startAt && endAt) {
      let t0
      let t1
      try {
        t0 = new Date(normalizeForApi(startAt, scheduleEntryTz)).getTime()
        t1 = new Date(normalizeForApi(endAt, scheduleEntryTz)).getTime()
      } catch {
        t0 = NaN
        t1 = NaN
      }
      if (!Number.isNaN(t0) && !Number.isNaN(t1) && t1 < t0) {
        setPersistError('End time must be on or after start time.')
        setSavingSection(null)
        return
      }
    }
    setPostCheckingSection(vesselId, sectionKey, { ...sectionDraft, status: nextStatus })
    try {
      if (operationId) {
        const subKey = POSTCHECK_SECTION_TO_KEY[sectionKey]
        const sent = await upsertSubProcess(
          operationId,
          subKey,
          {
            phase: 'Post-Checking',
            status: nextStatus,
            occurredAt,
            startAt,
            endAt,
            remark: sectionDraft?.result || '',
            payload:
              sectionKey === 'finalInspection'
                ? { inspectionType: finalInspectionType }
                : sectionKey === 'finalCargoChecking'
                  ? { cargoCheckingType: finalCargoCheckingType }
                  : null,
          },
          { scheduleIana: scheduleEntryTz }
        )
        if (sent?.updatedAt) {
          setPostCheckingSection(vesselId, sectionKey, { lastSavedAt: sent.updatedAt })
        }
        const pendingDocs = (sectionDraft.documents || []).filter((d) => d?.file)
        if (pendingDocs.length > 0) {
          const upload = await uploadSubProcessDocuments(operationId, subKey, 'Post-Checking', pendingDocs.map((d) => d.file))
          const saved = Array.isArray(upload?.items)
            ? upload.items.map((x) => ({ id: x.id, name: x.name, url: x.url }))
            : []
          setPostCheckingSection(vesselId, sectionKey, {
            ...sectionDraft,
            status: nextStatus,
            ...(sectionKey === 'finalInspection' ? { inspectionType: finalInspectionType } : {}),
            ...(sectionKey === 'finalCargoChecking' ? { cargoCheckingType: finalCargoCheckingType } : {}),
            documents: [...(sectionDraft.documents || []).filter((d) => !d?.file), ...saved],
            ...(sent?.updatedAt ? { lastSavedAt: sent.updatedAt } : {}),
          })
        }
      }
    } catch (e) {
      setPersistError(e?.message || `Failed to save ${sectionKey}`)
      setSavingSection(null)
      return
    }
    setSavingSection(null)
    setEditingSection(null)
    const tabLabel = POST_CHECK_SUB_TABS.find((t) => t.id === sectionKey)?.label || sectionKey
    let successMsg = ''
    if (operationId) {
      successMsg = isDraft ? `${tabLabel} draft saved.` : `${tabLabel} saved.`
    } else {
      successMsg = isDraft
        ? `${tabLabel} draft saved on this device only. Open the vessel from At-Berth to sync to the server.`
        : `${tabLabel} saved on this device only. Open the vessel from At-Berth to sync to the server.`
    }
    if (goNext) {
      const idx = POST_CHECK_SUB_TABS.findIndex((t) => t.id === sectionKey)
      const next = POST_CHECK_SUB_TABS[idx + 1]
      if (next) {
        setActiveSubTab(next.id)
        successMsg = operationId
          ? isDraft
            ? `${tabLabel} draft saved. Next: ${next.label}.`
            : `${tabLabel} saved. Next: ${next.label}.`
          : isDraft
            ? `${tabLabel} draft saved locally. Next: ${next.label}.`
            : `${tabLabel} saved locally. Next: ${next.label}.`
      }
    }
    if (!goNext) setFormModalOpen(false)
    setSaveSuccessMessage(successMsg)
    if (operationId) onActivityLogRefresh?.()
  }

  const cancelEdit = () => {
    setEditingSection(null)
    setFormModalOpen(false)
  }

  const openFormModal = (tabId = activeSubTab) => {
    setActiveSubTab(tabId)
    startEdit(tabId)
    setFormModalOpen(true)
  }

  const renderSectionCard = (tab) => {
    const sectionKey = tab.id
    const isEditing = editingSection === sectionKey
    const resultL = POSTCHECK_RESULT_LABEL[sectionKey]
    const startL = POSTCHECK_START_LABEL[sectionKey]
    const endL = POSTCHECK_END_LABEL[sectionKey]
    return (
      <PreCheckSectionCard
        title={tab.label}
        isEditing={isEditing}
        onEdit={() => startEdit(sectionKey)}
        onSave={() => saveSection(sectionKey, 'final')}
        onSaveDraft={() => saveSection(sectionKey, 'draft')}
        onSaveNext={() => saveSection(sectionKey, 'final', true)}
        onCancel={cancelEdit}
      >
        {isEditing ? (
          <>
            {sectionKey === 'finalInspection' && (
              <div className="precheck-section__row">
                <span className="precheck-section__label">Inspection Type</span>
                <span className="precheck-section__value">{commodityType === 'Solid' ? 'Hold' : 'Tank'}</span>
              </div>
            )}
            {sectionKey === 'finalCargoChecking' && (
              <div className="precheck-section__row">
                <span className="precheck-section__label">Cargo Checking Type</span>
                <span className="precheck-section__value">{commodityType === 'Solid' ? 'Draft Survey' : 'Sounding'}</span>
              </div>
            )}
            <div className="berthing-modal__field">
              <label className="berthing-modal__label">{resultL}</label>
              <textarea
                className="berthing-modal__input berthing-modal__textarea"
                value={draft[sectionKey]?.result ?? ''}
                onChange={(e) => updateDraft(sectionKey, 'result', e.target.value)}
                maxLength={MAX_POSTCHECK_RESULT_CHARS}
                rows={4}
                placeholder="Enter result"
              />
            </div>
            <PrecheckDocumentsEdit
              sectionKey={sectionKey}
              documents={draft[sectionKey]?.documents}
              onAddFiles={(files) => addPostSectionDocuments(sectionKey, files)}
              onRemoveIndex={(i) => removePostDocumentAt(sectionKey, i)}
              removingKey={removingDoc}
            />
            <div className="berthing-modal__field">
              <label className="berthing-modal__label">{startL}</label>
              <input
                type="datetime-local"
                className="berthing-modal__input"
                value={draft[sectionKey]?.startTime ?? ''}
                onChange={(e) => updateDraft(sectionKey, 'startTime', e.target.value)}
              />
            </div>
            <div className="berthing-modal__field">
              <label className="berthing-modal__label">{endL}</label>
              <input
                type="datetime-local"
                className="berthing-modal__input"
                value={draft[sectionKey]?.endTime ?? ''}
                onChange={(e) => updateDraft(sectionKey, 'endTime', e.target.value)}
              />
            </div>
          </>
        ) : (
          <>
            {sectionKey === 'finalInspection' && (
              <div className="precheck-section__row">
                <span className="precheck-section__label">Inspection Type</span>
                <span className="precheck-section__value">
                  {data[sectionKey]?.inspectionType || (commodityType === 'Solid' ? 'Hold' : 'Tank')}
                </span>
              </div>
            )}
            {sectionKey === 'finalCargoChecking' && (
              <div className="precheck-section__row">
                <span className="precheck-section__label">Cargo Checking Type</span>
                <span className="precheck-section__value">
                  {data[sectionKey]?.cargoCheckingType || (commodityType === 'Solid' ? 'Draft Survey' : 'Sounding')}
                </span>
              </div>
            )}
            <div className="precheck-section__row precheck-section__row--block">
              <span className="precheck-section__label">{resultL}</span>
              <span className="precheck-section__value">{data[sectionKey]?.result || '—'}</span>
            </div>
            <PrecheckDocumentsRead documents={data[sectionKey]?.documents} />
            <div className="precheck-section__row">
              <span className="precheck-section__label">{startL}</span>
              <span className="precheck-section__value">
                {data[sectionKey]?.startTime || data[sectionKey]?.dateTime
                  ? formatDateTimeDisplay(data[sectionKey]?.startTime || data[sectionKey]?.dateTime)
                  : '—'}
              </span>
            </div>
            <div className="precheck-section__row">
              <span className="precheck-section__label">{endL}</span>
              <span className="precheck-section__value">
                {data[sectionKey]?.endTime ? formatDateTimeDisplay(data[sectionKey].endTime) : '—'}
              </span>
            </div>
          </>
        )}
      </PreCheckSectionCard>
    )
  }

  const activePostTab = POST_CHECK_SUB_TABS.find((t) => t.id === activeSubTab)

  return (
    <div className="precheck-sections">
      {saveSuccessMessage && (
        <div className="toast toast--success" role="status" aria-live="polite" aria-atomic="true">
          <span className="toast__icon" aria-hidden>
            ✓
          </span>
          <p className="toast__message">{saveSuccessMessage}</p>
          <button
            type="button"
            className="toast__close"
            onClick={() => setSaveSuccessMessage(null)}
            aria-label="Dismiss notification"
          >
            ×
          </button>
        </div>
      )}
      {loadingPersisted && <p className="text-steel">Loading saved post-checking data…</p>}
      {persistError && (
        <p className="text-steel" style={{ color: 'var(--danger-600, #c00)' }}>
          {persistError}
        </p>
      )}
      {savingSection && (
        <p className="text-steel">{savingSection.endsWith(':draft') ? 'Saving draft…' : 'Saving…'}</p>
      )}
      <div className="precheck-master-detail">
        <aside className={`precheck-master-detail__list ${listCollapsed ? 'precheck-master-detail__list--collapsed' : ''}`}>
          <div className="precheck-checklist-header">
            <span className="precheck-checklist-header__title">Post‑Checking</span>
            <button
              type="button"
              className="btn btn--secondary btn--small loading-process-rail__collapse precheck-checklist-header__collapse"
              onClick={toggleList}
              aria-label={listCollapsed ? 'Expand sections navigation' : 'Collapse sections navigation'}
              title={listCollapsed ? 'Expand sections' : 'Collapse sections'}
            >
              <span className="rail-chevron" aria-hidden>
                {listCollapsed ? '›' : '‹'}
              </span>
            </button>
          </div>
          <div
            className={`precheck-checklist ${listCollapsed ? 'precheck-checklist--collapsed' : ''}`}
            role="tablist"
            aria-label="Post-Checking sections"
          >
            {POST_CHECK_SUB_TABS.map((tab) => {
              const status = String(stepStatuses[tab.id] || '').toLowerCase()
              const statusClass = status.replace(/\s+/g, '-')
              const code = POSTCHECK_SHORT_CODE[tab.id] || tab.label.slice(0, 4)
              const title = `${tab.label} · ${stepStatuses[tab.id] || '—'}${
                data[tab.id]?.lastSavedAt ? ` · Last saved ${formatDateTimeDisplay(data[tab.id].lastSavedAt)}` : ''
              }`
              return (
                <div
                  key={tab.id}
                  className={`precheck-checklist__item ${activeSubTab === tab.id ? 'precheck-checklist__item--active' : ''}`}
                  title={title}
                >
                  {listCollapsed ? (
                    <button type="button" className="precheck-checklist__compact-btn" onClick={() => selectTab(tab.id)} aria-label={title}>
                      <span className={`precheck-status-dot precheck-status-dot--${statusClass}`} aria-hidden />
                      <span className="precheck-checklist__code" aria-hidden>{code}</span>
                    </button>
                  ) : (
                    <>
                      <div className="precheck-checklist__left">
                        <div className="precheck-checklist__topline">
                          <span className="precheck-checklist__title">{tab.label}</span>
                          <span className={`precheck-checklist__status precheck-checklist__status--${statusClass}`}>
                            {stepStatuses[tab.id]}
                          </span>
                        </div>
                        {data[tab.id]?.lastSavedAt ? (
                          <span className="precheck-checklist__saved">Last saved {formatDateTimeDisplay(data[tab.id].lastSavedAt)}</span>
                        ) : null}
                      </div>
                      <button type="button" className="btn btn--small" onClick={() => openFormModal(tab.id)}>
                        Open
                      </button>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </aside>
        <div className="precheck-master-detail__panel" role="tabpanel" aria-label="Post-Checking detail">
          <OperationActivityTimeline
            operationId={operationId}
            refreshToken={activityLogRefresh}
            vesselId={vesselId}
            basePath={basePath}
            onActivityLogRefresh={onActivityLogRefresh}
          />
          {formModalOpen ? (
            <div className="modal-overlay" onClick={cancelEdit} aria-hidden="true">
              <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Post-Checking form">
                {activePostTab ? renderSectionCard(activePostTab) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function LoadingStepCard({ stepId, config, step, vesselId, resultLabel, resultMultiline, onSave, stepPhotos, onAddPhoto }) {
  const [startTime, setStartTime] = useState(step.startTime || '')
  const [endTime, setEndTime] = useState(step.endTime || '')
  const [quantityResult, setQuantityResult] = useState(step.quantityResult ?? '')
  const [saved, setSaved] = useState(false)

  const handleSave = () => {
    onSave(stepId, {
      startTime: startTime || undefined,
      endTime: endTime || undefined,
      quantityResult: quantityResult || null,
      status: 'completed',
    })
    setSaved(true)
  }

  const statusClass = step.status === 'completed' ? 'loading-step-card--completed' : step.status === 'in_progress' ? 'loading-step-card--in-progress' : ''

  return (
    <section className={`berthing-modal__card loading-step-card ${statusClass}`}>
      <h3 className="berthing-modal__card-title">
        {config.label} · PIC: {config.pic}
      </h3>
      <div className="berthing-modal__form-section">
        <div className="berthing-modal__field">
          <label className="berthing-modal__label">Start time</label>
          <input
            type="datetime-local"
            className="berthing-modal__input"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
          />
        </div>
        <div className="berthing-modal__field">
          <label className="berthing-modal__label">End time</label>
          <input
            type="datetime-local"
            className="berthing-modal__input"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
          />
        </div>
        <div className="berthing-modal__field">
          <label className="berthing-modal__label">{resultLabel}</label>
          {resultMultiline ? (
            <textarea
              className="berthing-modal__input berthing-modal__textarea"
              value={quantityResult}
              onChange={(e) => setQuantityResult(e.target.value)}
              maxLength={MAX_POSTCHECK_RESULT_CHARS}
              placeholder="e.g. 2,750 MT"
              rows={4}
            />
          ) : (
            <input
              type="text"
              className="berthing-modal__input"
              value={quantityResult}
              onChange={(e) => setQuantityResult(e.target.value)}
              maxLength={MAX_POSTCHECK_RESULT_CHARS}
              placeholder="e.g. 2,750 MT"
            />
          )}
        </div>
        <div className="berthing-modal__field">
          <label className="berthing-modal__label">Document upload</label>
          <label className="berthing-modal__file-zone">
            <span className="berthing-modal__file-zone-text">
              {stepPhotos.length > 0 ? `${stepPhotos.length} file(s)` : 'Choose files'}
            </span>
            <input
              type="file"
              accept="image/*,.pdf"
              multiple
              onChange={(e) => onAddPhoto(e.target.files)}
              className="berthing-modal__file-input"
            />
          </label>
          {stepPhotos.length > 0 && (
            <ul className="loading-step-card__file-list" aria-label="Uploaded files">
              {stepPhotos.map((f, i) => (
                <li key={i}>{f.name || 'File'}</li>
              ))}
            </ul>
          )}
        </div>
        <div className="loading-step-card__actions">
          <button type="button" className="btn btn--primary btn--small" onClick={handleSave}>
            Save {config.label}
          </button>
          {saved && <span className="text-steel" style={{ marginLeft: 'var(--spacing-2)' }}>Saved</span>}
        </div>
      </div>
    </section>
  )
}

export default Loading
