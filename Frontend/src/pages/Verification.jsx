import { useState, useCallback } from 'react'
import { getAtBerthOperations } from '../data/mockData'
import { useClearance } from '../context/ClearanceContext'
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

export default function Verification() {
  const { clearanceByVesselId, getClearance, setClearance } = useClearance()
  const loadingOps = getAtBerthOperations('Loading').map((o) => ({ ...o, purpose: 'Loading' }))
  const unloadingOps = getAtBerthOperations('Unloading').map((o) => ({ ...o, purpose: 'Unloading' }))
  const atBerthVessels = [...loadingOps, ...unloadingOps]
  const [modalVesselId, setModalVesselId] = useState(null)
  const [formHoseOff, setFormHoseOff] = useState('')
  const [formCastOff, setFormCastOff] = useState('')
  const [formDocuments, setFormDocuments] = useState([])
  const [formVesselPhotos, setFormVesselPhotos] = useState([])

  const filterKeys = CLEARANCE_COLUMNS.map((c) => c.key)
  const [filters, setFilters] = useState(() => Object.fromEntries(filterKeys.map((k) => [k, ''])))
  const [sortState, setSortState] = useState({ key: 'vesselName', dir: 'asc' })

  const vesselsWithStatus = atBerthVessels.map((v) => {
    const departed = clearanceByVesselId[v.vesselId]?.departed
    return {
      ...v,
      si: `${v.siId ?? ''} · ${v.product ?? ''}`.trim(),
      status: departed ? 'Sailed' : 'Ready to Sail',
    }
  })

  const readyCount = atBerthVessels.filter((v) => !clearanceByVesselId[v.vesselId]?.departed).length
  const departedCount = atBerthVessels.filter((v) => clearanceByVesselId[v.vesselId]?.departed).length

  const updateFilter = (key, value) => setFilters((f) => ({ ...f, [key]: value }))
  const handleSort = (key) => setSortState((s) => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }))

  const filteredVessels = vesselsWithStatus.filter((r) => {
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
    const isNum = typeof va === 'number' && typeof vb === 'number'
    const cmp = isNum ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true })
    return sortState.dir === 'asc' ? cmp : -cmp
  })

  const openModal = useCallback((vesselId) => {
    const c = getClearance(vesselId)
    setModalVesselId(vesselId)
    setFormHoseOff(c?.hoseOff ?? '')
    setFormCastOff(c?.castOff ?? '')
    setFormDocuments(c?.documentFiles ? [...c.documentFiles] : [])
    setFormVesselPhotos(c?.vesselPhotoFiles ? [...c.vesselPhotoFiles] : [])
  }, [getClearance])

  const closeModal = useCallback(() => {
    setModalVesselId(null)
    setFormHoseOff('')
    setFormCastOff('')
    setFormDocuments([])
    setFormVesselPhotos([])
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

  const handleSubmit = () => {
    if (!modalVesselId) return
    setClearance(modalVesselId, {
      hoseOff: formHoseOff || '',
      castOff: formCastOff || '',
      documentFiles: formDocuments,
      vesselPhotoFiles: formVesselPhotos,
      departed: true,
    })
    closeModal()
  }

  const modalVessel = modalVesselId ? atBerthVessels.find((v) => v.vesselId === modalVesselId) : null

  return (
    <div className="allocation-page clearance-page">
      <h1 className="page-title">Clearance</h1>
      <p className="allocation-page__intro">
        Summary of vessels ready to sail and sailed. Click a vessel to record HOSE Off, CAST Off, and documents.
      </p>

      <section className="at-berth-summary" aria-label="Summary">
        <div className="at-berth-summary__grid at-berth-summary__grid--2">
          <div className="at-berth-card at-berth-card--clearance-ready">
            <h3 className="at-berth-card__title">⚓ Ready to Sail</h3>
            <p className="at-berth-card__count" aria-label="Ready to Sail count">
              {readyCount}
            </p>
          </div>
          <div className="at-berth-card at-berth-card--clearance-departed">
            <h3 className="at-berth-card__title">🚀 Sailed</h3>
            <p className="at-berth-card__count" aria-label="Sailed count">
              {departedCount}
            </p>
          </div>
        </div>
      </section>

      <section className="card at-berth-list-section">
        <h2 className="card__title">Vessels</h2>
        {atBerthVessels.length === 0 ? (
          <p className="text-steel">No vessels.</p>
        ) : sortedVessels.length === 0 ? (
          <p className="text-steel">No vessels match the filters.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table allocation-table">
              <thead>
                <tr>
                  {CLEARANCE_COLUMNS.map((col) => (
                    <th key={col.key} className="allocation-table__th">
                      <button
                        type="button"
                        className="allocation-table__sort"
                        onClick={() => handleSort(col.key)}
                        title={`Sort by ${col.label}`}
                      >
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
                        placeholder={`Filter ${col.label}`}
                        value={filters[col.key]}
                        onChange={(e) => updateFilter(col.key, e.target.value)}
                        aria-label={`Filter by ${col.label}`}
                      />
                    </th>
                  ))}
                  <th className="allocation-table__action-col" />
                </tr>
              </thead>
              <tbody>
                {sortedVessels.map((v) => (
                  <tr key={v.vesselId} className="allocation-table__row">
                    {CLEARANCE_COLUMNS.map((col) => (
                      <td key={col.key}>{col.getValue(v)}</td>
                    ))}
                    <td className="allocation-table__action-col">
                      <button
                        type="button"
                        className="btn btn--small btn--primary"
                        onClick={() => openModal(v.vesselId)}
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {modalVesselId && (
        <div
          className="modal-overlay"
          onClick={closeModal}
          aria-hidden="true"
        >
          <div
            className="modal modal--wide"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-labelledby="clearance-modal-title"
            aria-modal="true"
          >
            <h2 id="clearance-modal-title" className="modal__title">
              Clearance — {modalVessel?.vesselName ?? 'Vessel'}
            </h2>

            <div className="modal__section">
              <label htmlFor="clearance-hose-off" className="modal__label">HOSE Off</label>
              <input
                id="clearance-hose-off"
                type="datetime-local"
                className="modal__input"
                value={formHoseOff}
                onChange={(e) => setFormHoseOff(e.target.value)}
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
              />
            </div>

            <div className="modal__section">
              <label className="modal__label">Document</label>
              <label className="berthing-modal__file-zone">
                <span className="berthing-modal__file-zone-text">
                  {formDocuments.length > 0 ? `${formDocuments.length} file(s)` : 'Choose files'}
                </span>
                <input
                  type="file"
                  accept="image/*,.pdf"
                  multiple
                  onChange={addDocumentFiles}
                  className="berthing-modal__file-input"
                />
              </label>
              {formDocuments.length > 0 && (
                <ul className="loading-step-card__file-list">
                  {formDocuments.map((f, i) => (
                    <li key={i}>{f.name}</li>
                  ))}
                </ul>
              )}
            </div>

            <div className="modal__section">
              <label className="modal__label">Vessel photo</label>
              <label className="berthing-modal__file-zone">
                <span className="berthing-modal__file-zone-text">
                  {formVesselPhotos.length > 0 ? `${formVesselPhotos.length} file(s)` : 'Choose files'}
                </span>
                <input
                  type="file"
                  accept="image/*,.pdf"
                  multiple
                  onChange={addVesselPhotoFiles}
                  className="berthing-modal__file-input"
                />
              </label>
              {formVesselPhotos.length > 0 && (
                <ul className="loading-step-card__file-list">
                  {formVesselPhotos.map((f, i) => (
                    <li key={i}>{f.name}</li>
                  ))}
                </ul>
              )}
            </div>

            <div className="modal__footer">
              <button type="button" className="btn btn--secondary" onClick={closeModal}>
                Cancel
              </button>
              <button type="button" className="btn btn--primary" onClick={handleSubmit}>
                Submit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
