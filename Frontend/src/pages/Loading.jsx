import { useState, useCallback, useEffect } from 'react'
import { Link, useParams, Navigate, useLocation } from 'react-router-dom'
import {
  vessels,
  getAtBerthOperations,
  LOADING_STEP_IDS,
  LOADING_STEPS_CONFIG,
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
import '../styles/allocation.css'

const SECTIONS = [
  { id: 'pre-checking', label: 'Pre-Checking', description: 'Survey, Quality Check, Quantity Check (A1, A2, A3)', stepIds: ['A1', 'A2', 'A3'] },
  { id: 'loading', label: 'Operational', description: 'Cargo loading (B)', stepIds: ['B'] },
  { id: 'post-checking', label: 'Post-Checking', description: 'Final Quality Check, Final Quantity Check (C1, C2)', stepIds: ['C1', 'C2'] },
]

/** Sticky purpose banner so user always sees Loading vs Unloading */
function PurposeBanner({ purpose }) {
  const isUnloading = purpose === 'Unloading'
  return (
    <div className={`purpose-banner purpose-banner--${isUnloading ? 'unloading' : 'loading'}`} role="status" aria-live="polite">
      <span className="purpose-banner__icon" aria-hidden="true">{isUnloading ? '↓' : '↑'}</span>
      <span className="purpose-banner__text">{purpose.toUpperCase()}</span>
    </div>
  )
}

function getNowForDateTimeLocal() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const h = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${day}T${h}:${min}`
}

export default function Loading() {
  const { vesselId, section } = useParams()
  const location = useLocation()
  const isUnloading = location.pathname.startsWith('/unloading')
  const purpose = isUnloading ? 'Unloading' : 'Loading'
  const basePath = isUnloading ? '/unloading' : '/loading'
  const purposeLower = purpose.toLowerCase()
  const operations = getAtBerthOperations(purpose)
  const { getSteps, setStepData, getLoadingOperation, addLoadingActivity, updateLoadingActivity, deleteLoadingActivity, getPreChecking, setPreCheckingSection, getPostChecking, setPostCheckingSection } = useLoading()
  const [stepPhotos, setStepPhotos] = useState({})
  const [vesselCargoExpanded, setVesselCargoExpanded] = useState({ 'pre-checking': false, 'loading': false, 'post-checking': false })

  const vesselRaw = vesselId ? vessels[vesselId] : null
  const vessel = vesselRaw && vesselRaw.purpose === purpose ? vesselRaw : null
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
        <PurposeBanner purpose={purpose} />
        <h1 className="page-title">{purpose}: {vessel.vesselName}</h1>
        <p className="allocation-page__intro">SI: {vessel.siId} · {vessel.product}</p>

        <section className="berthing-modal__card berthing-modal__card--vessel">
          <h3 className="berthing-modal__card-title">Vessel info</h3>
          <dl className="berthing-modal__vessel-dl">
            <div className="berthing-modal__vessel-row">
              <dt>Vessel name</dt>
              <dd className="berthing-modal__vessel-dl--bold">{vessel.vesselName || '—'}</dd>
            </div>
            <div className="berthing-modal__vessel-row">
              <dt>SI No</dt>
              <dd className="berthing-modal__vessel-dl--bold">{vessel.siId || '—'}</dd>
            </div>
            <div className="berthing-modal__vessel-row">
              <dt>Material</dt>
              <dd>{vessel.product || '—'}</dd>
            </div>
          </dl>
        </section>

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

  return (
    <div className="allocation-page loading-page">
      <div style={{ marginBottom: 'var(--spacing-2)' }}>
        <Link to={`${basePath}/${vesselId}`} className="loading-back-link">← Back to {vessel.vesselName}</Link>
      </div>
      <PurposeBanner purpose={purpose} />
      <h1 className="page-title">{sectionConfig?.label ?? section}: {vessel.vesselName}</h1>
      <p className="allocation-page__intro">SI: {vessel.siId} · {vessel.product}</p>

      <div className="vessel-detail-modal__body">
        <section className="berthing-modal__card berthing-modal__card--vessel">
          <h3 className="berthing-modal__card-title">Vessel info</h3>
          <dl className="berthing-modal__vessel-dl">
            <div className="berthing-modal__vessel-row">
              <dt>Vessel name</dt>
              <dd className="berthing-modal__vessel-dl--bold">{vessel.vesselName || '—'}</dd>
            </div>
            <div className="berthing-modal__vessel-row">
              <dt>SI No</dt>
              <dd className="berthing-modal__vessel-dl--bold">{vessel.siId || '—'}</dd>
            </div>
            <div className="berthing-modal__vessel-row">
              <dt>Material</dt>
              <dd>{vessel.product || '—'}</dd>
            </div>
          </dl>
        </section>

        <nav className="loading-section-tabs" aria-label="Loading sections">
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

        {section === 'pre-checking' && (
          <>
            {(() => {
              const cargo = getLoadingOperationCargo(vesselId)
              if (!cargo) return null
              const expanded = vesselCargoExpanded['pre-checking']
              return (
                <section className="berthing-modal__card loading-tab-card loading-card--collapsible">
                  <button
                    type="button"
                    className="loading-card__header"
                    onClick={() => setVesselCargoExpanded((prev) => ({ ...prev, 'pre-checking': !prev['pre-checking'] }))}
                    aria-expanded={expanded}
                  >
                    <span className="berthing-modal__card-title">Vessel &amp; Cargo</span>
                    <span className="loading-card__chevron" aria-hidden>{expanded ? '▼' : '▶'}</span>
                  </button>
                  {expanded && (
                    <dl className="loading-tab-dl">
                      <div className="loading-tab-dl__row"><dt>Vessel</dt><dd>{cargo.vesselName}</dd></div>
                      <div className="loading-tab-dl__row"><dt>Commodity</dt><dd>{cargo.commodity}</dd></div>
                      <div className="loading-tab-dl__row"><dt>Quantity</dt><dd>{cargo.quantity}</dd></div>
                      <div className="loading-tab-dl__row"><dt>Stowage</dt><dd>{cargo.stowage}</dd></div>
                      <div className="loading-tab-dl__row"><dt>Load port</dt><dd>{cargo.loadPort}</dd></div>
                      <div className="loading-tab-dl__row"><dt>Disch port</dt><dd>{cargo.dischPort}</dd></div>
                      <div className="loading-tab-dl__row"><dt>Shipper</dt><dd>{cargo.shipper}</dd></div>
                      <div className="loading-tab-dl__row"><dt>Consignee</dt><dd>{cargo.consignee}</dd></div>
                      <div className="loading-tab-dl__row"><dt>Surveyor</dt><dd>{cargo.surveyor}</dd></div>
                      <div className="loading-tab-dl__row"><dt>Agent</dt><dd>{cargo.agent}</dd></div>
                      <div className="loading-tab-dl__row"><dt>Jetty</dt><dd>{cargo.jettyName}</dd></div>
                    </dl>
                  )}
                </section>
              )
            })()}
            <PreCheckingSections
              vesselId={vesselId}
              getPreChecking={getPreChecking}
              setPreCheckingSection={setPreCheckingSection}
              getArrivalNor={getArrivalNor}
              setArrivalNor={setArrivalNor}
              formatDateTimeDisplay={formatDateTimeDisplay}
            />
          </>
        )}

        {section === 'post-checking' && (
          <>
            {(() => {
              const cargo = getLoadingOperationCargo(vesselId)
              if (!cargo) return null
              const expanded = vesselCargoExpanded['post-checking']
              return (
                <section className="berthing-modal__card loading-tab-card loading-card--collapsible">
                  <button
                    type="button"
                    className="loading-card__header"
                    onClick={() => setVesselCargoExpanded((prev) => ({ ...prev, 'post-checking': !prev['post-checking'] }))}
                    aria-expanded={expanded}
                  >
                    <span className="berthing-modal__card-title">Vessel &amp; Cargo</span>
                    <span className="loading-card__chevron" aria-hidden>{expanded ? '▼' : '▶'}</span>
                  </button>
                  {expanded && (
                    <dl className="loading-tab-dl">
                      <div className="loading-tab-dl__row"><dt>Vessel</dt><dd>{cargo.vesselName}</dd></div>
                      <div className="loading-tab-dl__row"><dt>Commodity</dt><dd>{cargo.commodity}</dd></div>
                      <div className="loading-tab-dl__row"><dt>Quantity</dt><dd>{cargo.quantity}</dd></div>
                      <div className="loading-tab-dl__row"><dt>Stowage</dt><dd>{cargo.stowage}</dd></div>
                      <div className="loading-tab-dl__row"><dt>Load port</dt><dd>{cargo.loadPort}</dd></div>
                      <div className="loading-tab-dl__row"><dt>Disch port</dt><dd>{cargo.dischPort}</dd></div>
                      <div className="loading-tab-dl__row"><dt>Shipper</dt><dd>{cargo.shipper}</dd></div>
                      <div className="loading-tab-dl__row"><dt>Consignee</dt><dd>{cargo.consignee}</dd></div>
                      <div className="loading-tab-dl__row"><dt>Surveyor</dt><dd>{cargo.surveyor}</dd></div>
                      <div className="loading-tab-dl__row"><dt>Agent</dt><dd>{cargo.agent}</dd></div>
                      <div className="loading-tab-dl__row"><dt>Jetty</dt><dd>{cargo.jettyName}</dd></div>
                    </dl>
                  )}
                </section>
              )
            })()}
            <PostCheckingSections
              vesselId={vesselId}
              getPostChecking={getPostChecking}
              setPostCheckingSection={setPostCheckingSection}
              formatDateTimeDisplay={formatDateTimeDisplay}
            />
          </>
        )}

        {section === 'loading' && stepIds.map((stepId) => {
          const config = LOADING_STEPS_CONFIG[stepId]
          const loadingOp = getLoadingOperation(vesselId)
          const cargo = getLoadingOperationCargo(vesselId)
          return (
            <LoadingTabContent
              key={stepId}
              vesselId={vesselId}
              vessel={vessel}
              cargo={cargo}
              loadingOp={loadingOp}
              purpose={purpose}
              addActivity={addLoadingActivity}
              updateActivity={updateLoadingActivity}
              deleteActivity={deleteLoadingActivity}
              vesselCargoExpanded={vesselCargoExpanded['loading']}
              onVesselCargoToggle={() => setVesselCargoExpanded((prev) => ({ ...prev, loading: !prev.loading }))}
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

/** Format ISO datetime for display */
function formatDateTimeDisplay(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
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

const POST_CHECK_SUB_TABS = [
  { id: 'finalTankInspection', label: 'FINAL TANK INSPECTION' },
  { id: 'finalHoldInspection', label: 'FINAL HOLD INSPECTION' },
  { id: 'finalSounding', label: 'FINAL SOUNDING' },
]

/** Pre-Checking sections: KEY MEETING, NOR ACCEPTED, TANK INSPECTION, HOLD INSPECTION, SAMPLING, INITIAL SOUNDING, INITIAL DRAFT SURVEY */
function PreCheckingSections({ vesselId, getPreChecking, setPreCheckingSection, getArrivalNor, setArrivalNor, formatDateTimeDisplay }) {
  const [activeSubTab, setActiveSubTab] = useState('keyMeeting')
  const [editingSection, setEditingSection] = useState(null)
  const [draft, setDraft] = useState(() => defaultPreCheckingSection())
  const [editingSamplingRecordId, setEditingSamplingRecordId] = useState(null)
  const [samplingForm, setSamplingForm] = useState({ noPalka: '', ffa: '', moisture: '' })

  const data = getPreChecking(vesselId)
  const norFromArrival = getArrivalNor(vesselId)

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

  const saveSection = (sectionKey) => {
    if (sectionKey === 'norAccepted') {
      setArrivalNor(vesselId, {
        norTenderedDateTime: draft.norAccepted.norTenderedDateTime || '',
        norAcceptedDateTime: draft.norAccepted.norAcceptedDateTime || '',
      })
      setPreCheckingSection(vesselId, 'norAccepted', {
        documents: draft.norAccepted.documents || [],
        remark: draft.norAccepted.remark || '',
      })
    } else {
      setPreCheckingSection(vesselId, sectionKey, draft[sectionKey])
    }
    setEditingSection(null)
  }

  const addSectionDocuments = (sectionKey, files) => {
    const newOnes = Array.from(files || []).map((f) => ({ name: f.name, url: URL.createObjectURL(f) }))
    setDraft((prev) => ({
      ...prev,
      [sectionKey]: { ...(prev[sectionKey] || {}), documents: [...(prev[sectionKey]?.documents || []), ...newOnes] },
    }))
  }

  const cancelEdit = () => {
    setEditingSection(null)
    setEditingSamplingRecordId(null)
    setSamplingForm({ noPalka: '', ffa: '', moisture: '' })
  }

  const samplingRecords = (editingSection === 'sampling' ? draft.sampling?.records : data.sampling?.records) ?? []

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

  return (
    <div className="precheck-sections">
      <div className="allocation-tabs precheck-subtabs" role="tablist" aria-label="Pre-Checking sections">
        {PRE_CHECK_SUB_TABS.map((tab) => (
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
      {activeSubTab === 'keyMeeting' && (
      <PreCheckSectionCard
        title="KEY MEETING"
        isEditing={editingSection === 'keyMeeting'}
        onEdit={() => startEdit('keyMeeting')}
        onSave={() => saveSection('keyMeeting')}
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
            <div className="berthing-modal__field">
              <label className="berthing-modal__label">Upload document</label>
              <label className="berthing-modal__file-zone">
                <span className="berthing-modal__file-zone-text">{draft.keyMeeting?.documents?.length ? `${draft.keyMeeting.documents.length} file(s)` : 'Choose files'}</span>
                <input type="file" multiple accept="image/*,.pdf" onChange={(e) => addSectionDocuments('keyMeeting', e.target.files)} className="berthing-modal__file-input" />
              </label>
              {(draft.keyMeeting?.documents?.length > 0) && (
                <ul className="loading-step-card__file-list">
                  {draft.keyMeeting.documents.map((f, i) => (
                    <li key={i}>{f.name}</li>
                  ))}
                </ul>
              )}
            </div>
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
            <div className="precheck-section__row">
              <span className="precheck-section__label">Upload document</span>
              <span className="precheck-section__value">
                {data.keyMeeting?.documents?.length ? data.keyMeeting.documents.map((f, i) => f.name).join(', ') : '—'}
              </span>
            </div>
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
        onSave={() => saveSection('norAccepted')}
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
              <label className="berthing-modal__label">Upload document</label>
              <label className="berthing-modal__file-zone">
                <span className="berthing-modal__file-zone-text">{draft.norAccepted?.documents?.length ? `${draft.norAccepted.documents.length} file(s)` : 'Choose files'}</span>
                <input type="file" multiple accept="image/*,.pdf" onChange={(e) => addSectionDocuments('norAccepted', e.target.files)} className="berthing-modal__file-input" />
              </label>
              {(draft.norAccepted?.documents?.length > 0) && (
                <ul className="loading-step-card__file-list">
                  {draft.norAccepted.documents.map((f, i) => (
                    <li key={i}>{f.name}</li>
                  ))}
                </ul>
              )}
            </div>
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
            <div className="precheck-section__row">
              <span className="precheck-section__label">Upload document</span>
              <span className="precheck-section__value">
                {data.norAccepted?.documents?.length ? data.norAccepted.documents.map((f, i) => f.name).join(', ') : '—'}
              </span>
            </div>
            <div className="precheck-section__row precheck-section__row--block">
              <span className="precheck-section__label">Remark</span>
              <span className="precheck-section__value">{data.norAccepted?.remark || '—'}</span>
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
        onSave={() => saveSection('tankInspection')}
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
            <div className="berthing-modal__field">
              <label className="berthing-modal__label">Upload document</label>
              <label className="berthing-modal__file-zone">
                <span className="berthing-modal__file-zone-text">{draft.tankInspection?.documents?.length ? `${draft.tankInspection.documents.length} file(s)` : 'Choose files'}</span>
                <input type="file" multiple accept="image/*,.pdf" onChange={(e) => addSectionDocuments('tankInspection', e.target.files)} className="berthing-modal__file-input" />
              </label>
              {(draft.tankInspection?.documents?.length > 0) && (
                <ul className="loading-step-card__file-list">
                  {draft.tankInspection.documents.map((f, i) => (
                    <li key={i}>{f.name}</li>
                  ))}
                </ul>
              )}
            </div>
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
            <div className="precheck-section__row">
              <span className="precheck-section__label">Upload document</span>
              <span className="precheck-section__value">{data.tankInspection?.documents?.length ? data.tankInspection.documents.map((f, i) => f.name).join(', ') : '—'}</span>
            </div>
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
        onSave={() => saveSection('holdInspection')}
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
            <div className="berthing-modal__field">
              <label className="berthing-modal__label">Upload document</label>
              <label className="berthing-modal__file-zone">
                <span className="berthing-modal__file-zone-text">{draft.holdInspection?.documents?.length ? `${draft.holdInspection.documents.length} file(s)` : 'Choose files'}</span>
                <input type="file" multiple accept="image/*,.pdf" onChange={(e) => addSectionDocuments('holdInspection', e.target.files)} className="berthing-modal__file-input" />
              </label>
              {(draft.holdInspection?.documents?.length > 0) && (
                <ul className="loading-step-card__file-list">
                  {draft.holdInspection.documents.map((f, i) => (
                    <li key={i}>{f.name}</li>
                  ))}
                </ul>
              )}
            </div>
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
            <div className="precheck-section__row">
              <span className="precheck-section__label">Upload document</span>
              <span className="precheck-section__value">{data.holdInspection?.documents?.length ? data.holdInspection.documents.map((f, i) => f.name).join(', ') : '—'}</span>
            </div>
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
        onSave={() => saveSection('sampling')}
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
            <div className="berthing-modal__field">
              <label className="berthing-modal__label">Upload document</label>
              <label className="berthing-modal__file-zone">
                <span className="berthing-modal__file-zone-text">{draft.sampling?.documents?.length ? `${draft.sampling.documents.length} file(s)` : 'Choose files'}</span>
                <input type="file" multiple accept="image/*,.pdf" onChange={(e) => addSectionDocuments('sampling', e.target.files)} className="berthing-modal__file-input" />
              </label>
              {(draft.sampling?.documents?.length > 0) && (
                <ul className="loading-step-card__file-list">
                  {draft.sampling.documents.map((f, i) => (
                    <li key={i}>{f.name}</li>
                  ))}
                </ul>
              )}
            </div>
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
            <div className="loading-detail-activity-form precheck-sampling-form">
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
              <div className="loading-step-card__actions">
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
                  <button type="button" className="btn btn--primary btn--small" onClick={addSamplingRecord}>
                    Add
                  </button>
                )}
              </div>
            </div>
            <div className="loading-detail-activity-table-wrap">
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
                        <td>{rec.ffa || '—'}</td>
                        <td>{rec.moisture || '—'}</td>
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
            <div className="precheck-section__row">
              <span className="precheck-section__label">Upload document</span>
              <span className="precheck-section__value">{data.sampling?.documents?.length ? data.sampling.documents.map((f, i) => f.name).join(', ') : '—'}</span>
            </div>
            <div className="precheck-section__row precheck-section__row--block">
              <span className="precheck-section__label">Remark</span>
              <span className="precheck-section__value">{data.sampling?.remark || '—'}</span>
            </div>
            {!samplingRecords.length ? (
              <p className="text-steel precheck-section__placeholder">No sampling records.</p>
            ) : (
              <div className="loading-detail-activity-table-wrap">
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
                        <td>{rec.ffa || '—'}</td>
                        <td>{rec.moisture || '—'}</td>
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
        onSave={() => saveSection('initialSounding')}
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
            <div className="berthing-modal__field">
              <label className="berthing-modal__label">Upload document</label>
              <label className="berthing-modal__file-zone">
                <span className="berthing-modal__file-zone-text">{draft.initialSounding?.documents?.length ? `${draft.initialSounding.documents.length} file(s)` : 'Choose files'}</span>
                <input type="file" multiple accept="image/*,.pdf" onChange={(e) => addSectionDocuments('initialSounding', e.target.files)} className="berthing-modal__file-input" />
              </label>
              {(draft.initialSounding?.documents?.length > 0) && (
                <ul className="loading-step-card__file-list">
                  {draft.initialSounding.documents.map((f, i) => (
                    <li key={i}>{f.name}</li>
                  ))}
                </ul>
              )}
            </div>
            <div className="berthing-modal__field">
              <label className="berthing-modal__label">Result / Remark</label>
              <textarea
                className="berthing-modal__input berthing-modal__textarea"
                value={draft.initialSounding?.result || ''}
                onChange={(e) => updateDraft('initialSounding', 'result', e.target.value)}
                rows={4}
                placeholder="Result or remark"
              />
            </div>
          </>
        ) : (
          <>
            <div className="precheck-section__row">
              <span className="precheck-section__label">Date &amp; Time</span>
              <span className="precheck-section__value">{data.initialSounding?.dateTime ? formatDateTimeDisplay(data.initialSounding.dateTime) : '—'}</span>
            </div>
            <div className="precheck-section__row">
              <span className="precheck-section__label">Upload document</span>
              <span className="precheck-section__value">{data.initialSounding?.documents?.length ? data.initialSounding.documents.map((f, i) => f.name).join(', ') : '—'}</span>
            </div>
            <div className="precheck-section__row precheck-section__row--block">
              <span className="precheck-section__label">Result / Remark</span>
              <span className="precheck-section__value">{data.initialSounding?.result || '—'}</span>
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
        onSave={() => saveSection('initialDraftSurvey')}
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
            <div className="berthing-modal__field">
              <label className="berthing-modal__label">Upload document</label>
              <label className="berthing-modal__file-zone">
                <span className="berthing-modal__file-zone-text">{draft.initialDraftSurvey?.documents?.length ? `${draft.initialDraftSurvey.documents.length} file(s)` : 'Choose files'}</span>
                <input type="file" multiple accept="image/*,.pdf" onChange={(e) => addSectionDocuments('initialDraftSurvey', e.target.files)} className="berthing-modal__file-input" />
              </label>
              {(draft.initialDraftSurvey?.documents?.length > 0) && (
                <ul className="loading-step-card__file-list">
                  {draft.initialDraftSurvey.documents.map((f, i) => (
                    <li key={i}>{f.name}</li>
                  ))}
                </ul>
              )}
            </div>
            <div className="berthing-modal__field">
              <label className="berthing-modal__label">Result / Remark</label>
              <textarea
                className="berthing-modal__input berthing-modal__textarea"
                value={draft.initialDraftSurvey?.result || ''}
                onChange={(e) => updateDraft('initialDraftSurvey', 'result', e.target.value)}
                rows={4}
                placeholder="Result or remark"
              />
            </div>
          </>
        ) : (
          <>
            <div className="precheck-section__row">
              <span className="precheck-section__label">Date &amp; Time</span>
              <span className="precheck-section__value">{data.initialDraftSurvey?.dateTime ? formatDateTimeDisplay(data.initialDraftSurvey.dateTime) : '—'}</span>
            </div>
            <div className="precheck-section__row">
              <span className="precheck-section__label">Upload document</span>
              <span className="precheck-section__value">{data.initialDraftSurvey?.documents?.length ? data.initialDraftSurvey.documents.map((f, i) => f.name).join(', ') : '—'}</span>
            </div>
            <div className="precheck-section__row precheck-section__row--block">
              <span className="precheck-section__label">Result / Remark</span>
              <span className="precheck-section__value">{data.initialDraftSurvey?.result || '—'}</span>
            </div>
          </>
        )}
      </PreCheckSectionCard>
      )}
    </div>
  )
}

function PreCheckSectionCard({ title, isEditing, onEdit, onSave, onCancel, children }) {
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
            <button type="button" className="btn btn--primary btn--small" onClick={onSave}>
              Save
            </button>
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

function LoadingTabContent({ vesselId, cargo, loadingOp, purpose, addActivity, updateActivity, deleteActivity, vesselCargoExpanded = false, onVesselCargoToggle }) {
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

  if (!cargo) return null

  return (
    <div className="loading-tab-content">
      <section className="berthing-modal__card loading-tab-card loading-card--collapsible">
        <button
          type="button"
          className="loading-card__header"
          onClick={onVesselCargoToggle}
          aria-expanded={vesselCargoExpanded}
        >
          <span className="berthing-modal__card-title">Vessel &amp; Cargo</span>
          <span className="loading-card__chevron" aria-hidden>{vesselCargoExpanded ? '▼' : '▶'}</span>
        </button>
        {vesselCargoExpanded && (
          <dl className="loading-tab-dl">
            <div className="loading-tab-dl__row"><dt>Vessel</dt><dd>{cargo.vesselName}</dd></div>
            <div className="loading-tab-dl__row"><dt>Commodity</dt><dd>{cargo.commodity}</dd></div>
            <div className="loading-tab-dl__row"><dt>Quantity</dt><dd>{cargo.quantity}</dd></div>
            <div className="loading-tab-dl__row"><dt>Stowage</dt><dd>{cargo.stowage}</dd></div>
            <div className="loading-tab-dl__row"><dt>Load port</dt><dd>{cargo.loadPort}</dd></div>
            <div className="loading-tab-dl__row"><dt>Disch port</dt><dd>{cargo.dischPort}</dd></div>
            <div className="loading-tab-dl__row"><dt>Shipper</dt><dd>{cargo.shipper}</dd></div>
            <div className="loading-tab-dl__row"><dt>Consignee</dt><dd>{cargo.consignee}</dd></div>
            <div className="loading-tab-dl__row"><dt>Surveyor</dt><dd>{cargo.surveyor}</dd></div>
            <div className="loading-tab-dl__row"><dt>Agent</dt><dd>{cargo.agent}</dd></div>
            <div className="loading-tab-dl__row"><dt>Jetty</dt><dd>{cargo.jettyName}</dd></div>
          </dl>
        )}
      </section>

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
