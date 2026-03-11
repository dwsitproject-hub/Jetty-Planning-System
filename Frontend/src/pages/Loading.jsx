import { useState, useCallback, useEffect } from 'react'
import { Link, useParams, Navigate } from 'react-router-dom'
import {
  vessels,
  getLoadingOperations,
  LOADING_STEP_IDS,
  LOADING_STEPS_CONFIG,
  initialLoadingStepsByVesselId,
  getLoadingOperationCargo,
  LOADING_ACTIVITY_CATEGORIES,
} from '../data/mockData'
import { useLoading } from '../context/LoadingContext'
import '../styles/allocation.css'

const SECTIONS = [
  { id: 'pre-checking', label: 'Pre-Checking', description: 'Survey, Quality Check, Quantity Check (A1, A2, A3)', stepIds: ['A1', 'A2', 'A3'] },
  { id: 'loading', label: 'Loading', description: 'Cargo loading (B)', stepIds: ['B'] },
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

export default function Loading() {
  const { vesselId, section } = useParams()
  const operations = getLoadingOperations()
  const { getSteps, setStepData, getLoadingOperation, addLoadingActivity, updateLoadingActivity, deleteLoadingActivity } = useLoading()
  const [stepPhotos, setStepPhotos] = useState({})

  const vessel = vesselId ? vessels[vesselId] : null
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
      <div className="allocation-page">
        <h1 className="page-title">Loading</h1>
        <p className="allocation-page__intro">Select a loading operation to record survey, quality check, quantity check, and final checks.</p>
        <section className="card">
          <h2 className="card__title">Loading operations</h2>
          {operations.length === 0 ? (
            <p className="text-steel">No loading operations.</p>
          ) : (
            <ul className="loading-list">
              {operations.map((op) => (
                <li key={op.vesselId}>
                  <Link to={`/loading/${op.vesselId}`} className="loading-list__link">
                    <span className="loading-list__name">{op.vesselName}</span>
                    <span className="loading-list__meta">SI: {op.siId} · {op.product}</span>
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
      <div className="allocation-page">
        <h1 className="page-title">Loading</h1>
        <p className="text-steel">Vessel not found.</p>
        <Link to="/loading" className="loading-back-link">Back to list</Link>
      </div>
    )
  }

  // Invalid section → redirect to hub
  if (section && !SECTIONS.some((s) => s.id === section)) {
    return <Navigate to={`/loading/${vesselId}`} replace />
  }

  // Hub: vesselId, no section → show 3 sub-page links
  if (!section) {
    return (
      <div className="allocation-page">
        <div style={{ marginBottom: 'var(--spacing-2)' }}>
          <Link to="/loading" className="loading-back-link">← Back to Loading operations</Link>
        </div>
        <h1 className="page-title">Loading: {vessel.vesselName}</h1>
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

        <nav className="loading-section-tabs" aria-label="Loading sections">
          {SECTIONS.map((sec) => (
            <Link
              key={sec.id}
              to={`/loading/${vesselId}/${sec.id}`}
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
    <div className="allocation-page">
      <div style={{ marginBottom: 'var(--spacing-2)' }}>
        <Link to={`/loading/${vesselId}`} className="loading-back-link">← Back to {vessel.vesselName}</Link>
      </div>
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
              to={`/loading/${vesselId}/${sec.id}`}
              className={`loading-section-tabs__tab ${section === sec.id ? 'loading-section-tabs__tab--active' : ''}`}
            >
              {sec.label}
            </Link>
          ))}
        </nav>

        {stepIds.map((stepId) => {
          const config = LOADING_STEPS_CONFIG[stepId]
          const step = stepsOrInitial?.[stepId] ?? { status: 'not_started', startTime: '', endTime: '', quantityResult: null, documents: [] }
          const isLoadingTab = stepId === 'B'

          if (isLoadingTab) {
            const cargo = getLoadingOperationCargo(vesselId)
            const loadingOp = getLoadingOperation(vesselId)
            return (
              <LoadingTabContent
                key={stepId}
                vesselId={vesselId}
                vessel={vessel}
                cargo={cargo}
                loadingOp={loadingOp}
                addActivity={addLoadingActivity}
                updateActivity={updateLoadingActivity}
                deleteActivity={deleteLoadingActivity}
              />
            )
          }

          const resultLabel = { A1: 'Survey result', A2: 'Quality Check result', A3: 'Quantity check result', C1: 'Quality Check result', C2: 'Quantity check result' }[stepId] || 'Result'
          const resultMultiline = stepId !== 'A3'

          return (
            <LoadingStepCard
              key={stepId}
              stepId={stepId}
              config={config}
              step={step}
              vesselId={vesselId}
              resultLabel={resultLabel}
              resultMultiline={resultMultiline}
              onSave={handleSaveStep}
              stepPhotos={stepPhotos[`${vesselId}-${stepId}`] ?? []}
              onAddPhoto={(files) => addStepPhoto(stepId, files)}
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

function LoadingTabContent({ vesselId, cargo, loadingOp, addActivity, updateActivity, deleteActivity }) {
  const [category, setCategory] = useState(LOADING_ACTIVITY_CATEGORIES[0])
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
    setCategory(LOADING_ACTIVITY_CATEGORIES[0])
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
      <section className="berthing-modal__card loading-tab-card">
        <h3 className="berthing-modal__card-title">Vessel &amp; Cargo</h3>
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
      </section>

      <section className="berthing-modal__card loading-tab-card">
        <h3 className="berthing-modal__card-title">Detail Activity</h3>
        <div className="loading-detail-activity-form">
          <div className="berthing-modal__field">
            <label className="berthing-modal__label">Loading Activity Category</label>
            <select
              className="berthing-modal__input"
              value={editingId ? editCategory : category}
              onChange={(e) => (editingId ? setEditCategory(e.target.value) : setCategory(e.target.value))}
            >
              {LOADING_ACTIVITY_CATEGORIES.map((opt) => (
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
                <th>Loading Activity Category</th>
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
