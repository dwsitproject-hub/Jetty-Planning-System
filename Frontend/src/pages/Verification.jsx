import { useState, useCallback, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { fetchOperations, depart } from '../api/operations'
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

export default function Verification() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [submitErr, setSubmitErr] = useState(null)
  const [modalOpId, setModalOpId] = useState(null)
  const [formHoseOff, setFormHoseOff] = useState('')
  const [formCastOff, setFormCastOff] = useState('')
  const [formDocuments, setFormDocuments] = useState([])
  const [formVesselPhotos, setFormVesselPhotos] = useState([])
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(async () => {
    setErr(null)
    setLoading(true)
    try {
      const [completed, sailed] = await Promise.all([
        fetchOperations({ status: 'COMPLETED' }),
        fetchOperations({ status: 'SAILED' }),
      ])
      const ready = (completed || []).map((o) => ({
        operationId: o.id,
        vesselName: o.vesselName,
        purpose: o.purpose,
        si: `${o.referenceNumber ?? ''} · ${o.commodity ?? ''}`.trim() || '—',
        status: 'Ready to Sail',
        apiStatus: o.status,
        hoseOffAt: o.hoseOffAt,
        castOffAt: o.castOffAt,
      }))
      const done = (sailed || []).map((o) => ({
        operationId: o.id,
        vesselName: o.vesselName,
        purpose: o.purpose,
        si: `${o.referenceNumber ?? ''} · ${o.commodity ?? ''}`.trim() || '—',
        status: 'Sailed',
        apiStatus: o.status,
        hoseOffAt: o.hoseOffAt,
        castOffAt: o.castOffAt,
        sailedAt: o.sailedAt,
      }))
      setRows([...ready, ...done])
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

  const filterKeys = CLEARANCE_COLUMNS.map((c) => c.key)
  const [filters, setFilters] = useState(() => Object.fromEntries(filterKeys.map((k) => [k, ''])))
  const [sortState, setSortState] = useState({ key: 'vesselName', dir: 'asc' })

  const readyCount = rows.filter((r) => r.apiStatus === 'COMPLETED').length
  const departedCount = rows.filter((r) => r.apiStatus === 'SAILED').length

  const updateFilter = (key, value) => setFilters((f) => ({ ...f, [key]: value }))
  const handleSort = (key) => setSortState((s) => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }))

  const filteredVessels = rows.filter((r) => {
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
      setFormHoseOff(toLocalDatetimeValue(op.hoseOffAt))
      setFormCastOff(toLocalDatetimeValue(op.castOffAt))
    } else {
      setFormHoseOff(toLocalDatetimeValue(new Date().toISOString()))
      setFormCastOff(toLocalDatetimeValue(new Date().toISOString()))
    }
    setFormDocuments([])
    setFormVesselPhotos([])
  }, [])

  const closeModal = useCallback(() => {
    setModalOpId(null)
    setSubmitErr(null)
  }, [])

  const addDocumentFiles = (e) => {
    const files = Array.from(e.target.files || [])
    const newOnes = files.map((f) => ({ name: f.name, url: URL.createObjectURL(f) }))
    setFormDocuments((prev) => [...prev, ...newOnes])
  }

  const addVesselPhotoFiles = (e) => {
    const files = Array.from(e.target.files || [])
    const newOnes = files.map((f) => ({ name: f.name, url: URL.createObjectURL(f) }))
    setFormVesselPhotos((prev) => [...prev, ...newOnes])
  }

  const toIso = (local) => {
    if (!local || !local.trim()) return new Date().toISOString()
    const d = new Date(local)
    return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
  }

  const handleSubmit = async () => {
    if (!modalOpId) return
    const op = rows.find((r) => r.operationId === modalOpId)
    if (op?.apiStatus === 'SAILED') {
      closeModal()
      return
    }
    setSubmitErr(null)
    setSubmitting(true)
    try {
      const clearanceUrl = formDocuments[0]?.name ? `local:${formDocuments[0].name}` : null
      const photoUrl = formVesselPhotos[0]?.name ? `local:${formVesselPhotos[0].name}` : null
      await depart(modalOpId, toIso(formHoseOff), toIso(formCastOff), clearanceUrl, photoUrl)
      await load()
      closeModal()
    } catch (e) {
      setSubmitErr(e?.message || 'Depart failed')
    } finally {
      setSubmitting(false)
    }
  }

  const modalRow = modalOpId ? rows.find((r) => r.operationId === modalOpId) : null
  const isSailed = modalRow?.apiStatus === 'SAILED'

  return (
    <div className="allocation-page clearance-page">
      <h1 className="page-title">Clearance</h1>
      <p className="allocation-page__intro">
        <strong>API:</strong> <code>GET /operations?status=COMPLETED</code> (ready) and <code>SAILED</code>. Submit calls{' '}
        <code>POST /operations/:id/depart</code>.
      </p>
      <button type="button" className="btn btn--secondary btn--small" onClick={load} disabled={loading}>Refresh</button>
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
        <h2 className="card__title">Operations</h2>
        {loading ? (
          <p className="text-steel">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-steel">No operations. Complete signoff on an operation, then record depart here.</p>
        ) : sortedVessels.length === 0 ? (
          <p className="text-steel">No rows match filters.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table allocation-table">
              <thead>
                <tr>
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
                {sortedVessels.map((v) => (
                  <tr key={v.operationId} className="allocation-table__row">
                    {CLEARANCE_COLUMNS.map((col) => (
                      <td key={col.key}>{col.getValue(v)}</td>
                    ))}
                    <td className="allocation-table__action-col">
                      {v.apiStatus === 'COMPLETED' ? (
                        <button type="button" className="btn btn--small btn--primary" onClick={() => openModal(v)}>
                          Record depart
                        </button>
                      ) : (
                        <button type="button" className="btn btn--small btn--secondary" onClick={() => openModal(v)}>
                          View
                        </button>
                      )}
                      <Link to={`/loading/operation/${v.operationId}`} className="btn btn--small btn--secondary" style={{ marginLeft: 6 }}>
                        Op
                      </Link>
                    </td>
                  </tr>
                ))}
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
              <p className="text-steel">This operation has already sailed. HOSE/CAST times are read-only.</p>
            )}

            <div className="modal__section">
              <label htmlFor="clearance-hose-off" className="modal__label">HOSE Off</label>
              <input
                id="clearance-hose-off"
                type="datetime-local"
                className="modal__input"
                value={formHoseOff}
                onChange={(e) => setFormHoseOff(e.target.value)}
                disabled={isSailed}
              />
            </div>

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
            </div>

            {!isSailed && (
              <>
                <div className="modal__section">
                  <label className="modal__label">Document (optional — stored as placeholder URL)</label>
                  <label className="berthing-modal__file-zone">
                    <span className="berthing-modal__file-zone-text">
                      {formDocuments.length > 0 ? `${formDocuments.length} file(s)` : 'Choose files'}
                    </span>
                    <input type="file" accept="image/*,.pdf" multiple onChange={addDocumentFiles} className="berthing-modal__file-input" />
                  </label>
                </div>
                <div className="modal__section">
                  <label className="modal__label">Vessel photo (optional)</label>
                  <label className="berthing-modal__file-zone">
                    <span className="berthing-modal__file-zone-text">
                      {formVesselPhotos.length > 0 ? `${formVesselPhotos.length} file(s)` : 'Choose files'}
                    </span>
                    <input type="file" accept="image/*,.pdf" multiple onChange={addVesselPhotoFiles} className="berthing-modal__file-input" />
                  </label>
                </div>
              </>
            )}

            {submitErr && <p style={{ color: '#c00' }}>{submitErr}</p>}

            <div className="modal__footer">
              <button type="button" className="btn btn--secondary" onClick={closeModal}>Close</button>
              {!isSailed && (
                <button type="button" className="btn btn--primary" onClick={handleSubmit} disabled={submitting}>
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
