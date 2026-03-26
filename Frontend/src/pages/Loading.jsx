import { useState, useCallback, useEffect, useMemo } from 'react'
import { Link, useParams, Navigate, useLocation } from 'react-router-dom'
import {
  vessels,
  getAtBerthOperations,
  LOADING_STEP_IDS,
  initialLoadingStepsByVesselId,
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
  fetchNorDetails,
  updateNorDetails,
} from '../api/operations'
import { resolveUploadUrl } from '../api/client'
import {
  fetchAllocationOverview,
  saveArrivalUpdate as saveArrivalUpdateApi,
  uploadOperationDocuments,
  fetchOperationDocuments,
  deleteOperationDocument,
} from '../api/allocation'
import { formatDateTimeDisplay } from '../utils/formatDateTimeDisplay'
import FlowPill from '../components/FlowPill'
import '../styles/allocation.css'

const STAGE_ICON = {
  'pre-checking': '📋',
  loading: '⚙️',
  'post-checking': '✅',
}

const STAGE_SHORT = {
  'pre-checking': 'Pre',
  loading: 'Ops',
  'post-checking': 'Post',
}

const LOADING_RAIL_COLLAPSED_KEY = 'jps_loading_stage_rail_collapsed'
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

function getNowForDateTimeLocal() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const h = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${day}T${h}:${min}`
}

/** API ISO or datetime-local prefix → `yyyy-mm-ddThh:mm` for inputs */
function isoOrDatetimeToLocal(value) {
  if (value == null || value === '') return ''
  const s = String(value).trim()
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return s.slice(0, 16)
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return ''
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const h = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${day}T${h}:${min}`
}

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

