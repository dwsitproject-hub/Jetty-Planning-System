import { useState, Fragment, useEffect } from 'react'
import { nominations as initialList, SURVEYOR_OPTIONS, AGENT_OPTIONS, SHIPPER_OPTIONS, LOADING_PORT_OPTIONS } from '../data/mockData'
import '../styles/shipping-instruction.css'

function formatDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })
}

const COMMODITY_OPTIONS = ['CPO', 'CRUDE PALM OIL', 'POME', 'PKE', 'FAME', 'RBD PO']
const TERM_OPTIONS = ['FOB', 'CIF', 'CFR']

/** Set to true to show "Create New" (e.g. local/mock); false when data is streamed from other apps (staging/production) */
const SHOW_CREATE_NEW = false

const SI_COLUMNS = [
  { key: 'vessel', label: 'Vessel', getValue: (n) => <strong>{n.vesselName || n.vesselId || '—'}</strong>, getSortValue: (n) => (n.vesselName || n.vesselId || '').toLowerCase() },
  { key: 'eta', label: 'ETA window', getValue: (n) => (n.etaFrom && n.etaTo ? `${n.etaFrom} → ${n.etaTo}` : n.ETA || '—'), getSortValue: (n) => n.etaFrom || n.ETA || '' },
  { key: 'commodity', label: 'Commodity', getValue: (n) => n.commodity || n.product || '—', getSortValue: (n) => (n.commodity || n.product || '').toLowerCase() },
  { key: 'qty', label: 'Qty (kg)', getValue: (n) => (n.totalQtyKg ?? n.quantity) != null ? (n.totalQtyKg ?? n.quantity).toLocaleString() : '—', getSortValue: (n) => Number(n.totalQtyKg ?? n.quantity ?? 0) },
  { key: 'shipper', label: 'Shipper', getValue: (n) => n.shipper || '—', getSortValue: (n) => (n.shipper || '').toLowerCase() },
  { key: 'received', label: 'Received', getValue: (n) => formatDate(n.receivedAt), getSortValue: (n) => (n.receivedAt || '').toString() },
]

const emptyBreakdownRow = () => ({ shipper: '', contractNo: '', poNo: '', qtyKg: '', remarks: '' })

function nextDocId() {
  return 'doc-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)
}

