import { useState, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { fetchOperations, fetchPendingSignoffRequests, depart, uploadOperationDocuments, signoff, fetchActivityTimeline } from '../api/operations'
import { useRbac } from '../context/RbacContext'
import { resolveUploadUrl } from '../api/client'
import '../styles/allocation.css'
import '../styles/modal.css'

const CLEARANCE_COLUMNS = [
  { key: 'vesselName', label: 'Vessel', getValue: (r) => <strong>{r.vesselName || '—'}</strong>, getSortValue: (r) => (r.vesselName || '').toLowerCase() },
  { key: 'si', label: 'SI', getValue: (r) => r.si || '—', getSortValue: (r) => (r.si || '').toLowerCase() },
  { key: 'purpose', label: 'Purpose', getValue: (r) => (
    <span className="loading-list__badge loading-list__badge--purpose" data-purpose={r.purpose}>{r.purpose}</span>
  ), getSortValue: (r) => (r.purpose || '').toLowerCase() },
  { key: 'status', label: 'Status', getValue: (r) => r.status || '—', getSortValue: (r) => (r.status || '').toLowerCase() },
]

function toLocalDatetimeValue(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function parseLocalTime(local) {
  if (!local || !local.trim()) return null
  const d = new Date(local)
  return Number.isNaN(d.getTime()) ? null : d
}

function formatDateTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString()
}

function latestTimelineInstant(events) {
  const arr = Array.isArray(events) ? events : []
  let latest = null
  for (const ev of arr) {
    const candidates = [ev?.startAt, ev?.endAt, ev?.occurredAt, ev?.sortAt, ev?.markedAt]
    for (const c of candidates) {
      if (!c) continue
      const d = new Date(c)
      if (Number.isNaN(d.getTime())) continue
      if (!latest || d.getTime() > latest.getTime()) latest = d
    }
  }
  return latest
}

export default function Verification() {
  const { t } = useTranslation('pages')
  const { canApprove } = useRbac()
  const canApproveLoading = canApprove('loading')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [submitErr, setSubmitErr] = useState(null)
  const [modalOpId, setModalOpId] = useState(null)
  const [formCastOff, setFormCastOff] = useState('')
  const [formDocuments, setFormDocuments] = useState([])
  const [formVesselPhotos, setFormVesselPhotos] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [toast, setToast] = useState(null)
  const [signoffBusyId, setSignoffBusyId] = useState(null)
  const [timelineMaxAtByOpId, setTimelineMaxAtByOpId] = useState({})

  const load = useCallback(async () => {
    setErr(null)
    setLoading(true)
    try {
      const pendingPromise = fetchPendingSignoffRequests().catch(() => [])
      const [signedOff, sailed, pendingRaw] = await Promise.all([
        fetchOperations({ status: 'SIGNOFF_APPROVED' }),
        fetchOperations({ status: 'SAILED' }),
        pendingPromise,
      ])
      const pending = (pendingRaw || []).map((o) => ({
        operationId: o.id,
        vesselName: o.vesselName,
        purpose: o.purpose,
        si: `${o.referenceNumber ?? ''} · ${o.commodity ?? ''}`.trim() || '—',
        referenceNumber: o.referenceNumber,
        commodity: o.commodity,
        jettyName: o.jettyName,
        status: 'Pending sign-off',
        apiStatus: 'PENDING_SIGNOFF',
        signoffRequestedAt: o.signoffRequestedAt,
        signoffRequestRemark: o.signoffRequestRemark,
        signoffRequestedByUsername: o.signoffRequestedByUsername,
        castOffAt: o.castOffAt,
        sailedAt: o.sailedAt,
        clearanceDocumentUrl: o.clearanceDocumentUrl,
        vesselPhotoUrl: o.vesselPhotoUrl,
      }))
      const ready = (signedOff || []).map((o) => ({
        operationId: o.id,
        vesselName: o.vesselName,
        purpose: o.purpose,
        si: `${o.referenceNumber ?? ''} · ${o.commodity ?? ''}`.trim() || '—',
        referenceNumber: o.referenceNumber,
        commodity: o.commodity,
        jettyName: o.jettyName,
        status: 'Ready to Sail',
        apiStatus: o.status,
        castOffAt: o.castOffAt,
        sailedAt: o.sailedAt,
        clearanceDocumentUrl: o.clearanceDocumentUrl,
        vesselPhotoUrl: o.vesselPhotoUrl,
      }))
      const done = (sailed || []).map((o) => ({
        operationId: o.id,
        vesselName: o.vesselName,
        purpose: o.purpose,
        si: `${o.referenceNumber ?? ''} · ${o.commodity ?? ''}`.trim() || '—',
        referenceNumber: o.referenceNumber,
        commodity: o.commodity,
        jettyName: o.jettyName,
        status: 'Sailed',
        apiStatus: o.status,
        castOffAt: o.castOffAt,
        sailedAt: o.sailedAt,
        clearanceDocumentUrl: o.clearanceDocumentUrl,
        vesselPhotoUrl: o.vesselPhotoUrl,
      }))
      setRows([...pending, ...ready, ...done])
    } catch (e) {
      setErr(e?.message || 'Failed to load clearance data')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!toast?.message) return undefined
    const t = window.setTimeout(() => setToast(null), 6500)
    return () => clearTimeout(t)
  }, [toast])

  const filterKeys = CLEARANCE_COLUMNS.map((c) => c.key)
  const [filters, setFilters] = useState(() => Object.fromEntries(filterKeys.map((k) => [k, ''])))
  const [sortState, setSortState] = useState({ key: 'vesselName', dir: 'asc' })
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [expandedRows, setExpandedRows] = useState({})

  const readyCount = rows.filter((r) => r.apiStatus === 'SIGNOFF_APPROVED').length
  const departedCount = rows.filter((r) => r.apiStatus === 'SAILED').length
  const pendingSignoffCount = rows.filter((r) => r.apiStatus === 'PENDING_SIGNOFF').length

  const updateFilter = (key, value) => setFilters((f) => ({ ...f, [key]: value }))
  const handleSort = (key) => setSortState((s) => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }))

  const rowsAfterStatusFilter = rows.filter((r) => {
    if (statusFilter === 'READY') return r.apiStatus === 'SIGNOFF_APPROVED'
    if (statusFilter === 'SAILED') return r.apiStatus === 'SAILED'
    if (statusFilter === 'PENDING') return r.apiStatus === 'PENDING_SIGNOFF'
    return true
  })

  const filteredVessels = rowsAfterStatusFilter.filter((r) => {
    return filterKeys.every((key) => {
      const f = (filters[key] || '').trim().toLowerCase()
      if (!f) return true
      const val = r[key]
      return String(val ?? '').toLowerCase().includes(f)
    })
  })

  const sortedVessels = [...filteredVessels].sort((a, b) => {
    const col = CLEARANCE_COLUMNS.find((c) => c.key === sortState.key)
    if (!col) return 0
    const va = col.getSortValue(a)
    const vb = col.getSortValue(b)
    return sortState.dir === 'asc'
      ? String(va).localeCompare(String(vb), undefined, { numeric: true })
      : String(vb).localeCompare(String(va), undefined, { numeric: true })
  })

  const openModal = useCallback((op) => {
    setSubmitErr(null)
    setModalOpId(op.operationId)
    if (op.apiStatus === 'SAILED') {
      setFormCastOff(toLocalDatetimeValue(op.castOffAt))
    } else {
      setFormCastOff(toLocalDatetimeValue(new Date().toISOString()))
    }
    setFormDocuments([])
    setFormVesselPhotos([])
  }, [])

  const closeModal = useCallback(() => {
    setModalOpId(null)
    setSubmitErr(null)
  }, [])

  const clearFilters = () => {
    setFilters(Object.fromEntries(filterKeys.map((k) => [k, ''])))
    setStatusFilter('ALL')
  }

  const hubPathForRow = (r) => {
    const purpose = r.purpose === 'Unloading' ? 'unloading' : 'loading'
    return `/${purpose}/op-${r.operationId}/post-checking`
  }

  const handleApproveSignoff = async (r) => {
    if (!r?.operationId) return
    if (!window.confirm(`Sign off operation for ${r.vesselName || 'this vessel'}? It will move to Ready to Sail.`)) return
    setSignoffBusyId(r.operationId)
    setSubmitErr(null)
    try {
      await signoff(r.operationId)
      await load()
      setToast({ message: `Operation signed off — ${r.vesselName || 'Vessel'} is Ready to Sail.`, variant: 'success' })
    } catch (e) {
      const msg = (e?.body && typeof e.body === 'object' && e.body.error) || e?.message || 'Sign-off failed'
      setToast({ message: msg, variant: 'error' })
    } finally {
      setSignoffBusyId(null)
    }
  }

  const toggleExpanded = (operationId) => {
    setExpandedRows((prev) => ({ ...prev, [operationId]: !prev[operationId] }))
  }

  const addDocumentFiles = (e) => {
    const files = Array.from(e.target.files || [])
    const newOnes = files.map((f) => ({ name: f.name, file: f }))
    setFormDocuments((prev) => [...prev, ...newOnes])
  }

  const addVesselPhotoFiles = (e) => {
    const files = Array.from(e.target.files || [])
    const newOnes = files.map((f) => ({ name: f.name, file: f }))
    setFormVesselPhotos((prev) => [...prev, ...newOnes])
  }

  const toIso = (local) => {
    if (!local || !local.trim()) return new Date().toISOString()
    const d = new Date(local)
    return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
  }

  useEffect(() => {
    let cancelled = false
    if (!modalOpId || timelineMaxAtByOpId[modalOpId] !== undefined) return () => { cancelled = true }
    fetchActivityTimeline(modalOpId)
      .then((res) => {
        if (cancelled) return
        const latest = latestTimelineInstant(res?.events)
        setTimelineMaxAtByOpId((prev) => ({ ...prev, [modalOpId]: latest ? latest.toISOString() : null }))
      })
      .catch(() => {
        if (cancelled) return
        setTimelineMaxAtByOpId((prev) => ({ ...prev, [modalOpId]: null }))
      })
    return () => { cancelled = true }
  }, [modalOpId, timelineMaxAtByOpId])

  const validateDepartForm = () => {
    const cast = parseLocalTime(formCastOff)
    if (!cast) return 'CAST Off time is required and must be valid.'
    if (modalOpId) {
      const latestIso = timelineMaxAtByOpId[modalOpId]
      if (latestIso) {
        const latest = new Date(latestIso)
        if (!Number.isNaN(latest.getTime()) && cast.getTime() < latest.getTime()) {
          return `CAST Off must be on or after the latest execution log time (${formatDateTime(latestIso)}).`
        }
      }
    }
    return null
  }

  const handleSubmit = async () => {
    if (!modalOpId) return
    const op = rows.find((r) => r.operationId === modalOpId)
    if (op?.apiStatus === 'SAILED') {
      closeModal()
      return
    }
    setSubmitErr(null)
    const validationError = validateDepartForm()
    if (validationError) {
      setSubmitErr(validationError)
      return
    }
    setSubmitting(true)
    try {
      let clearanceUrl = null
      let photoUrl = null

      const clearanceFiles = formDocuments.map((d) => d.file).filter(Boolean)
      if (clearanceFiles.length > 0) {
        const uploaded = await uploadOperationDocuments(modalOpId, 'CLEARANCE', clearanceFiles)
        clearanceUrl = uploaded?.items?.[0]?.url || null
      }

      const vesselPhotoFiles = formVesselPhotos.map((d) => d.file).filter(Boolean)
      if (vesselPhotoFiles.length > 0) {
        const uploaded = await uploadOperationDocuments(modalOpId, 'VESSEL_PHOTO', vesselPhotoFiles)
        photoUrl = uploaded?.items?.[0]?.url || null
      }

      const castOffIso = toIso(formCastOff)
      await depart(modalOpId, castOffIso, clearanceUrl, photoUrl)
      await load()
      setToast({ message: `Departure recorded for ${op?.vesselName || 'vessel'}.`, variant: 'success' })
      closeModal()
    } catch (e) {
      setSubmitErr(e?.message || 'Depart failed')
    } finally {
      setSubmitting(false)
    }
  }

  const modalRow = modalOpId ? rows.find((r) => r.operationId === modalOpId) : null
  const isSailed = modalRow?.apiStatus === 'SAILED'
  const formValidationError = isSailed ? null : validateDepartForm()
  const modalTimelineMaxAt = modalOpId ? timelineMaxAtByOpId[modalOpId] : null

  return (
    <div className="allocation-page clearance-page">
      <h1 className="page-title">{t('clearance')}</h1>
      <p className="allocation-page__intro">
        Approvers sign off completed work (Ready to Sail), then record departure. Use <strong>Pending sign-off</strong> for vessels awaiting final approval.
      </p>
      {toast?.message && (
        <div className={`toast ${toast.variant === 'error' ? 'toast--warning' : 'toast--success'}`} role="status" aria-live="polite" aria-atomic="true">
          <span className="toast__icon" aria-hidden>{toast.variant === 'error' ? '!' : '✓'}</span>
          <p className="toast__message">{toast.message}</p>
          <button type="button" className="toast__close" onClick={() => setToast(null)} aria-label="Dismiss notification">
            ×
          </button>
        </div>
      )}
      {err && <p style={{ color: '#c00' }}>{err}</p>}

      <section className="at-berth-summary" aria-label="Summary">
        <div className="at-berth-summary__grid at-berth-summary__grid--2">
          <div className="at-berth-card at-berth-card--clearance-ready">
            <h3 className="at-berth-card__title">⚓ Ready to Sail</h3>
            <p className="at-berth-card__count">{readyCount}</p>
          </div>
          <div className="at-berth-card at-berth-card--clearance-departed">
            <h3 className="at-berth-card__title">🚀 Sailed</h3>
            <p className="at-berth-card__count">{departedCount}</p>
          </div>
        </div>
      </section>

      <section className="card at-berth-list-section">
        <div className="card__header-row">
          <h2 className="card__title">Operations</h2>
          <div className="clearance-status-filter" role="group" aria-label="Filter operations by status">
            <button
              type="button"
              className={`btn btn--small ${statusFilter === 'ALL' ? 'btn--primary' : 'btn--ghost'}`}
              onClick={() => setStatusFilter('ALL')}
            >
              All ({rows.length})
            </button>
            <button
              type="button"
              className={`btn btn--small ${statusFilter === 'READY' ? 'btn--primary' : 'btn--ghost'}`}
              onClick={() => setStatusFilter('READY')}
            >
              Ready to Sail ({readyCount})
            </button>
            <button
              type="button"
              className={`btn btn--small ${statusFilter === 'SAILED' ? 'btn--primary' : 'btn--ghost'}`}
              onClick={() => setStatusFilter('SAILED')}
            >
              Sailed ({departedCount})
            </button>
            <button
              type="button"
              className={`btn btn--small ${statusFilter === 'PENDING' ? 'btn--primary' : 'btn--ghost'}`}
              onClick={() => setStatusFilter('PENDING')}
            >
              Pending sign-off ({pendingSignoffCount})
            </button>
            <button type="button" className="btn btn--small btn--soft" onClick={clearFilters}>
              Clear filters
            </button>
          </div>
        </div>
        {loading ? (
          <p className="text-steel">Fetching latest clearance queue…</p>
        ) : rows.length === 0 ? (
          <p className="text-steel">No operations in this queue yet. Pending sign-off appears after berth teams request sign-off; Ready to Sail after approval.</p>
        ) : sortedVessels.length === 0 ? (
          <p className="text-steel">No rows match filters.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table allocation-table clearance-table">
              <thead>
                <tr>
                  <th className="allocation-table__expand-col" aria-label="Expand row details" />
                  {CLEARANCE_COLUMNS.map((col) => (
                    <th key={col.key} className="allocation-table__th">
                      <button type="button" className="allocation-table__sort" onClick={() => handleSort(col.key)}>
                        {col.label}
                        <span className="allocation-table__sort-icon">
                          {sortState.key === col.key ? (sortState.dir === 'asc' ? ' ↑' : ' ↓') : ' ⇅'}
                        </span>
                      </button>
                    </th>
                  ))}
                  <th className="allocation-table__action-col">Action</th>
                </tr>
                <tr className="allocation-table__filter-row">
                  <th className="allocation-table__expand-col" />
                  {CLEARANCE_COLUMNS.map((col) => (
                    <th key={col.key}>
                      <input
                        type="text"
                        className="allocation-table__filter"
                        value={filters[col.key]}
                        onChange={(e) => updateFilter(col.key, e.target.value)}
                      />
                    </th>
                  ))}
                  <th className="allocation-table__action-col" />
                </tr>
              </thead>
              <tbody>
                {sortedVessels.flatMap((v) => {
                  const expanded = Boolean(expandedRows[v.operationId])
                  const mainRow = (
                    <tr key={v.operationId} className={`allocation-table__row ${expanded ? 'allocation-table__row--expanded' : ''}`}>
                      <td className="allocation-table__expand-col">
                        <button
                          type="button"
                          className="allocation-table__sort"
                          onClick={() => toggleExpanded(v.operationId)}
                          aria-label={expanded ? 'Collapse vessel details' : 'Expand vessel details'}
                        >
                          <span className="allocation-table__expand-icon">{expanded ? '▼' : '▶'}</span>
                        </button>
                      </td>
                      {CLEARANCE_COLUMNS.map((col) => (
                        <td key={col.key}>{col.getValue(v)}</td>
                      ))}
                      <td className="allocation-table__action-col">
                        <div className="allocation-table__action-btns">
                          {v.apiStatus === 'PENDING_SIGNOFF' ? (
                            <>
                              <Link to={hubPathForRow(v)} className="btn btn--small btn--ghost">
                                Open operation
                              </Link>
                              {canApproveLoading ? (
                                <button
                                  type="button"
                                  className="btn btn--small btn--primary"
                                  disabled={signoffBusyId === v.operationId}
                                  onClick={() => handleApproveSignoff(v)}
                                >
                                  {signoffBusyId === v.operationId ? 'Signing off…' : 'Sign off'}
                                </button>
                              ) : null}
                            </>
                          ) : v.apiStatus === 'SIGNOFF_APPROVED' ? (
                            <button type="button" className="btn btn--small btn--primary" onClick={() => openModal(v)}>
                              Record depart
                            </button>
                          ) : (
                            <button type="button" className="btn btn--small btn--ghost" onClick={() => openModal(v)}>
                              View
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                  if (!expanded) return [mainRow]
                  const detailRow = (
                    <tr className="allocation-table__detail-row" key={`detail-${v.operationId}`}>
                      <td className="allocation-table__detail-cell" colSpan={CLEARANCE_COLUMNS.length + 2}>
                        <div className="allocation-detail">
                          <h3 className="allocation-detail__title">Vessel details</h3>
                          <dl className="allocation-detail__grid">
                            <dt>Vessel Name</dt>
                            <dd>{v.vesselName || '—'}</dd>
                            <dt>Shipping Instruction</dt>
                            <dd>{v.referenceNumber || '—'}</dd>
                            <dt>Commodity</dt>
                            <dd>{v.commodity || '—'}</dd>
                            <dt>Purpose</dt>
                            <dd>{v.purpose || '—'}</dd>
                            <dt>Jetty</dt>
                            <dd>{v.jettyName || '—'}</dd>
                            <dt>Status</dt>
                            <dd>{v.status || '—'}</dd>
                            {v.apiStatus === 'PENDING_SIGNOFF' ? (
                              <>
                                <dt>Sign-off requested</dt>
                                <dd>{formatDateTime(v.signoffRequestedAt)}</dd>
                                {v.signoffRequestedByUsername ? (
                                  <>
                                    <dt>Requested by</dt>
                                    <dd>{v.signoffRequestedByUsername}</dd>
                                  </>
                                ) : null}
                                {v.signoffRequestRemark ? (
                                  <>
                                    <dt>Request remark</dt>
                                    <dd>{v.signoffRequestRemark}</dd>
                                  </>
                                ) : null}
                              </>
                            ) : null}
                            <dt>CAST Off</dt>
                            <dd>{formatDateTime(v.castOffAt)}</dd>
                            <dt>Sailed At</dt>
                            <dd>{formatDateTime(v.sailedAt)}</dd>
                          </dl>
                        </div>
                      </td>
                    </tr>
                  )
                  return [mainRow, detailRow]
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {modalOpId && (
        <div className="modal-overlay" onClick={closeModal} aria-hidden="true">
          <div
            className="modal modal--wide"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-labelledby="clearance-modal-title"
            aria-modal="true"
          >
            <h2 id="clearance-modal-title" className="modal__title">
              Clearance — {modalRow?.vesselName ?? 'Vessel'} {isSailed ? '(Sailed)' : ''}
            </h2>

            {isSailed && (
              <p className="text-steel">This operation has already sailed. Departure times and evidence are read-only.</p>
            )}

            <div className="modal__section">
              <label htmlFor="clearance-cast-off" className="modal__label">CAST Off</label>
              <input
                id="clearance-cast-off"
                type="datetime-local"
                className="modal__input"
                value={formCastOff}
                onChange={(e) => setFormCastOff(e.target.value)}
                disabled={isSailed}
              />
              {modalTimelineMaxAt ? (
                <p className="text-steel" style={{ marginTop: 6, fontSize: 'var(--font-size-small)' }}>
                  Must be on/after latest execution log time: <strong>{formatDateTime(modalTimelineMaxAt)}</strong>
                </p>
              ) : null}
            </div>

            {!isSailed && (
              <>
                <div className="modal__section">
                  <label className="modal__label">Document (optional)</label>
                  <label className="berthing-modal__file-zone">
                    <span className="berthing-modal__file-zone-text">
                      {formDocuments.length > 0 ? `${formDocuments.length} file(s)` : 'Choose files'}
                    </span>
                    <input type="file" accept="image/*,.pdf" multiple onChange={addDocumentFiles} className="berthing-modal__file-input" />
                  </label>
                  {formDocuments.length > 0 ? (
                    <ul className="loading-step-card__file-list">
                      {formDocuments.map((f, idx) => (
                        <li key={`${f.name}-${idx}`}>{f.name}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                <div className="modal__section">
                  <label className="modal__label">Vessel photo (optional)</label>
                  <label className="berthing-modal__file-zone">
                    <span className="berthing-modal__file-zone-text">
                      {formVesselPhotos.length > 0 ? `${formVesselPhotos.length} file(s)` : 'Choose files'}
                    </span>
                    <input type="file" accept="image/*,.pdf" multiple onChange={addVesselPhotoFiles} className="berthing-modal__file-input" />
                  </label>
                  {formVesselPhotos.length > 0 ? (
                    <ul className="loading-step-card__file-list">
                      {formVesselPhotos.map((f, idx) => (
                        <li key={`${f.name}-${idx}`}>{f.name}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </>
            )}

            {isSailed ? (
              <div className="modal__section">
                <h3 className="modal__label">Recorded departure</h3>
                <p className="text-steel">Sailed at: {formatDateTime(modalRow?.sailedAt)}</p>
                <ul className="loading-step-card__file-list">
                  <li>
                    Clearance document:{' '}
                    {modalRow?.clearanceDocumentUrl ? (
                      <a href={resolveUploadUrl(modalRow.clearanceDocumentUrl)} target="_blank" rel="noreferrer">
                        Open file
                      </a>
                    ) : (
                      '—'
                    )}
                  </li>
                  <li>
                    Vessel photo:{' '}
                    {modalRow?.vesselPhotoUrl ? (
                      <a href={resolveUploadUrl(modalRow.vesselPhotoUrl)} target="_blank" rel="noreferrer">
                        Open file
                      </a>
                    ) : (
                      '—'
                    )}
                  </li>
                </ul>
              </div>
            ) : null}

            {submitErr && <p style={{ color: '#c00' }}>{submitErr}</p>}
            {!isSailed && formValidationError ? (
              <p className="operational-form-error" role="alert">
                {formValidationError}
              </p>
            ) : null}

            <div className="modal__footer">
              <button type="button" className="btn btn--secondary" onClick={closeModal}>Close</button>
              {!isSailed && (
                <button type="button" className="btn btn--primary" onClick={handleSubmit} disabled={submitting || Boolean(formValidationError)}>
                  {submitting ? 'Submitting…' : 'Submit depart'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
