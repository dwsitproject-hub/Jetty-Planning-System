import { useState, Fragment, useEffect } from 'react'
import { allocationPlan as initialPlan, BERTH_IDS, berths, vessels, activeVesselMetrics } from '../data/mockData'
import JettySchematic from '../components/JettySchematic'
import '../styles/allocation.css'

function getVesselName(vesselId) {
  return vessels[vesselId]?.vesselName ?? vesselId
}

const PRIORITY_OPTIONS = ['Low', 'Moderate', 'High', 'Critical']

const ALLOCATION_COLUMNS = [
  { key: 'sequence', label: 'Docking sequence', getValue: (r) => r.sequence ?? '—', getSortValue: (r) => r.sequence ?? 0 },
  { key: 'vesselName', label: 'Vessel Name', getValue: (r) => <strong>{r.vesselName || '—'}</strong>, getSortValue: (r) => (r.vesselName || '').toLowerCase() },
  { key: 'priority', label: 'Priority', getValue: (r) => r.priority || '—', getSortValue: (r) => (r.priority || '').toLowerCase() },
  { key: 'cargo', label: 'Cargo', getValue: (r) => r.cargo || '—', getSortValue: (r) => (r.cargo || '').toLowerCase() },
  { key: 'loadDischarge', label: 'Load/Discharge', getValue: (r) => r.loadDischarge || '—', getSortValue: (r) => (r.loadDischarge || '').toLowerCase() },
  { key: 'blQtyMtKl', label: 'BL Qty (MT/KL)', getValue: (r) => r.blQtyMtKl || '—', getSortValue: (r) => (r.blQtyMtKl || '').toLowerCase() },
  { key: 'shipper', label: 'Shipper', getValue: (r) => r.shipper || '—', getSortValue: (r) => (r.shipper || '').toLowerCase() },
  { key: 'term', label: 'Term', getValue: (r) => r.term || '—', getSortValue: (r) => (r.term || '').toLowerCase() },
  { key: 'portOfLoading', label: 'Port of Loading', getValue: (r) => r.portOfLoading || '—', getSortValue: (r) => (r.portOfLoading || '').toLowerCase() },
  { key: 'agent', label: 'Agent', getValue: (r) => r.agent || '—', getSortValue: (r) => (r.agent || '').toLowerCase() },
  { key: 'surveyor', label: 'Surveyor', getValue: (r) => r.surveyor || '—', getSortValue: (r) => (r.surveyor || '').toLowerCase() },
  { key: 'eta', label: 'ETA', getValue: (r) => r.eta || '—', getSortValue: (r) => (r.eta || '').toLowerCase() },
  { key: 'ta', label: 'TA', getValue: (r) => r.ta || '—', getSortValue: (r) => (r.ta || '').toLowerCase() },
  { key: 'etb', label: 'ETB', getValue: (r) => r.etb || '—', getSortValue: (r) => (r.etb || '').toLowerCase() },
  { key: 'jetty', label: 'Jetty', getValue: (r) => r.jetty || '—', getSortValue: (r) => (r.jetty || '').toLowerCase() },
  { key: 'remarks', label: 'Remarks', getValue: (r) => r.remarks || '—', getSortValue: (r) => (r.remarks || '').toLowerCase() },
]

/** Format datetime-local value to display string (dd/mm hh:mm LT) */
function formatDateTimeDisplay(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const hours = String(d.getHours()).padStart(2, '0')
  const mins = String(d.getMinutes()).padStart(2, '0')
  return `${day}/${month} ${hours}:${mins} LT`
}