function inferPrecheckStatus(sectionKey, item = {}) {
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
  if (sectionKey === 'initialSounding' || sectionKey === 'initialDraftSurvey') {
    const hasResult = Boolean(String(item?.remark || item?.result || '').trim())
    const hasDate = Boolean(item?.dateTime)
    if (hasResult || hasDate) return 'Done'
    if (hasDocs || hasRemark) return 'In Progress'
    return 'Not Started'
  }
  const hasDate = Boolean(item?.dateTime)
  if (hasDate) return 'Done'
  if (hasDocs || hasRemark) return 'In Progress'
  return 'Not Started'
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

export default function Loading() {
  const { vesselId, section } = useParams()
  const location = useLocation()
  const isUnloading = location.pathname.startsWith('/unloading')
  const purpose = isUnloading ? 'Unloading' : 'Loading'
  const basePath = isUnloading ? '/unloading' : '/loading'
  const purposeLower = purpose.toLowerCase()
  const [stageRailCollapsed, setStageRailCollapsed] = useState(() => readBool(LOADING_RAIL_COLLAPSED_KEY, false))
  useEffect(() => writeBool(LOADING_RAIL_COLLAPSED_KEY, stageRailCollapsed), [stageRailCollapsed])
  const operations = getAtBerthOperations(purpose)
  const { getSteps, setStepData, getLoadingOperation, addLoadingActivity, updateLoadingActivity, deleteLoadingActivity, getPreChecking, setPreCheckingSection, getPostChecking, setPostCheckingSection } = useLoading()
  const [stepPhotos, setStepPhotos] = useState({})
  const [allocationDetailRow, setAllocationDetailRow] = useState(null)

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
      })
      .catch(() => {
        if (cancelled) return
        setAllocationDetailRow(null)
      })
    return () => { cancelled = true }
  }, [operationId])

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
        <h1 className="page-title">{purpose}</h1>
        <p className="allocation-page__intro">Select a {purposeLower} operation to record survey, quality check, quantity check, and final checks.</p>
        <section className="card">
          <h2 className="card__title">{purpose} operations</h2>
          {operations.length === 0 ? (
            <p className="text-steel">No {purposeLower} operations.</p>
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
        <h1 className="page-title">{purpose}</h1>
        <p className="text-steel">Loading operation…</p>
        <Link to="/at-berth" className="loading-back-link">← Back to Overview</Link>
      </div>
    )
  }

  if (shouldFetchOp && apiError) {
    return (
      <div className="allocation-page loading-page">
        <h1 className="page-title">{purpose}</h1>
        <p className="text-steel" style={{ color: 'var(--danger-600, #c00)' }}>
          {apiError}
        </p>
        <Link to="/at-berth" className="loading-back-link">← Back to Overview</Link>
      </div>
    )
  }

  if (purposeMismatch && apiOp) {
    const correctBase = apiPurpose === 'Unloading' ? '/unloading' : '/loading'
    return (
      <div className="allocation-page loading-page">
        <h1 className="page-title">{purpose}</h1>
        <p className="text-steel">
          This operation is <strong>{apiPurpose}</strong>. Open it under the correct section:
        </p>
        <p>
          <Link to={`${correctBase}/${encodeURIComponent(vesselId)}`} className="btn btn--primary">
            Go to {apiPurpose} →
          </Link>
        </p>
        <Link to="/at-berth" className="loading-back-link">← Back to Overview</Link>
      </div>
    )
  }

  // Vessel not found
  if (!vessel) {
    return (
      <div className="allocation-page loading-page">
        <h1 className="page-title">{purpose}</h1>
        <p className="text-steel">Vessel not found.</p>
        <Link to="/at-berth" className="loading-back-link">Back to Overview</Link>
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
          <Link to="/at-berth" className="loading-back-link">← Back to Overview</Link>
        </div>
        <h1 className="page-title page-title-row">
          <span>{purpose}: {vessel.vesselName}</span>
          <FlowPill purpose={purpose} />
        </h1>
        <VesselDetailCard detail={vesselDetail} />

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
  const preStepIds = ['keyMeeting', 'norAccepted', 'tankInspection', 'holdInspection', 'sampling', 'initialSounding', 'initialDraftSurvey']
  const preData = getPreChecking(vesselId)
  const preDone = preStepIds.filter((k) => inferPrecheckStatus(k, preData?.[k] || {}) === 'Done').length
  const operationalDone = stepsOrInitial?.B?.status === 'completed' ? 1 : 0
  const postDone = ['C1', 'C2'].filter((k) => stepsOrInitial?.[k]?.status === 'completed').length
  const processStages = [
    { id: 'pre-checking', label: 'Pre-Checking', done: preDone, total: preStepIds.length },
    { id: 'loading', label: 'Operational', done: operationalDone, total: 1 },
    { id: 'post-checking', label: 'Post-Checking', done: postDone, total: 2 },
  ]

  return (
    <div className="allocation-page loading-page">
      <div style={{ marginBottom: 'var(--spacing-2)' }}>
        <Link to={`${basePath}/${vesselId}`} className="loading-back-link">← Back to {vessel.vesselName}</Link>
      </div>
      <h1 className="page-title page-title-row">
        <span>{sectionConfig?.label ?? section}: {vessel.vesselName}</span>
        <FlowPill purpose={purpose} />
      </h1>

      <VesselDetailCard detail={vesselDetail} />

      <div className={`loading-process-layout ${stageRailCollapsed ? 'loading-process-layout--stage-collapsed' : ''}`}>
        <StageRailControlled
          processStages={processStages}
          section={section}
          basePath={basePath}
          vesselId={vesselId}
          collapsed={stageRailCollapsed}
          setCollapsed={setStageRailCollapsed}
        />

        <div className="vessel-detail-modal__body loading-process-content">
        {section === 'pre-checking' && (
          <>
            <PreCheckingSections
              vesselId={vesselId}
              operationId={operationId}
              operationNorTenderedAt={apiOp?.norTenderedAt ?? null}
              operationNorAcceptedAt={apiOp?.norAcceptedAt ?? null}
              getPreChecking={getPreChecking}
              setPreCheckingSection={setPreCheckingSection}
              getArrivalNor={getArrivalNor}
              setArrivalNor={setArrivalNor}
              formatDateTimeDisplay={formatDateTimeDisplay}
              stageRailCollapsed={stageRailCollapsed}
            />
          </>
        )}

        {section === 'post-checking' && (
          <>
            <PostCheckingSections
              vesselId={vesselId}
              getPostChecking={getPostChecking}
              setPostCheckingSection={setPostCheckingSection}
              formatDateTimeDisplay={formatDateTimeDisplay}
            />
          </>
        )}

        {section === 'loading' && stepIds.map((stepId) => {
          const loadingOp = getLoadingOperation(vesselId)
          return (
            <LoadingTabContent
              key={stepId}
              vesselId={vesselId}
              loadingOp={loadingOp}
              purpose={purpose}
              addActivity={addLoadingActivity}
              updateActivity={updateLoadingActivity}
              deleteActivity={deleteLoadingActivity}
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
    </div>
  )
}

function StageRail({ processStages, section, basePath, vesselId }) {
  // NOTE: collapse state is controlled by parent (so layout grid can reflow).
  return null
}

function StageRailControlled({ processStages, section, basePath, vesselId, collapsed, setCollapsed }) {
  useEffect(() => writeBool(LOADING_RAIL_COLLAPSED_KEY, collapsed), [collapsed])

  return (
    <aside className={`loading-process-rail ${collapsed ? 'loading-process-rail--collapsed' : ''}`} aria-label="Process stages">
      <div className="loading-process-rail__header">
        <span className="loading-process-rail__header-title">Stages</span>
        <button
          type="button"
          className="btn btn--secondary btn--small loading-process-rail__collapse"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? 'Expand stages navigation' : 'Collapse stages navigation'}
          title={collapsed ? 'Expand stages' : 'Collapse stages'}
        >
          <span className="rail-chevron" aria-hidden>
            {collapsed ? '›' : '‹'}
          </span>
        </button>
      </div>
      {processStages.map((s) => (
        <Link
          key={s.id}
          to={`${basePath}/${vesselId}/${s.id}`}
          className={`loading-process-rail__item ${section === s.id ? 'loading-process-rail__item--active' : ''}`}
          title={`${s.label} (${s.done}/${s.total} complete)`}
          aria-label={`${s.label} (${s.done} of ${s.total} complete)`}
        >
          <span className="loading-process-rail__title">
            <span className="loading-process-rail__icon" aria-hidden>
              {STAGE_ICON[s.id] || '•'}
            </span>
            <span className="loading-process-rail__label">
              {collapsed ? (STAGE_SHORT[s.id] || s.label) : s.label}
            </span>
          </span>
          {!collapsed && <span className="loading-process-rail__meta">{s.done} / {s.total} complete</span>}
        </Link>
      ))}
    </aside>
  )
}

const PRE_CHECK_SUB_TABS = [
  { id: 'keyMeeting', label: 'KEY MEETING' },
  { id: 'norAccepted', label: 'NOR ACCEPTED' },
  { id: 'tankInspection', label: 'TANK INSPECTION' },
  { id: 'holdInspection', label: 'HOLD INSPECTION' },
  { id: 'sampling', label: 'SAMPLING' },
  { id: 'initialSounding', label: 'INITIAL SOUNDING' },
  { id: 'initialDraftSurvey', label: 'INITIAL DRAFT SURVEY' },
]

const PRECHECK_SHORT_CODE = {
  keyMeeting: 'KM',
  norAccepted: 'NOR',
  tankInspection: 'TANK',
  holdInspection: 'HOLD',
  sampling: 'SAMP',
  initialSounding: 'SOUND',
  initialDraftSurvey: 'DRAFT',
}

const PRECHECK_RAIL_COLLAPSED_KEY = 'jps_precheck_section_rail_collapsed'

const PRECHECK_SECTION_TO_KEY = {
  keyMeeting: 'key_meeting',
  norAccepted: 'nor_accepted',
  tankInspection: 'tank_inspection',
  holdInspection: 'hold_inspection',
  sampling: 'sampling',
  initialSounding: 'initial_sounding',
  initialDraftSurvey: 'initial_draft_survey',
}

const PRECHECK_KEY_TO_SECTION = Object.fromEntries(
  Object.entries(PRECHECK_SECTION_TO_KEY).map(([section, key]) => [key, section])
)

const POST_CHECK_SUB_TABS = [
  { id: 'finalTankInspection', label: 'FINAL TANK INSPECTION' },
  { id: 'finalHoldInspection', label: 'FINAL HOLD INSPECTION' },
  { id: 'finalSounding', label: 'FINAL SOUNDING' },
]

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
                    if (href && href !== '#') window.open(href, '_blank', 'noopener,noreferrer')
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
                <a
                  href={precheckDocumentHref(f.url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="precheck-doc-list__link"
                >
                  {f.name}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/** Pre-Checking sections: KEY MEETING, NOR ACCEPTED, TANK INSPECTION, HOLD INSPECTION, SAMPLING, INITIAL SOUNDING, INITIAL DRAFT SURVEY */
function PreCheckingSections({
  vesselId,
  operationId,
  operationNorTenderedAt,
  operationNorAcceptedAt,
  getPreChecking,
  setPreCheckingSection,
  getArrivalNor,
  setArrivalNor,
  formatDateTimeDisplay,
  stageRailCollapsed,
}) {
  const [activeSubTab, setActiveSubTab] = useState('keyMeeting')
  const [listCollapsed, setListCollapsed] = useState(() => readBool(PRECHECK_RAIL_COLLAPSED_KEY, false))
  const [autoCollapseAfterSelect, setAutoCollapseAfterSelect] = useState(false)
  const [editingSection, setEditingSection] = useState(null)
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
          const merged = {
            ...current,
            remark: row.remark || '',
            status: row.status || current.status,
            lastSavedAt: row.updatedAt ?? current.lastSavedAt ?? null,
          }
          if (row.occurredAt) merged.dateTime = String(row.occurredAt).slice(0, 16)
          if (section === 'sampling') {
            merged.records = Array.isArray(row.payload?.records) ? row.payload.records : []
          }
          if (section === 'initialSounding' || section === 'initialDraftSurvey') {
            merged.remark = row.remark || row.payload?.result || ''
          }
          if (section === 'norAccepted') {
            const p = row.payload && typeof row.payload === 'object' ? row.payload : {}
            if (p.norTenderedDateTime) merged.norTenderedDateTime = isoOrDatetimeToLocal(p.norTenderedDateTime)
            if (p.norAcceptedDateTime) merged.norAcceptedDateTime = isoOrDatetimeToLocal(p.norAcceptedDateTime)
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
          docBySection[x.section] = x.docs.map((d) => ({ id: d.id, name: d.name, url: d.url, source: 'precheck_subprocess' }))
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
          remark: nor?.remark ?? norFromSub.remark ?? '',
          documents: mergedNorDocs,
          sourceModule: inferredSource,
          lastSavedAt: laterIso(nor?.updatedAt, norFromSub.lastSavedAt),
        })
        setLoadingPersisted(false)
      })
      .catch((e) => {
        if (cancelled) return
        setPersistError(e?.message || 'Failed to load pre-checking data')
        setLoadingPersisted(false)
      })
    return () => { cancelled = true }
  }, [operationId, vesselId, operationNorTenderedAt, operationNorAcceptedAt, setArrivalNor, setPreCheckingSection])

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
        documents: current.norAccepted?.documents ?? [],
        remark: current.norAccepted?.remark ?? '',
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

  const buildSubProcessPayload = (sectionKey, sectionDraft) => {
    if (sectionKey === 'sampling') {
      return {
        status: 'Done',
        occurredAt: sectionDraft?.dateTime || null,
        remark: sectionDraft?.remark || '',
        payload: { records: sectionDraft?.records || [] },
      }
    }
    if (sectionKey === 'initialSounding' || sectionKey === 'initialDraftSurvey') {
      return {
        status: 'Done',
        occurredAt: sectionDraft?.dateTime || null,
        remark: sectionDraft?.remark || sectionDraft?.result || '',
        payload: null,
      }
    }
    return {
      status: 'Done',
      occurredAt: sectionDraft?.dateTime || null,
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
      setArrivalNor(vesselId, {
        norTenderedDateTime: draft.norAccepted.norTenderedDateTime || '',
        norAcceptedDateTime: draft.norAccepted.norAcceptedDateTime || '',
      })
      setPreCheckingSection(vesselId, 'norAccepted', {
        documents: draft.norAccepted.documents || [],
        remark: draft.norAccepted.remark || '',
        status: nextStatus,
        sourceModule: 'nor_accepted_tab',
      })
      try {
        if (operationId) {
          await saveArrivalUpdateApi({
            operationId,
            norTenderedDateTime: draft.norAccepted.norTenderedDateTime || '',
            norAcceptedDateTime: draft.norAccepted.norAcceptedDateTime || '',
          })
          const norDet = await updateNorDetails(operationId, {
            remark: draft.norAccepted.remark || '',
            payload: {
              norStage: 'at_berth',
              norSource: 'nor_accepted_tab',
              updatedVia: 'loading.pre-checking.nor_accepted',
            },
          })
          const subNor = await upsertSubProcess(operationId, 'nor_accepted', {
            phase: 'Pre-Checking',
            status: nextStatus,
            occurredAt: draft.norAccepted.norAcceptedDateTime || draft.norAccepted.norTenderedDateTime || null,
            remark: draft.norAccepted.remark || '',
            payload: {
              norTenderedDateTime: draft.norAccepted.norTenderedDateTime || null,
              norAcceptedDateTime: draft.norAccepted.norAcceptedDateTime || null,
              saveMode: isDraft ? 'draft' : 'final',
            },
          })
          const norLastSaved = laterIso(norDet?.updatedAt, subNor?.updatedAt)
          if (norLastSaved) {
            setPreCheckingSection(vesselId, 'norAccepted', { lastSavedAt: norLastSaved })
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
              status: nextStatus,
              sourceModule: 'nor_accepted_tab',
              ...(norLastSaved ? { lastSavedAt: norLastSaved } : {}),
            })
          }
        }
      } catch (e) {
        setPersistError(e?.message || 'Failed to save NOR Accepted')
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
          const sent = await upsertSubProcess(operationId, subKey, { phase: 'Pre-Checking', ...payload, status: nextStatus })
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
    const tabLabel = PRE_CHECK_SUB_TABS.find((t) => t.id === sectionKey)?.label || sectionKey
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
      const idx = PRE_CHECK_SUB_TABS.findIndex((t) => t.id === sectionKey)
      const next = PRE_CHECK_SUB_TABS[idx + 1]
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
    setSaveSuccessMessage(successMsg)
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
    PRE_CHECK_SUB_TABS.forEach((t) => {
      map[t.id] = inferPrecheckStatus(t.id, data?.[t.id] || {})
    })
    return map
  }, [data])

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
            {PRE_CHECK_SUB_TABS.map((tab) => {
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
                      <button type="button" className="btn btn--small" onClick={() => selectTab(tab.id)}>
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
              <label className="berthing-modal__label">Date &amp; Time</label>
              <input
                type="datetime-local"
                className="berthing-modal__input"
                value={draft.keyMeeting?.dateTime || ''}
                onChange={(e) => updateDraft('keyMeeting', 'dateTime', e.target.value)}
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
                rows={4}
                placeholder="Optional remark"
              />
            </div>
          </>
        ) : (
          <>
            <div className="precheck-section__row">
              <span className="precheck-section__label">Date &amp; Time</span>
              <span className="precheck-section__value">{data.keyMeeting?.dateTime ? formatDateTimeDisplay(data.keyMeeting.dateTime) : '—'}</span>
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
        title="NOR ACCEPTED"
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
      {activeSubTab === 'tankInspection' && (
      <PreCheckSectionCard
        title="TANK INSPECTION"
        isEditing={editingSection === 'tankInspection'}
        onEdit={() => startEdit('tankInspection')}
        onSave={() => saveSection('tankInspection', 'final')}
        onSaveDraft={() => saveSection('tankInspection', 'draft')}
        onSaveNext={() => saveSection('tankInspection', 'final', true)}
        onCancel={cancelEdit}
      >
        {editingSection === 'tankInspection' ? (
          <>
            <div className="berthing-modal__field">
              <label className="berthing-modal__label">Date &amp; Time</label>
              <input
                type="datetime-local"
                className="berthing-modal__input"
                value={draft.tankInspection?.dateTime || ''}
                onChange={(e) => updateDraft('tankInspection', 'dateTime', e.target.value)}
              />
            </div>
            <PrecheckDocumentsEdit
              sectionKey="tankInspection"
              documents={draft.tankInspection?.documents}
              onAddFiles={(files) => addSectionDocuments('tankInspection', files)}
              onRemoveIndex={(i) => removePrecheckDocumentAt('tankInspection', i)}
              removingKey={removingDoc}
            />
            <div className="berthing-modal__field">
              <label className="berthing-modal__label">Remark</label>
              <textarea
                className="berthing-modal__input berthing-modal__textarea"
                value={draft.tankInspection?.remark || ''}
                onChange={(e) => updateDraft('tankInspection', 'remark', e.target.value)}
                rows={4}
                placeholder="Optional remark"
              />
            </div>
          </>
        ) : (
          <>
            <div className="precheck-section__row">
              <span className="precheck-section__label">Date &amp; Time</span>
              <span className="precheck-section__value">{data.tankInspection?.dateTime ? formatDateTimeDisplay(data.tankInspection.dateTime) : '—'}</span>
            </div>
            <PrecheckDocumentsRead documents={data.tankInspection?.documents} />
            <div className="precheck-section__row precheck-section__row--block">
              <span className="precheck-section__label">Remark</span>
              <span className="precheck-section__value">{data.tankInspection?.remark || '—'}</span>
            </div>
          </>
        )}
      </PreCheckSectionCard>
      )}
      {activeSubTab === 'holdInspection' && (
      <PreCheckSectionCard
        title="HOLD INSPECTION"
        isEditing={editingSection === 'holdInspection'}
        onEdit={() => startEdit('holdInspection')}
        onSave={() => saveSection('holdInspection', 'final')}
        onSaveDraft={() => saveSection('holdInspection', 'draft')}
        onSaveNext={() => saveSection('holdInspection', 'final', true)}
        onCancel={cancelEdit}
      >
        {editingSection === 'holdInspection' ? (
          <>
            <div className="berthing-modal__field">
              <label className="berthing-modal__label">Date &amp; Time</label>
              <input
                type="datetime-local"
                className="berthing-modal__input"
                value={draft.holdInspection?.dateTime || ''}
                onChange={(e) => updateDraft('holdInspection', 'dateTime', e.target.value)}
              />
            </div>
            <PrecheckDocumentsEdit
              sectionKey="holdInspection"
              documents={draft.holdInspection?.documents}
              onAddFiles={(files) => addSectionDocuments('holdInspection', files)}
              onRemoveIndex={(i) => removePrecheckDocumentAt('holdInspection', i)}
              removingKey={removingDoc}
            />
            <div className="berthing-modal__field">
              <label className="berthing-modal__label">Remark</label>
              <textarea
                className="berthing-modal__input berthing-modal__textarea"
                value={draft.holdInspection?.remark || ''}
                onChange={(e) => updateDraft('holdInspection', 'remark', e.target.value)}
                rows={4}
                placeholder="Optional remark"
              />
            </div>
          </>
        ) : (
          <>
            <div className="precheck-section__row">
              <span className="precheck-section__label">Date &amp; Time</span>
              <span className="precheck-section__value">{data.holdInspection?.dateTime ? formatDateTimeDisplay(data.holdInspection.dateTime) : '—'}</span>
            </div>
            <PrecheckDocumentsRead documents={data.holdInspection?.documents} />
            <div className="precheck-section__row precheck-section__row--block">
              <span className="precheck-section__label">Remark</span>
              <span className="precheck-section__value">{data.holdInspection?.remark || '—'}</span>
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
              <label className="berthing-modal__label">Date &amp; Time</label>
              <input
                type="datetime-local"
                className="berthing-modal__input"
                value={draft.sampling?.dateTime || ''}
                onChange={(e) => updateDraft('sampling', 'dateTime', e.target.value)}
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
              <span className="precheck-section__label">Date &amp; Time</span>
              <span className="precheck-section__value">{data.sampling?.dateTime ? formatDateTimeDisplay(data.sampling.dateTime) : '—'}</span>
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
      {activeSubTab === 'initialSounding' && (
      <PreCheckSectionCard
        title="INITIAL SOUNDING"
        isEditing={editingSection === 'initialSounding'}
        onEdit={() => startEdit('initialSounding')}
        onSave={() => saveSection('initialSounding', 'final')}
        onSaveDraft={() => saveSection('initialSounding', 'draft')}
        onSaveNext={() => saveSection('initialSounding', 'final', true)}
        onCancel={cancelEdit}
      >
        {editingSection === 'initialSounding' ? (
          <>
            <div className="berthing-modal__field">
              <label className="berthing-modal__label">Date &amp; Time</label>
              <input
                type="datetime-local"
                className="berthing-modal__input"
                value={draft.initialSounding?.dateTime || ''}
                onChange={(e) => updateDraft('initialSounding', 'dateTime', e.target.value)}
              />
            </div>
            <PrecheckDocumentsEdit
              sectionKey="initialSounding"
              documents={draft.initialSounding?.documents}
              onAddFiles={(files) => addSectionDocuments('initialSounding', files)}
              onRemoveIndex={(i) => removePrecheckDocumentAt('initialSounding', i)}
              removingKey={removingDoc}
            />
            <div className="berthing-modal__field">
              <label className="berthing-modal__label">Remark</label>
              <textarea
                className="berthing-modal__input berthing-modal__textarea"
                value={draft.initialSounding?.remark || ''}
                onChange={(e) => updateDraft('initialSounding', 'remark', e.target.value)}
                rows={4}
                placeholder="Optional remark"
              />
            </div>
          </>
        ) : (
          <>
            <div className="precheck-section__row">
              <span className="precheck-section__label">Date &amp; Time</span>
              <span className="precheck-section__value">{data.initialSounding?.dateTime ? formatDateTimeDisplay(data.initialSounding.dateTime) : '—'}</span>
            </div>
            <PrecheckDocumentsRead documents={data.initialSounding?.documents} />
            <div className="precheck-section__row precheck-section__row--block">
              <span className="precheck-section__label">Remark</span>
              <span className="precheck-section__value">{data.initialSounding?.remark || '—'}</span>
            </div>
          </>
        )}
      </PreCheckSectionCard>
      )}
      {activeSubTab === 'initialDraftSurvey' && (
      <PreCheckSectionCard
        title="INITIAL DRAFT SURVEY"
        isEditing={editingSection === 'initialDraftSurvey'}
        onEdit={() => startEdit('initialDraftSurvey')}
        onSave={() => saveSection('initialDraftSurvey', 'final')}
        onSaveDraft={() => saveSection('initialDraftSurvey', 'draft')}
        onSaveNext={() => saveSection('initialDraftSurvey', 'final', true)}
        onCancel={cancelEdit}
      >
        {editingSection === 'initialDraftSurvey' ? (
          <>
            <div className="berthing-modal__field">
              <label className="berthing-modal__label">Date &amp; Time</label>
              <input
                type="datetime-local"
                className="berthing-modal__input"
                value={draft.initialDraftSurvey?.dateTime || ''}
                onChange={(e) => updateDraft('initialDraftSurvey', 'dateTime', e.target.value)}
              />
            </div>
            <PrecheckDocumentsEdit
              sectionKey="initialDraftSurvey"
              documents={draft.initialDraftSurvey?.documents}
              onAddFiles={(files) => addSectionDocuments('initialDraftSurvey', files)}
              onRemoveIndex={(i) => removePrecheckDocumentAt('initialDraftSurvey', i)}
              removingKey={removingDoc}
            />
            <div className="berthing-modal__field">
              <label className="berthing-modal__label">Remark</label>
              <textarea
                className="berthing-modal__input berthing-modal__textarea"
                value={draft.initialDraftSurvey?.remark || ''}
                onChange={(e) => updateDraft('initialDraftSurvey', 'remark', e.target.value)}
                rows={4}
                placeholder="Optional remark"
              />
            </div>
          </>
        ) : (
          <>
            <div className="precheck-section__row">
              <span className="precheck-section__label">Date &amp; Time</span>
              <span className="precheck-section__value">{data.initialDraftSurvey?.dateTime ? formatDateTimeDisplay(data.initialDraftSurvey.dateTime) : '—'}</span>
            </div>
            <PrecheckDocumentsRead documents={data.initialDraftSurvey?.documents} />
            <div className="precheck-section__row precheck-section__row--block">
              <span className="precheck-section__label">Remark</span>
              <span className="precheck-section__value">{data.initialDraftSurvey?.remark || '—'}</span>
            </div>
          </>
        )}
      </PreCheckSectionCard>
      )}
        </div>
      </div>
    </div>
  )
}

function PreCheckSectionCard({ title, isEditing, onEdit, onSave, onSaveDraft, onSaveNext, onCancel, children }) {
  return (
    <section className={`precheck-section-card ${isEditing ? 'precheck-section-card--editing' : 'precheck-section-card--disabled'}`}>
      <div className="precheck-section-card__head">
        <h3 className="berthing-modal__card-title">{title}</h3>
        {!isEditing && (
          <button type="button" className="btn btn--small" onClick={onEdit}>
            Edit
          </button>
        )}
        {isEditing && (
          <div className="precheck-section-card__actions">
            {onSaveDraft && (
              <button type="button" className="btn btn--small btn--secondary" onClick={onSaveDraft}>
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
            <button type="button" className="btn btn--small btn--secondary" onClick={onCancel}>
              Cancel
            </button>
          </div>
        )}
      </div>
      <div className="precheck-section-card__body">{children}</div>
    </section>
  )
}

/** Post-Checking: Final Tank Inspection, Final Hold Inspection, Final Sounding with edit/save/cancel per section */
function PostCheckingSections({ vesselId, getPostChecking, setPostCheckingSection, formatDateTimeDisplay }) {
  const [activeSubTab, setActiveSubTab] = useState('finalTankInspection')
  const [editingSection, setEditingSection] = useState(null)
  const [draft, setDraft] = useState(() => defaultPostCheckingSection())
  const [pendingDocs, setPendingDocs] = useState([])

  const data = getPostChecking(vesselId)

  const startEdit = (sectionKey) => {
    setDraft({ ...defaultPostCheckingSection(), ...data })
    setPendingDocs([])
    setEditingSection(sectionKey)
  }

  const saveSection = (sectionKey) => {
    const current = data[sectionKey] || {}
    const docs = [...(current.documents || []), ...pendingDocs]
    setPostCheckingSection(vesselId, sectionKey, {
      result: draft[sectionKey]?.result ?? '',
      dateTime: draft[sectionKey]?.dateTime ?? '',
      documents: docs,
    })
    setEditingSection(null)
    setPendingDocs([])
  }

  const cancelEdit = () => {
    setEditingSection(null)
    setPendingDocs([])
  }

  const updateDraft = (sectionKey, field, value) => {
    setDraft((prev) => ({
      ...prev,
      [sectionKey]: { ...(prev[sectionKey] || {}), [field]: value },
    }))
  }

  const addPendingDocs = (sectionKey, files) => {
    if (editingSection !== sectionKey) return
    const newOnes = Array.from(files || []).map((file) => ({ name: file.name, url: URL.createObjectURL(file) }))
    setPendingDocs((prev) => [...prev, ...newOnes])
  }

  const allDocsFor = (sectionKey) => {
    const saved = data[sectionKey]?.documents || []
    if (editingSection === sectionKey) return [...saved, ...pendingDocs]
    return saved
  }

  return (
    <div className="precheck-sections">
      <div className="allocation-tabs precheck-subtabs" role="tablist" aria-label="Post-Checking sections">
        {POST_CHECK_SUB_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeSubTab === tab.id}
            className={`allocation-tabs__tab ${activeSubTab === tab.id ? 'allocation-tabs__tab--active' : ''}`}
            onClick={() => setActiveSubTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {activeSubTab === 'finalTankInspection' && (
      <PreCheckSectionCard
        title="FINAL TANK INSPECTION"
        isEditing={editingSection === 'finalTankInspection'}
        onEdit={() => startEdit('finalTankInspection')}
        onSave={() => saveSection('finalTankInspection')}
        onCancel={cancelEdit}
      >
        {editingSection === 'finalTankInspection' ? (
          <>
            <div className="berthing-modal__field">
              <label className="berthing-modal__label">Final Tank Inspection Result</label>
              <textarea
                className="berthing-modal__input berthing-modal__textarea"
                value={draft.finalTankInspection?.result ?? ''}
                onChange={(e) => updateDraft('finalTankInspection', 'result', e.target.value)}
                rows={4}
                placeholder="Enter result"
              />
            </div>
            <div className="berthing-modal__field">
              <label className="berthing-modal__label">Document upload</label>
              <label className="berthing-modal__file-zone">
                <span className="berthing-modal__file-zone-text">
                  {allDocsFor('finalTankInspection').length > 0 ? `${allDocsFor('finalTankInspection').length} file(s)` : 'Choose files'}
                </span>
                <input
                  type="file"
                  accept="image/*,.pdf"
                  multiple
                  onChange={(e) => addPendingDocs('finalTankInspection', e.target.files)}
                  className="berthing-modal__file-input"
                />
              </label>
              {allDocsFor('finalTankInspection').length > 0 && (
                <ul className="loading-step-card__file-list">
                  {allDocsFor('finalTankInspection').map((f, i) => (
                    <li key={i}>{f.name}</li>
                  ))}
                </ul>
              )}
            </div>
            <div className="berthing-modal__field">
              <label className="berthing-modal__label">Final Tank Inspection Date &amp; Time</label>
              <input
                type="datetime-local"
                className="berthing-modal__input"
                value={draft.finalTankInspection?.dateTime ?? ''}
                onChange={(e) => updateDraft('finalTankInspection', 'dateTime', e.target.value)}
              />
            </div>
          </>
        ) : (
          <>
            <div className="precheck-section__row precheck-section__row--block">
              <span className="precheck-section__label">Final Tank Inspection Result</span>
              <span className="precheck-section__value">{data.finalTankInspection?.result || '—'}</span>
            </div>
            <div className="precheck-section__row">
              <span className="precheck-section__label">Documents</span>
              <span className="precheck-section__value">
                {data.finalTankInspection?.documents?.length ? data.finalTankInspection.documents.map((d) => d.name).join(', ') : '—'}
              </span>
            </div>
            <div className="precheck-section__row">
              <span className="precheck-section__label">Final Tank Inspection Date &amp; Time</span>
              <span className="precheck-section__value">
                {data.finalTankInspection?.dateTime ? formatDateTimeDisplay(data.finalTankInspection.dateTime) : '—'}
              </span>
            </div>
          </>
        )}
      </PreCheckSectionCard>
      )}
      {activeSubTab === 'finalHoldInspection' && (
      <PreCheckSectionCard
        title="FINAL HOLD INSPECTION"
        isEditing={editingSection === 'finalHoldInspection'}
        onEdit={() => startEdit('finalHoldInspection')}
        onSave={() => saveSection('finalHoldInspection')}
        onCancel={cancelEdit}
      >
        {editingSection === 'finalHoldInspection' ? (
          <>
            <div className="berthing-modal__field">
              <label className="berthing-modal__label">Final Hold Inspection Result</label>
              <textarea
                className="berthing-modal__input berthing-modal__textarea"
                value={draft.finalHoldInspection?.result ?? ''}
                onChange={(e) => updateDraft('finalHoldInspection', 'result', e.target.value)}
                rows={4}
                placeholder="Enter result"
              />
            </div>
            <div className="berthing-modal__field">
              <label className="berthing-modal__label">Document upload</label>
              <label className="berthing-modal__file-zone">
                <span className="berthing-modal__file-zone-text">
                  {allDocsFor('finalHoldInspection').length > 0 ? `${allDocsFor('finalHoldInspection').length} file(s)` : 'Choose files'}
                </span>
                <input
                  type="file"
                  accept="image/*,.pdf"
                  multiple
                  onChange={(e) => addPendingDocs('finalHoldInspection', e.target.files)}
                  className="berthing-modal__file-input"
                />
              </label>
              {allDocsFor('finalHoldInspection').length > 0 && (
                <ul className="loading-step-card__file-list">
                  {allDocsFor('finalHoldInspection').map((f, i) => (
                    <li key={i}>{f.name}</li>
                  ))}
                </ul>
              )}
            </div>
            <div className="berthing-modal__field">
              <label className="berthing-modal__label">Final Hold Inspection Date &amp; Time</label>
              <input
                type="datetime-local"
                className="berthing-modal__input"
                value={draft.finalHoldInspection?.dateTime ?? ''}
                onChange={(e) => updateDraft('finalHoldInspection', 'dateTime', e.target.value)}
              />
            </div>
          </>
        ) : (
          <>
            <div className="precheck-section__row precheck-section__row--block">
              <span className="precheck-section__label">Final Hold Inspection Result</span>
              <span className="precheck-section__value">{data.finalHoldInspection?.result || '—'}</span>
            </div>
            <div className="precheck-section__row">
              <span className="precheck-section__label">Documents</span>
              <span className="precheck-section__value">
                {data.finalHoldInspection?.documents?.length ? data.finalHoldInspection.documents.map((d) => d.name).join(', ') : '—'}
              </span>
            </div>
            <div className="precheck-section__row">
              <span className="precheck-section__label">Final Hold Inspection Date &amp; Time</span>
              <span className="precheck-section__value">
                {data.finalHoldInspection?.dateTime ? formatDateTimeDisplay(data.finalHoldInspection.dateTime) : '—'}
              </span>
            </div>
          </>
        )}
      </PreCheckSectionCard>
      )}
      {activeSubTab === 'finalSounding' && (
      <PreCheckSectionCard
        title="FINAL SOUNDING"
        isEditing={editingSection === 'finalSounding'}
        onEdit={() => startEdit('finalSounding')}
        onSave={() => saveSection('finalSounding')}
        onCancel={cancelEdit}
      >
        {editingSection === 'finalSounding' ? (
          <>
            <div className="berthing-modal__field">
              <label className="berthing-modal__label">Final Sounding Inspection Result</label>
              <textarea
                className="berthing-modal__input berthing-modal__textarea"
                value={draft.finalSounding?.result ?? ''}
                onChange={(e) => updateDraft('finalSounding', 'result', e.target.value)}
                rows={4}
                placeholder="Enter result"
              />
            </div>
            <div className="berthing-modal__field">
              <label className="berthing-modal__label">Document upload</label>
              <label className="berthing-modal__file-zone">
                <span className="berthing-modal__file-zone-text">
                  {allDocsFor('finalSounding').length > 0 ? `${allDocsFor('finalSounding').length} file(s)` : 'Choose files'}
                </span>
                <input
                  type="file"
                  accept="image/*,.pdf"
                  multiple
                  onChange={(e) => addPendingDocs('finalSounding', e.target.files)}
                  className="berthing-modal__file-input"
                />
              </label>
              {allDocsFor('finalSounding').length > 0 && (
                <ul className="loading-step-card__file-list">
                  {allDocsFor('finalSounding').map((f, i) => (
                    <li key={i}>{f.name}</li>
                  ))}
                </ul>
              )}
            </div>
            <div className="berthing-modal__field">
              <label className="berthing-modal__label">Final Sounding Inspection Date &amp; Time</label>
              <input
                type="datetime-local"
                className="berthing-modal__input"
                value={draft.finalSounding?.dateTime ?? ''}
                onChange={(e) => updateDraft('finalSounding', 'dateTime', e.target.value)}
              />
            </div>
          </>
        ) : (
          <>
            <div className="precheck-section__row precheck-section__row--block">
              <span className="precheck-section__label">Final Sounding Inspection Result</span>
              <span className="precheck-section__value">{data.finalSounding?.result || '—'}</span>
            </div>
            <div className="precheck-section__row">
              <span className="precheck-section__label">Documents</span>
              <span className="precheck-section__value">
                {data.finalSounding?.documents?.length ? data.finalSounding.documents.map((d) => d.name).join(', ') : '—'}
              </span>
            </div>
            <div className="precheck-section__row">
              <span className="precheck-section__label">Final Sounding Inspection Date &amp; Time</span>
              <span className="precheck-section__value">
                {data.finalSounding?.dateTime ? formatDateTimeDisplay(data.finalSounding.dateTime) : '—'}
              </span>
            </div>
          </>
        )}
      </PreCheckSectionCard>
      )}
    </div>
  )
}

function LoadingTabContent({ vesselId, loadingOp, purpose, addActivity, updateActivity, deleteActivity }) {
  const activityCategories = purpose === 'Unloading' ? UNLOADING_ACTIVITY_CATEGORIES : LOADING_ACTIVITY_CATEGORIES
  const categoryLabel = purpose === 'Unloading' ? 'Unloading Activity Category' : 'Loading Activity Category'

  const [category, setCategory] = useState(activityCategories[0])
  const [description, setDescription] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editCategory, setEditCategory] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editStartTime, setEditStartTime] = useState('')
  const [editEndTime, setEditEndTime] = useState('')

  const activities = loadingOp.activities || []

  const resetForm = () => {
    setCategory(activityCategories[0])
    setDescription('')
    setStartTime('')
    setEndTime('')
  }

  const handleAdd = () => {
    if (!category.trim()) return
    addActivity(vesselId, {
      category: category.trim(),
      description: description.trim(),
      startTime: startTime || null,
      endTime: endTime || null,
    })
    resetForm()
  }

  const handleStartEdit = (act) => {
    setEditingId(act.id)
    setEditCategory(act.category)
    setEditDescription(act.description || '')
    setEditStartTime(act.startTime ? act.startTime.slice(0, 16) : '')
    setEditEndTime(act.endTime ? act.endTime.slice(0, 16) : '')
  }

  const handleSaveEdit = () => {
    if (!editingId) return
    updateActivity(vesselId, editingId, {
      category: editCategory.trim(),
      description: editDescription.trim(),
      startTime: editStartTime || null,
      endTime: editEndTime || null,
    })
    setEditingId(null)
    resetForm()
  }

  const handleCancelEdit = () => {
    setEditingId(null)
    resetForm()
  }

  const handleDelete = (activityId) => {
    if (window.confirm('Delete this activity?')) deleteActivity(vesselId, activityId)
  }

  return (
    <div className="loading-tab-content">
      <section className="berthing-modal__card loading-tab-card">
        <h3 className="berthing-modal__card-title">Detail Activity</h3>
        <div className="loading-detail-activity-form">
          <div className="berthing-modal__field">
            <label className="berthing-modal__label">{categoryLabel}</label>
            <select
              className="berthing-modal__input"
              value={editingId ? editCategory : category}
              onChange={(e) => (editingId ? setEditCategory(e.target.value) : setCategory(e.target.value))}
            >
              {activityCategories.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>
          <div className="berthing-modal__field">
            <label className="berthing-modal__label">Description</label>
            <textarea
              className="berthing-modal__input berthing-modal__textarea"
              value={editingId ? editDescription : description}
              onChange={(e) => (editingId ? setEditDescription(e.target.value) : setDescription(e.target.value))}
              placeholder="Optional description"
              rows={3}
            />
          </div>
          <div className="loading-detail-activity-times">
            <div className="berthing-modal__field">
              <label className="berthing-modal__label">Start time</label>
              <input
                type="datetime-local"
                className="berthing-modal__input"
                value={editingId ? editStartTime : startTime}
                onChange={(e) => (editingId ? setEditStartTime(e.target.value) : setStartTime(e.target.value))}
              />
            </div>
            <div className="berthing-modal__field">
              <label className="berthing-modal__label">End time</label>
              <input
                type="datetime-local"
                className="berthing-modal__input"
                value={editingId ? editEndTime : endTime}
                onChange={(e) => (editingId ? setEditEndTime(e.target.value) : setEndTime(e.target.value))}
              />
            </div>
          </div>
          <div className="loading-step-card__actions">
            {editingId ? (
              <>
                <button type="button" className="btn btn--primary btn--small" onClick={handleSaveEdit}>Update</button>
                <button type="button" className="btn btn--small btn--secondary" onClick={handleCancelEdit}>Cancel</button>
              </>
            ) : (
              <button type="button" className="btn btn--primary btn--small" onClick={handleAdd}>Add</button>
            )}
          </div>
        </div>

        <div className="loading-detail-activity-table-wrap">
          <table className="loading-detail-activity-table">
            <thead>
              <tr>
                <th>#</th>
                <th>{categoryLabel}</th>
                <th>Description</th>
                <th>Start time</th>
                <th>End time</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {activities.length === 0 ? (
                <tr>
                  <td colSpan={6} className="loading-detail-activity-empty">No detail activities yet. Add one above.</td>
                </tr>
              ) : (
                activities.map((act, index) => (
                  <tr key={act.id}>
                    <td>{index + 1}</td>
                    <td>{act.category}</td>
                    <td>{act.description || '—'}</td>
                    <td>{act.startTime ? formatDateTimeDisplay(act.startTime) : '—'}</td>
                    <td>{act.endTime ? formatDateTimeDisplay(act.endTime) : '—'}</td>
                    <td>
                      <button type="button" className="btn btn--small" onClick={() => handleStartEdit(act)}>Edit</button>
                      <button type="button" className="btn btn--small btn--secondary" onClick={() => handleDelete(act.id)}>Delete</button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
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
              placeholder="e.g. 2,750 MT"
              rows={4}
            />
          ) : (
            <input
              type="text"
              className="berthing-modal__input"
              value={quantityResult}
              onChange={(e) => setQuantityResult(e.target.value)}
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