export default function ShippingInstruction() {
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [list, setList] = useState(initialList)
  const [filters, setFilters] = useState({ vessel: '', eta: '', commodity: '', qty: '', shipper: '', received: '' })
  const [sortState, setSortState] = useState({ key: 'received', dir: 'desc' })
  const [expandedId, setExpandedId] = useState(null)
  const [form, setForm] = useState({
    vesselName: '',
    etaFrom: '',
    etaTo: '',
    shipper: '',
    loadingPort: '',
    commodity: 'CPO',
    term: 'FOB',
    totalQtyKg: '',
    surveyor: '',
    agent: '',
    breakdown: [emptyBreakdownRow()],
    qualityFFA: '',
    qualityMI: '',
    documents: [],
  })

  const updateForm = (updates) => setForm((f) => ({ ...f, ...updates }))

  const addBreakdownRow = () => {
    setForm((f) => ({ ...f, breakdown: [...f.breakdown, emptyBreakdownRow()] }))
  }

  const updateBreakdownRow = (index, field, value) => {
    setForm((f) => {
      const next = [...f.breakdown]
      next[index] = { ...next[index], [field]: value }
      return { ...f, breakdown: next }
    })
  }

  const removeBreakdownRow = (index) => {
    if (form.breakdown.length <= 1) return
    setForm((f) => ({ ...f, breakdown: f.breakdown.filter((_, i) => i !== index) }))
  }

  const addDocuments = (e) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    const newDocs = Array.from(files).map((file) => ({ id: nextDocId(), name: file.name }))
    setForm((f) => ({ ...f, documents: [...f.documents, ...newDocs] }))
    e.target.value = ''
  }

  const removeDocument = (id) => {
    setForm((f) => ({ ...f, documents: f.documents.filter((d) => d.id !== id) }))
  }

  const breakdownTotalKg = form.breakdown.reduce((sum, row) => sum + (Number(row.qtyKg) || 0), 0)

  const handleSubmit = (e) => {
    e.preventDefault()
    const totalQtyKg = Number(form.totalQtyKg) || breakdownTotalKg || 0
    const newSI = {
      id: 'n' + (list.length + 1),
      vesselName: form.vesselName.trim(),
      etaFrom: form.etaFrom || null,
      etaTo: form.etaTo || null,
      shipper: form.shipper.trim(),
      loadingPort: form.loadingPort.trim(),
      commodity: form.commodity,
      term: form.term,
      totalQtyKg,
      surveyor: form.surveyor || null,
      agent: form.agent || null,
      breakdown: form.breakdown
        .filter((r) => r.contractNo || r.poNo || r.qtyKg)
        .map((r) => ({
          shipper: r.shipper,
          contractNo: r.contractNo,
          poNo: r.poNo,
          qtyKg: Number(r.qtyKg) || 0,
          remarks: r.remarks,
        })),
      qualityFFA: form.qualityFFA === '' ? null : Number(form.qualityFFA),
      qualityMI: form.qualityMI === '' ? null : Number(form.qualityMI),
      documents: form.documents.map((d) => ({ id: d.id, name: d.name })),
      receivedAt: new Date().toISOString(),
    }
    setList([newSI, ...list])
    setForm({
      vesselName: '',
      etaFrom: '',
      etaTo: '',
      shipper: '',
      loadingPort: '',
      commodity: 'CPO',
      term: 'FOB',
      totalQtyKg: '',
      surveyor: '',
      agent: '',
      breakdown: [emptyBreakdownRow()],
      qualityFFA: '',
      qualityMI: '',
      documents: [],
    })
    setIsFormOpen(false)
  }

  const handleCloseModal = () => {
    setIsFormOpen(false)
  }

  useEffect(() => {
    if (!isFormOpen) return
    const onKeyDown = (e) => {
      if (e.key === 'Escape') handleCloseModal()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isFormOpen])

  const updateFilter = (key, value) => setFilters((f) => ({ ...f, [key]: value }))
  const handleSort = (key) => setSortState((s) => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }))

  const filteredList = list.filter((n) => {
    const vessel = (n.vesselName || n.vesselId || '').toLowerCase()
    const eta = (n.etaFrom && n.etaTo ? `${n.etaFrom} ${n.etaTo}` : n.ETA || '').toLowerCase()
    const commodity = (n.commodity || n.product || '').toLowerCase()
    const qtyStr = String(n.totalQtyKg ?? n.quantity ?? '')
    const shipper = (n.shipper || '').toLowerCase()
    const received = (n.receivedAt || '').toLowerCase()
    return (
      (!filters.vessel || vessel.includes(filters.vessel.trim().toLowerCase())) &&
      (!filters.eta || eta.includes(filters.eta.trim().toLowerCase())) &&
      (!filters.commodity || commodity.includes(filters.commodity.trim().toLowerCase())) &&
      (!filters.qty || qtyStr.includes(filters.qty.trim())) &&
      (!filters.shipper || shipper.includes(filters.shipper.trim().toLowerCase())) &&
      (!filters.received || received.includes(filters.received.trim().toLowerCase()))
    )
  })

  const sortedList = [...filteredList].sort((a, b) => {
    const col = SI_COLUMNS.find((c) => c.key === sortState.key)
    if (!col) return 0
    const va = col.getSortValue(a)
    const vb = col.getSortValue(b)
    const isNum = typeof va === 'number' && typeof vb === 'number'
    let cmp = 0
    if (isNum) cmp = va - vb
    else cmp = String(va).localeCompare(String(vb), undefined, { numeric: true })
    return sortState.dir === 'asc' ? cmp : -cmp
  })

  return (
    <div className="shipping-instruction-page">
      <h1 className="page-title">Shipping Instruction</h1>
      <p className="shipping-instruction-page__intro">
        Create vessel trip and log ETA and quantity. Key in vessel name/barge ID, ETA window, contract/PO, commodity, loading qty, and loading quality.
      </p>

      {SHOW_CREATE_NEW && (
        <div className="shipping-instruction-create-bar">
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => setIsFormOpen(true)}
            aria-expanded={isFormOpen}
          >
            Create New
          </button>
        </div>
      )}

      {isFormOpen && (
        <div className="modal-overlay" onClick={handleCloseModal} aria-hidden="true">
          <div
            className="modal modal--wide"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-labelledby="si-modal-title"
            aria-modal="true"
          >
            <h2 id="si-modal-title" className="modal__title">Create Vessel Trip / New Shipping Instruction</h2>
            <form onSubmit={handleSubmit} className="shipping-instruction-form">
              <div className="shipping-instruction-form__section">
                <h3 className="shipping-instruction-form__section-title">Vessel & trip</h3>
                <div className="shipping-instruction-form__grid">
                  <div className="input-group">
                    <label htmlFor="vesselName">Vessel Name / Barge ID *</label>
                    <input
                      id="vesselName"
                      value={form.vesselName}
                      onChange={(e) => updateForm({ vesselName: e.target.value })}
                      required
                      placeholder="e.g. TB. ARIA CITRA IV / BG. MULIA VII"
                    />
                  </div>
                  <div className="input-group">
                    <label htmlFor="etaFrom">ETA from *</label>
                    <input id="etaFrom" type="date" value={form.etaFrom} onChange={(e) => updateForm({ etaFrom: e.target.value })} required />
                  </div>
                  <div className="input-group">
                    <label htmlFor="etaTo">ETA to *</label>
                    <input id="etaTo" type="date" value={form.etaTo} onChange={(e) => updateForm({ etaTo: e.target.value })} required />
                  </div>
                  <div className="input-group">
                    <label htmlFor="commodity">Commodity *</label>
                    <select id="commodity" value={form.commodity} onChange={(e) => updateForm({ commodity: e.target.value })}>
                      {COMMODITY_OPTIONS.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                  <div className="input-group">
                    <label htmlFor="term">Term</label>
                    <select id="term" value={form.term} onChange={(e) => updateForm({ term: e.target.value })}>
                      {TERM_OPTIONS.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                  <div className="input-group">
                    <label htmlFor="totalQtyKg">Total loading qty (kg) *</label>
                    <input
                      id="totalQtyKg"
                      type="number"
                      min="1"
                      value={form.totalQtyKg}
                      onChange={(e) => updateForm({ totalQtyKg: e.target.value })}
                      placeholder="e.g. 3001887"
                    />
                  </div>
                </div>
              </div>

              <div className="shipping-instruction-form__section">
                <h3 className="shipping-instruction-form__section-title">Party & port</h3>
                <div className="shipping-instruction-form__grid">
                  <div className="input-group">
                    <label htmlFor="shipper">Shipper</label>
                    <select id="shipper" value={form.shipper} onChange={(e) => updateForm({ shipper: e.target.value })}>
                      <option value="">—</option>
                      {SHIPPER_OPTIONS.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                  <div className="input-group">
                    <label htmlFor="loadingPort">Loading port</label>
                    <select id="loadingPort" value={form.loadingPort} onChange={(e) => updateForm({ loadingPort: e.target.value })}>
                      <option value="">—</option>
                      {LOADING_PORT_OPTIONS.map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                  </div>
                  <div className="input-group">
                    <label htmlFor="surveyor">Surveyor</label>
                    <select id="surveyor" value={form.surveyor} onChange={(e) => updateForm({ surveyor: e.target.value })}>
                      <option value="">—</option>
                      {SURVEYOR_OPTIONS.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                  <div className="input-group">
                    <label htmlFor="agent">Agent</label>
                    <select id="agent" value={form.agent} onChange={(e) => updateForm({ agent: e.target.value })}>
                      <option value="">—</option>
                      {AGENT_OPTIONS.map((a) => (
                        <option key={a} value={a}>{a}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="shipping-instruction-form__section">
                <h3 className="shipping-instruction-form__section-title">Shipment breakdown (Kontrak / PO)</h3>
                <div className="table-wrap">
                  <table className="data-table shipping-instruction-breakdown-table">
                    <thead>
                      <tr>
                        <th>Shipper</th>
                        <th>Contract No (Kontrak)</th>
                        <th>PO No</th>
                        <th>Qty (kg)</th>
                        <th>Remarks (Keterangan)</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {form.breakdown.map((row, i) => (
                        <tr key={i}>
                          <td>
                            <input
                              value={row.shipper}
                              onChange={(e) => updateBreakdownRow(i, 'shipper', e.target.value)}
                              placeholder="e.g. PT. TBP"
                              className="shipping-instruction-inline-input"
                            />
                          </td>
                          <td>
                            <input
                              value={row.contractNo}
                              onChange={(e) => updateBreakdownRow(i, 'contractNo', e.target.value)}
                              placeholder="e.g. 001/TBP-EUP/FOB-CPO/01/26"
                              className="shipping-instruction-inline-input"
                            />
                          </td>
                          <td>
                            <input
                              value={row.poNo}
                              onChange={(e) => updateBreakdownRow(i, 'poNo', e.target.value)}
                              placeholder="e.g. 1001027272"
                              className="shipping-instruction-inline-input"
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              min="0"
                              value={row.qtyKg}
                              onChange={(e) => updateBreakdownRow(i, 'qtyKg', e.target.value)}
                              placeholder="0"
                              className="shipping-instruction-inline-input shipping-instruction-inline-input--num"
                            />
                          </td>
                          <td>
                            <input
                              value={row.remarks}
                              onChange={(e) => updateBreakdownRow(i, 'remarks', e.target.value)}
                              placeholder="—"
                              className="shipping-instruction-inline-input"
                            />
                          </td>
                          <td>
                            <button
                              type="button"
                              className="btn btn--secondary shipping-instruction-btn-remove"
                              onClick={() => removeBreakdownRow(i)}
                              disabled={form.breakdown.length <= 1}
                              aria-label="Remove row"
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={3} className="shipping-instruction-total-label">TOTAL</td>
                        <td className="shipping-instruction-total-value">{breakdownTotalKg.toLocaleString()}</td>
                        <td colSpan={2}></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <button type="button" className="btn btn--secondary" onClick={addBreakdownRow}>
                  + Add row
                </button>
              </div>

              <div className="shipping-instruction-form__section">
                <h3 className="shipping-instruction-form__section-title">Document upload</h3>
                <p className="text-steel" style={{ marginBottom: 'var(--spacing-2)', fontSize: 'var(--font-size-small)' }}>
                  Add multiple documents. Only file names are stored (no file content).
                </p>
                <input
                  type="file"
                  multiple
                  onChange={addDocuments}
                  style={{ display: 'block', marginBottom: 'var(--spacing-2)' }}
                  aria-label="Add documents"
                />
                {form.documents.length > 0 ? (
                  <ul className="shipping-instruction-docs">
                    {form.documents.map((d) => (
                      <li key={d.id} className="shipping-instruction-docs__item">
                        <span className="shipping-instruction-docs__name">{d.name}</span>
                        <button type="button" className="btn btn--secondary btn--small" onClick={() => removeDocument(d.id)} aria-label={`Remove ${d.name}`}>
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-steel" style={{ fontSize: 'var(--font-size-small)' }}>No documents added.</p>
                )}
              </div>

              <div className="shipping-instruction-form__section">
                <h3 className="shipping-instruction-form__section-title">Loading quality</h3>
                <div className="shipping-instruction-form__grid shipping-instruction-form__grid--quality">
                  <div className="input-group">
                    <label htmlFor="qualityFFA">FFA (%)</label>
                    <input
                      id="qualityFFA"
                      type="number"
                      step="0.01"
                      min="0"
                      value={form.qualityFFA}
                      onChange={(e) => updateForm({ qualityFFA: e.target.value })}
                      placeholder="e.g. 3.57"
                    />
                  </div>
                  <div className="input-group">
                    <label htmlFor="qualityMI">M&I (%)</label>
                    <input
                      id="qualityMI"
                      type="number"
                      step="0.01"
                      min="0"
                      value={form.qualityMI}
                      onChange={(e) => updateForm({ qualityMI: e.target.value })}
                      placeholder="e.g. 0.43"
                    />
                  </div>
                </div>
              </div>

              <div className="modal__footer">
                <button type="button" className="btn btn--secondary" onClick={handleCloseModal}>
                  Cancel
                </button>
                <button type="submit" className="btn btn--primary">Submit</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <section className="card">
        <h2 className="card__title">Shipping instructions</h2>
        <div className="table-wrap">
          <table className="data-table shipping-instruction-table">
            <thead>
              <tr>
                <th className="shipping-instruction-table__expand-col"></th>
                {SI_COLUMNS.map((col) => (
                  <th key={col.key} className="shipping-instruction-table__th">
                    <button
                      type="button"
                      className="shipping-instruction-table__sort"
                      onClick={() => handleSort(col.key)}
                      title={`Sort by ${col.label}`}
                    >
                      {col.label}
                      <span className="shipping-instruction-table__sort-icon">
                        {sortState.key === col.key ? (sortState.dir === 'asc' ? ' ↑' : ' ↓') : ' ⇅'}
                      </span>
                    </button>
                  </th>
                ))}
              </tr>
              <tr className="shipping-instruction-table__filter-row">
                <th className="shipping-instruction-table__expand-col"></th>
                {SI_COLUMNS.map((col) => (
                  <th key={col.key}>
                    <input
                      type="text"
                      className="shipping-instruction-table__filter"
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
              {sortedList.map((n) => (
                <Fragment key={n.id}>
                  <tr
                    className={`shipping-instruction-table__row ${expandedId === n.id ? 'shipping-instruction-table__row--expanded' : ''}`}
                    onClick={() => setExpandedId((id) => (id === n.id ? null : n.id))}
                  >
                    <td className="shipping-instruction-table__expand-col">
                      <span className="shipping-instruction-table__expand-icon" aria-hidden>
                        {expandedId === n.id ? '▼' : '▶'}
                      </span>
                    </td>
                    {SI_COLUMNS.map((col) => (
                      <td key={col.key}>{col.getValue(n)}</td>
                    ))}
                  </tr>
                  {expandedId === n.id && (
                    <tr key={n.id + '-detail'} className="shipping-instruction-table__detail-row">
                      <td colSpan={SI_COLUMNS.length + 1} className="shipping-instruction-table__detail-cell">
                        <div className="shipping-instruction-detail">
                          <h4 className="shipping-instruction-detail__title">Full details</h4>
                          <dl className="shipping-instruction-detail__grid">
                            <dt>Vessel</dt><dd>{n.vesselName || n.vesselId || '—'}</dd>
                            <dt>ETA</dt><dd>{n.etaFrom && n.etaTo ? `${n.etaFrom} → ${n.etaTo}` : n.ETA || '—'}</dd>
                            <dt>Commodity</dt><dd>{n.commodity || n.product || '—'}</dd>
                            <dt>Term</dt><dd>{n.term || '—'}</dd>
                            <dt>Total qty (kg)</dt><dd>{(n.totalQtyKg ?? n.quantity) != null ? (n.totalQtyKg ?? n.quantity).toLocaleString() : '—'}</dd>
                            <dt>Shipper</dt><dd>{n.shipper || '—'}</dd>
                            <dt>Loading port</dt><dd>{n.loadingPort || '—'}</dd>
                            <dt>Surveyor</dt><dd>{n.surveyor || '—'}</dd>
                            <dt>Agent</dt><dd>{n.agent || '—'}</dd>
                            <dt>Loading quality FFA (%)</dt><dd>{n.qualityFFA != null ? n.qualityFFA : '—'}</dd>
                            <dt>Loading quality M&I (%)</dt><dd>{n.qualityMI != null ? n.qualityMI : '—'}</dd>
                            <dt>Received</dt><dd>{formatDate(n.receivedAt)}</dd>
                          </dl>
                          {n.documents && n.documents.length > 0 && (
                            <div className="shipping-instruction-detail__docs">
                              <h4 className="shipping-instruction-detail__subtitle">Documents</h4>
                              <ul className="shipping-instruction-detail__docs-list">
                                {n.documents.map((d) => (
                                  <li key={d.id}>{d.name}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {n.breakdown && n.breakdown.length > 0 && (
                            <>
                              <h4 className="shipping-instruction-detail__subtitle">Shipment breakdown</h4>
                              <table className="data-table shipping-instruction-detail__table">
                                <thead>
                                  <tr>
                                    <th>Shipper</th>
                                    <th>Contract No</th>
                                    <th>PO No</th>
                                    <th>Qty (kg)</th>
                                    <th>Remarks</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {n.breakdown.map((row, i) => (
                                    <tr key={i}>
                                      <td>{row.shipper || '—'}</td>
                                      <td>{row.contractNo || '—'}</td>
                                      <td>{row.poNo || '—'}</td>
                                      <td>{row.qtyKg != null ? row.qtyKg.toLocaleString() : '—'}</td>
                                      <td>{row.remarks || '—'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </>
                          )}
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