export default function Allocation() {
  const [list, setList] = useState(initialPlan)
  const [berthsState, setBerthsState] = useState(() => [...berths].map((b) => ({ ...b })))
  const filterKeys = ALLOCATION_COLUMNS.map((c) => c.key)
  const [filters, setFilters] = useState(Object.fromEntries(filterKeys.map((k) => [k, ''])))
  const [sortState, setSortState] = useState({ key: 'sequence', dir: 'asc' })
  const [expandedId, setExpandedId] = useState(null)
  const [vesselDetailModalVesselId, setVesselDetailModalVesselId] = useState(null)
  const [arrivalUpdateForm, setArrivalUpdateForm] = useState(null)
  const [dockingConfirmRow, setDockingConfirmRow] = useState(null)
  const [dockingError, setDockingError] = useState(null)

  const openArrivalUpdate = (r) => {
    setArrivalUpdateForm({
      ...r,
      etaDateTime: r.etaDateTime || '',
      taDateTime: r.taDateTime || '',
      etbDateTime: r.etbDateTime || '',
    })
  }

  const saveArrivalUpdate = () => {
    if (!arrivalUpdateForm) return
    const newSequence = Math.max(1, Math.min(list.length, Number(arrivalUpdateForm.sequence) || 1))
    const updated = {
      ...arrivalUpdateForm,
      sequence: newSequence,
      eta: arrivalUpdateForm.etaDateTime ? formatDateTimeDisplay(arrivalUpdateForm.etaDateTime) : arrivalUpdateForm.eta,
      ta: arrivalUpdateForm.taDateTime ? formatDateTimeDisplay(arrivalUpdateForm.taDateTime) : arrivalUpdateForm.ta,
      etb: arrivalUpdateForm.etbDateTime ? formatDateTimeDisplay(arrivalUpdateForm.etbDateTime) : arrivalUpdateForm.etb,
    }
    const listWithUpdate = list.map((row) => (row.id === arrivalUpdateForm.id ? updated : row))
    const bySequence = [...listWithUpdate].sort((a, b) => (a.sequence ?? 999) - (b.sequence ?? 999))
    const renumbered = bySequence.map((row, i) => ({ ...row, sequence: i + 1 }))
    setList(renumbered)
    setArrivalUpdateForm(null)
  }

  const moveSequenceUp = (r, e) => {
    e.stopPropagation()
    const bySeq = [...list].sort((a, b) => (a.sequence ?? 999) - (b.sequence ?? 999))
    const i = bySeq.findIndex((row) => row.id === r.id)
    if (i <= 0) return
    ;[bySeq[i - 1], bySeq[i]] = [bySeq[i], bySeq[i - 1]]
    const renumbered = bySeq.map((row, idx) => ({ ...row, sequence: idx + 1 }))
    setList(renumbered)
  }

  const moveSequenceDown = (r, e) => {
    e.stopPropagation()
    const bySeq = [...list].sort((a, b) => (a.sequence ?? 999) - (b.sequence ?? 999))
    const i = bySeq.findIndex((row) => row.id === r.id)
    if (i < 0 || i >= bySeq.length - 1) return
    ;[bySeq[i], bySeq[i + 1]] = [bySeq[i + 1], bySeq[i]]
    const renumbered = bySeq.map((row, idx) => ({ ...row, sequence: idx + 1 }))
    setList(renumbered)
  }

  const handleBerthClick = (berthId) => {
    const berth = berthsState.find((b) => b.id === berthId)
    if (berth?.currentVesselId) setVesselDetailModalVesselId(berth.currentVesselId)
  }

  /** Resolve row.jetty to a single berth id (e.g. "1A" or "1A/2A" → "1A") */
  const getTargetJettyId = (row) => {
    const raw = (row.jetty || '').trim()
    return raw.split('/')[0].trim() || null
  }

  const handleDockingConfirm = () => {
    if (!dockingConfirmRow) return
    const targetJettyId = getTargetJettyId(dockingConfirmRow)
    if (!targetJettyId) {
      setDockingError('No jetty assigned to this vessel.')
      return
    }
    const berth = berthsState.find((b) => b.id === targetJettyId)
    if (!berth) {
      setDockingError(`Jetty ${targetJettyId} not found.`)
      return
    }
    if (berth.currentVesselId) {
      const occupantName = getVesselName(berth.currentVesselId)
      setDockingError(`Docking failed: Jetty ${targetJettyId} is occupied by ${occupantName}.`)
      return
    }
    setBerthsState((prev) =>
      prev.map((b) => (b.id === targetJettyId ? { ...b, currentVesselId: dockingConfirmRow.vesselId } : b))
    )
    setList((prev) => {
      const next = prev.filter((r) => r.id !== dockingConfirmRow.id)
      return next.map((row, i) => ({ ...row, sequence: i + 1 }))
    })
    setDockingConfirmRow(null)
    setDockingError(null)
  }

  const openDockingConfirm = (r, e) => {
    e.stopPropagation()
    setDockingError(null)
    setDockingConfirmRow(r)
  }

  const closeDockingConfirm = () => {
    setDockingConfirmRow(null)
    setDockingError(null)
  }

  useEffect(() => {
    if (!vesselDetailModalVesselId) return
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setVesselDetailModalVesselId(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [vesselDetailModalVesselId])

  useEffect(() => {
    if (!arrivalUpdateForm) return
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setArrivalUpdateForm(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [arrivalUpdateForm])

  useEffect(() => {
    if (!dockingConfirmRow) return
    const onKeyDown = (e) => {
      if (e.key === 'Escape') closeDockingConfirm()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [dockingConfirmRow])

  const updateFilter = (key, value) => setFilters((f) => ({ ...f, [key]: value }))
  const handleSort = (key) => setSortState((s) => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }))

  const filteredList = list.filter((r) => {
    return filterKeys.every((key) => {
      const f = (filters[key] || '').trim().toLowerCase()
      if (!f) return true
      const val = r[key]
      return String(val ?? '').toLowerCase().includes(f)
    })
  })

  const sortedList = [...filteredList].sort((a, b) => {
    const col = ALLOCATION_COLUMNS.find((c) => c.key === sortState.key)
    if (!col) return 0
    const va = col.getSortValue(a)
    const vb = col.getSortValue(b)
    const isNum = typeof va === 'number' && typeof vb === 'number'
    const cmp = isNum ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true })
    return sortState.dir === 'asc' ? cmp : -cmp
  })

  return (
    <div className="allocation-page">
      <h1 className="page-title">Allocation</h1>
      <p className="allocation-page__intro">
        Berth planning & jetty allocation. Assign jetty and priority. View which jetties are occupied above.
      </p>

      <JettySchematic berths={berthsState} onSelectBerth={handleBerthClick} />

      {/* Active Vessel Detail modal (opens when user clicks an occupied ship block) */}
      {vesselDetailModalVesselId && (
        <div
          className="modal-overlay"
          onClick={() => setVesselDetailModalVesselId(null)}
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
              ⚓ Active Vessel Detail: {getVesselName(vesselDetailModalVesselId)}
            </h2>
            {activeVesselMetrics[vesselDetailModalVesselId] ? (
              <div className="modal__section">
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Operational Metric</th>
                        <th>Value / Status</th>
                        <th>Source Document</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeVesselMetrics[vesselDetailModalVesselId].map((row, i) => (
                        <tr key={i}>
                          <td><strong>{row.metric}</strong></td>
                          <td>
                            {row.clean && '✅ '}
                            <span className={row.alert ? 'text-alert' : ''}>{row.value}</span>
                            {row.alert && <span className="badge badge--alert">Alert: Low</span>}
                          </td>
                          <td style={{ color: 'var(--color-text-steel)' }}>{row.source}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <p className="text-steel">No metrics available for this vessel.</p>
            )}
            <div className="modal__footer">
              <button type="button" className="btn btn--primary" onClick={() => setVesselDetailModalVesselId(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Docking confirmation modal */}
      {dockingConfirmRow && (
        <div
          className="modal-overlay"
          onClick={closeDockingConfirm}
          aria-hidden="true"
        >
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-labelledby="docking-confirm-title"
            aria-modal="true"
          >
            <h2 id="docking-confirm-title" className="modal__title">
              Confirm Docking
            </h2>
            <div className="modal__section">
              <p>
                Move <strong>{dockingConfirmRow.vesselName || '—'}</strong> to Jetty <strong>{getTargetJettyId(dockingConfirmRow) || '—'}</strong>?
                This will place the vessel on the Jetty Schematic and remove it from the allocation table.
              </p>
              {dockingError && (
                <p className="text-alert" style={{ marginTop: 'var(--spacing-2)' }}>
                  {dockingError}
                </p>
              )}
            </div>
            <div className="modal__footer">
              <button type="button" className="btn btn--secondary" onClick={closeDockingConfirm}>
                Cancel
              </button>
              <button type="button" className="btn btn--primary" onClick={handleDockingConfirm}>
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

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
              Log arrival update: {arrivalUpdateForm.vesselName || '—'}
            </h2>

            <div className="modal__section">
              <h3 className="allocation-arrival-form__section-title">Vessel & cargo</h3>
              <div className="allocation-arrival-form__grid">
                <div className="input-group">
                  <label htmlFor="arrival-vesselName">Vessel name</label>
                  <input
                    id="arrival-vesselName"
                    type="text"
                    value={arrivalUpdateForm.vesselName || ''}
                    onChange={(e) => setArrivalUpdateForm((f) => ({ ...f, vesselName: e.target.value }))}
                  />
                </div>
                <div className="input-group">
                  <label htmlFor="arrival-cargo">Cargo / product</label>
                  <input
                    id="arrival-cargo"
                    type="text"
                    value={arrivalUpdateForm.cargo || ''}
                    onChange={(e) => setArrivalUpdateForm((f) => ({ ...f, cargo: e.target.value }))}
                    placeholder="e.g. CPO, POME, PKE"
                  />
                </div>
                <div className="input-group">
                  <label htmlFor="arrival-loadDischarge">Load / discharge</label>
                  <select
                    id="arrival-loadDischarge"
                    value={arrivalUpdateForm.loadDischarge || ''}
                    onChange={(e) => setArrivalUpdateForm((f) => ({ ...f, loadDischarge: e.target.value }))}
                  >
                    <option value="">—</option>
                    <option value="LOAD">Loading</option>
                    <option value="DISCH">Discharge</option>
                  </select>
                </div>
                <div className="input-group">
                  <label htmlFor="arrival-blQtyMtKl">BL qty (MT/KL)</label>
                  <input
                    id="arrival-blQtyMtKl"
                    type="text"
                    value={arrivalUpdateForm.blQtyMtKl || ''}
                    onChange={(e) => setArrivalUpdateForm((f) => ({ ...f, blQtyMtKl: e.target.value }))}
                    placeholder="e.g. 3,406 MT"
                  />
                </div>
                <div className="input-group">
                  <label htmlFor="arrival-portOfLoading">Port of loading / last port</label>
                  <input
                    id="arrival-portOfLoading"
                    type="text"
                    value={arrivalUpdateForm.portOfLoading || ''}
                    onChange={(e) => setArrivalUpdateForm((f) => ({ ...f, portOfLoading: e.target.value }))}
                  />
                </div>
                <div className="input-group">
                  <label htmlFor="arrival-agent">Agent</label>
                  <input
                    id="arrival-agent"
                    type="text"
                    value={arrivalUpdateForm.agent || ''}
                    onChange={(e) => setArrivalUpdateForm((f) => ({ ...f, agent: e.target.value }))}
                    placeholder="e.g. PT. SCM, TPB BONTANG"
                  />
                </div>
                <div className="input-group">
                  <label htmlFor="arrival-priority">Priority</label>
                  <select
                    id="arrival-priority"
                    value={arrivalUpdateForm.priority || ''}
                    onChange={(e) => setArrivalUpdateForm((f) => ({ ...f, priority: e.target.value }))}
                  >
                    <option value="">—</option>
                    {PRIORITY_OPTIONS.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="modal__section">
              <h3 className="allocation-arrival-form__section-title">Docking sequence & times</h3>
              <div className="allocation-arrival-form__grid">
                <div className="input-group">
                  <label htmlFor="arrival-sequence">Docking sequence</label>
                  <input
                    id="arrival-sequence"
                    type="number"
                    min={1}
                    max={list.length}
                    value={arrivalUpdateForm.sequence ?? ''}
                    onChange={(e) => setArrivalUpdateForm((f) => ({ ...f, sequence: e.target.value === '' ? '' : Number(e.target.value) }))}
                    placeholder="1 = first to dock"
                  />
                </div>
                <div className="input-group">
                  <label htmlFor="arrival-eta">ETA Bontang</label>
                  <input
                    id="arrival-eta"
                    type="datetime-local"
                    value={arrivalUpdateForm.etaDateTime || ''}
                    onChange={(e) => setArrivalUpdateForm((f) => ({ ...f, etaDateTime: e.target.value }))}
                  />
                </div>
                <div className="input-group">
                  <label htmlFor="arrival-ta">TA / actual arrival</label>
                  <input
                    id="arrival-ta"
                    type="datetime-local"
                    value={arrivalUpdateForm.taDateTime || ''}
                    onChange={(e) => setArrivalUpdateForm((f) => ({ ...f, taDateTime: e.target.value }))}
                  />
                </div>
                <div className="input-group">
                  <label htmlFor="arrival-etb">ETB (estimated time berthing)</label>
                  <input
                    id="arrival-etb"
                    type="datetime-local"
                    value={arrivalUpdateForm.etbDateTime || ''}
                    onChange={(e) => setArrivalUpdateForm((f) => ({ ...f, etbDateTime: e.target.value }))}
                  />
                </div>
                <div className="input-group">
                  <label htmlFor="arrival-jetty">Jetty</label>
                  <select
                    id="arrival-jetty"
                    value={arrivalUpdateForm.jetty || ''}
                    onChange={(e) => setArrivalUpdateForm((f) => ({ ...f, jetty: e.target.value }))}
                  >
                    <option value="">—</option>
                    {BERTH_IDS.map((jid) => (
                      <option key={jid} value={jid}>{jid}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="modal__section">
              <label htmlFor="arrival-remarks" className="modal__label">Remarks</label>
              <textarea
                id="arrival-remarks"
                className="modal__textarea"
                rows={3}
                value={arrivalUpdateForm.remarks || ''}
                onChange={(e) => setArrivalUpdateForm((f) => ({ ...f, remarks: e.target.value }))}
                placeholder="e.g. Dropped anchor 12/02 01:10; ETB after BG. SMS 3000 at Jetty 2B; Source: WhatsApp"
              />
            </div>

            <div className="modal__footer">
              <button type="button" className="btn btn--secondary" onClick={() => setArrivalUpdateForm(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn--primary" onClick={saveArrivalUpdate}>
                Save update
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="card">
        <h2 className="card__title">Incoming vessel/barges & berthing plan</h2>
        <div className="table-wrap">
          <table className="data-table allocation-table">
            <thead>
              <tr>
                <th className="allocation-table__expand-col"></th>
                <th className="allocation-table__action-col">Action</th>
                {ALLOCATION_COLUMNS.map((col) => (
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
              </tr>
              <tr className="allocation-table__filter-row">
                <th className="allocation-table__expand-col"></th>
                <th className="allocation-table__action-col"></th>
                {ALLOCATION_COLUMNS.map((col) => (
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
              </tr>
            </thead>
            <tbody>
              {sortedList.map((r) => (
                <Fragment key={r.id}>
                  <tr
                    className={`allocation-table__row ${expandedId === r.id ? 'allocation-table__row--expanded' : ''}`}
                    onClick={() => setExpandedId((id) => (id === r.id ? null : r.id))}
                  >
                    <td className="allocation-table__expand-col">
                      <span className="allocation-table__expand-icon" aria-hidden>
                        {expandedId === r.id ? '▼' : '▶'}
                      </span>
                    </td>
                    <td className="allocation-table__action-col" onClick={(e) => e.stopPropagation()}>
                      <div className="allocation-table__action-btns">
                        <button type="button" className="btn btn--secondary btn--small" onClick={() => openArrivalUpdate(r)}>
                          Log arrival update
                        </button>
                        <button type="button" className="btn btn--success btn--small" onClick={(e) => openDockingConfirm(r, e)}>
                          Docking
                        </button>
                      </div>
                    </td>
                    {ALLOCATION_COLUMNS.map((col) => (
                      <td key={col.key} onClick={col.key === 'sequence' ? (e) => e.stopPropagation() : undefined}>
                        {col.key === 'sequence' ? (
                          <span className="allocation-table__sequence-cell">
                            <span className="allocation-table__sequence-num">{r.sequence ?? '—'}</span>
                            <span className="allocation-table__sequence-btns">
                              <button
                                type="button"
                                className="btn btn--small allocation-table__sequence-btn"
                                onClick={(e) => moveSequenceUp(r, e)}
                                disabled={sortedList.findIndex((x) => x.id === r.id) <= 0}
                                title="Move up"
                                aria-label="Move docking sequence up"
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                className="btn btn--small allocation-table__sequence-btn"
                                onClick={(e) => moveSequenceDown(r, e)}
                                disabled={sortedList.findIndex((x) => x.id === r.id) >= sortedList.length - 1}
                                title="Move down"
                                aria-label="Move docking sequence down"
                              >
                                ↓
                              </button>
                            </span>
                          </span>
                        ) : (
                          col.getValue(r)
                        )}
                      </td>
                    ))}
                  </tr>
                  {expandedId === r.id && (
                    <tr className="allocation-table__detail-row">
                      <td colSpan={ALLOCATION_COLUMNS.length + 2} className="allocation-table__detail-cell">
                        <div className="allocation-detail">
                          <h4 className="allocation-detail__title">Full details</h4>
                          <dl className="allocation-detail__grid">
                            <dt>Docking sequence</dt><dd>{r.sequence ?? '—'}</dd>
                            <dt>Vessel Name</dt><dd>{r.vesselName || '—'}</dd>
                            <dt>Priority</dt><dd>{r.priority || '—'}</dd>
                            <dt>Cargo</dt><dd>{r.cargo || '—'}</dd>
                            <dt>Load/Discharge</dt><dd>{r.loadDischarge || '—'}</dd>
                            <dt>BL Qty (MT/KL)</dt><dd>{r.blQtyMtKl || '—'}</dd>
                            <dt>Shipper</dt><dd>{r.shipper || '—'}</dd>
                            <dt>Term</dt><dd>{r.term || '—'}</dd>
                            <dt>Port of Loading</dt><dd>{r.portOfLoading || '—'}</dd>
                            <dt>Agent</dt><dd>{r.agent || '—'}</dd>
                            <dt>Surveyor</dt><dd>{r.surveyor || '—'}</dd>
                            <dt>ETA</dt><dd>{r.eta || '—'}</dd>
                            <dt>TA</dt><dd>{r.ta || '—'}</dd>
                            <dt>ETB</dt><dd>{r.etb || '—'}</dd>
                            <dt>Jetty</dt><dd>{r.jetty || '—'}</dd>
                            <dt>Remarks</dt><dd>{r.remarks || '—'}</dd>
                          </dl>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
