import { useState, Fragment, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { nominations as initialList, SURVEYOR_OPTIONS, AGENT_OPTIONS, SHIPPER_OPTIONS, LOADING_PORT_OPTIONS, BERTH_IDS } from '../data/mockData'
import '../styles/shipping-instruction.css'

function formatDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })
}

/** ETA as single date/time for table display */
function formatEta(n) {
  const raw = n.etaDateTime || n.etaFrom || n.ETA
  if (!raw) return '—'
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? raw : d.toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })
}

/** Action icons — outlined style, consistent size (18×18), use currentColor */
const IconRequestApproval = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg" className="si-action-icon si-action-icon--request" aria-hidden focusable="false">
    <path d="M4 2h8v10H4V2z" stroke="currentColor" strokeWidth="1.5" fill="none" />
    <path d="M5 5h6M5 7h4M5 9h5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    <circle className="si-action-icon__badge" cx="12" cy="11" r="3.25" stroke="currentColor" strokeWidth="1.25" fill="var(--color-bg-white, #fff)" />
    <path className="si-action-icon__check" d="M11 11l1.5 1.5 2.5-2.5" stroke="var(--color-primary)" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)
const IconView = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden focusable="false">
    <ellipse cx="9" cy="9" rx="5" ry="3" stroke="currentColor" strokeWidth="1.25" fill="none" />
    <circle cx="9" cy="9" r="1.25" stroke="currentColor" strokeWidth="1.25" fill="none" />
    <path d="M2 6c2 1.5 4 1.5 6 0M12 6c2 1.5 4 1.5 6 0" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
  </svg>
)
/** Stamp-of-approval icon (rubber stamp on checkmark) — for Approve SI action */
const IconApprove = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden focusable="false">
    <path d="M5 4h6l2 2v2H5V4z" stroke="currentColor" strokeWidth="1.25" fill="none" strokeLinejoin="round" />
    <path d="M6 4v4M9 4v4" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" />
    <ellipse cx="10" cy="12" rx="3" ry="2" stroke="currentColor" strokeWidth="1.25" fill="none" />
    <path d="M8.5 12l1.25 1.25 2-2" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/** Document with magnifying glass — for View SI document action */
const IconViewDocument = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden focusable="false">
    <path d="M4 2h7v12H4a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.25" fill="none" strokeLinejoin="round" />
    <path d="M5 5h5M5 7h4" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    <circle cx="11" cy="11" r="3.5" stroke="currentColor" strokeWidth="1.25" fill="none" />
    <path d="M13.5 13.5L15 15" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
  </svg>
)

const COMMODITY_OPTIONS = ['CPO', 'CRUDE PALM OIL', 'POME', 'PKE', 'FAME', 'RBD PO']
const TERM_OPTIONS = ['FOB', 'CIF', 'CFR']

/** Set to true to show "Create New SI" (e.g. local/mock); false when data is streamed from other apps (staging/production) */
const SHOW_CREATE_NEW = false

const PURPOSE_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'Loading', label: 'Loading' },
  { value: 'Unloading', label: 'Unloading' },
]

const STATUS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'Draft', label: 'Draft' },
  { value: 'Submitted', label: 'Submitted' },
  { value: 'Approved', label: 'Approved' },
]

/** Display status: Unloading = external (Received/Confirmed); Loading = internal (Draft/Submitted/Approved) */
function getDisplayStatus(n) {
  if (!n) return '—'
  if ((n.purpose || '').toLowerCase() === 'unloading') {
    if (n.status === 'Submitted') return 'Received'
    if (n.status === 'Approved') return 'Confirmed'
    return n.status || 'Received'
  }
  return n.status || 'Draft'
}

/** True if this SI uses internal approval (Loading only) */
function isInternalApprovalFlow(n) {
  return (n.purpose || '').toLowerCase() === 'loading'
}

/** View document is applicable for: Approved Loading SI, or Unloading / External SI */
function canViewAsDocument(n) {
  if (!n) return false
  const purpose = (n.purpose || '').toLowerCase()
  const status = (n.status || '').toLowerCase()
  if (purpose === 'unloading') return true
  if (purpose === 'loading' && status === 'approved') return true
  return false
}

/** Sortable table columns for new design (SI ID, Vessel/Agent, Material, Purpose, ETA, Status) */
const SI_TABLE_COLUMNS = [
  { key: 'siId', label: 'SI ID', getSortValue: (n) => (n.siId || '').toLowerCase() },
  { key: 'vessel', label: 'Vessel / Agent', getSortValue: (n) => (n.vesselName || n.vesselId || '').toLowerCase() },
  { key: 'commodity', label: 'Material', getSortValue: (n) => (n.commodity || n.product || '').toLowerCase() },
  { key: 'purpose', label: 'Purpose', getSortValue: (n) => (n.purpose || '').toLowerCase() },
  { key: 'eta', label: 'ETA', getSortValue: (n) => (n.etaDateTime || n.etaFrom || n.ETA || '').toString() },
  { key: 'status', label: 'Status', getSortValue: (n) => (n.status || '').toLowerCase() },
]

const emptyBreakdownRow = () => ({ shipper: '', contractNo: '', poNo: '', qtyKg: '', remarks: '' })

function nextDocId() {
  return 'doc-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)
}

function nextSiId(list) {
  const year = new Date().getFullYear()
  const nums = list.map((n) => { const m = (n.siId || '').match(/SI-\d{4}-(\d+)/); return m ? parseInt(m[1], 10) : 0 })
  const next = (nums.length ? Math.max(...nums) : 0) + 1
  return `SI-${year}-${String(next).padStart(4, '0')}`
}

export default function ShippingInstruction() {
  const navigate = useNavigate()
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [list, setList] = useState(initialList)
  const [searchQuery, setSearchQuery] = useState('')
  const [filters, setFilters] = useState({ purpose: '', status: '' })
  const [filtersPanelOpen, setFiltersPanelOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [sortState, setSortState] = useState({ key: 'siId', dir: 'desc' })
  const [expandedId, setExpandedId] = useState(null)
  const [form, setForm] = useState({
    vesselName: '',
    purpose: 'Unloading',
    etaFrom: '',
    etaTo: '',
    shipper: '',
    loadingPort: '',
    commodity: 'CPO',
    term: 'FOB',
    totalQtyKg: '',
    surveyor: '',
    agent: '',
    jetty: '',
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
      siId: nextSiId(list),
      status: 'Draft',
      vesselName: form.vesselName.trim(),
      purpose: form.purpose || 'Unloading',
      etaFrom: form.etaFrom || null,
      etaTo: form.etaTo || null,
      etaDateTime: form.etaFrom ? (form.etaFrom + 'T12:00:00') : null,
      shipper: form.shipper.trim(),
      loadingPort: form.loadingPort.trim(),
      commodity: form.commodity,
      term: form.term,
      totalQtyKg,
      surveyor: form.surveyor || null,
      agent: form.agent || null,
      jetty: form.jetty || null,
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
      purpose: 'Unloading',
      etaFrom: '',
      etaTo: '',
      shipper: '',
      loadingPort: '',
      commodity: 'CPO',
      term: 'FOB',
      totalQtyKg: '',
      surveyor: '',
      agent: '',
      jetty: '',
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
    const q = searchQuery.trim().toLowerCase()
    const matchSearch = !q ||
      (n.siId || '').toLowerCase().includes(q) ||
      (n.vesselName || n.vesselId || '').toLowerCase().includes(q) ||
      (n.agent || '').toLowerCase().includes(q)
    const purposeMatch = !filters.purpose || (n.purpose || '') === filters.purpose.trim()
    const statusMatch = !filters.status || (n.status || '') === filters.status.trim()
    return matchSearch && purposeMatch && statusMatch
  })

  const sortedList = [...filteredList].sort((a, b) => {
    const col = SI_TABLE_COLUMNS.find((c) => c.key === sortState.key)
    if (!col) return 0
    const va = col.getSortValue(a)
    const vb = col.getSortValue(b)
    const cmp = String(va).localeCompare(String(vb), undefined, { numeric: true })
    return sortState.dir === 'asc' ? cmp : -cmp
  })

  const totalSI = list.length
  const pendingApproval = list.filter((n) => isInternalApprovalFlow(n) && n.status === 'Submitted').length
  const now = Date.now()
  const oneWeek = 7 * 24 * 60 * 60 * 1000
  const upcomingArrivals = list.filter((n) => {
    const eta = n.etaDateTime || n.etaFrom
    if (!eta) return false
    const t = new Date(eta).getTime()
    return t >= now && t <= now + oneWeek
  }).length
  const approvedThisWeek = list.filter((n) => {
    if (n.status !== 'Approved' || !n.receivedAt) return false
    const t = new Date(n.receivedAt).getTime()
    return t >= now - oneWeek
  }).length

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === sortedList.length) setSelectedIds(new Set())
    else setSelectedIds(new Set(sortedList.map((n) => n.id)))
  }

  const handleRequestApproval = (n, e) => {
    e.stopPropagation()
    setList((prev) => prev.map((r) => (r.id === n.id ? { ...r, status: 'Submitted' } : r)))
  }

  const handleExport = () => {
    const headers = ['SI ID', 'Vessel', 'Agent', 'Material', 'Purpose', 'ETA', 'Status']
    const rows = sortedList.map((n) => [
      n.siId || '',
      n.vesselName || n.vesselId || '',
      n.agent || '',
      n.commodity || n.product || '',
      n.purpose || '',
      formatEta(n),
      n.status || '',
    ])
    const csv = [headers.join(','), ...rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `shipping-instructions-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="shipping-instruction-page">
      <header className="si-page-header">
        <div className="si-page-header__text">
          <h1 className="page-title">Shipping Instructions</h1>
          <p className="si-page-header__subtitle">
            Manage and monitor all submitted vessel shipping instructions for jetty operations.
          </p>
        </div>
        {SHOW_CREATE_NEW && (
          <button
            type="button"
            className="btn btn--primary si-page-header__cta"
            onClick={() => setIsFormOpen(true)}
            aria-expanded={isFormOpen}
          >
            + Create New SI
          </button>
        )}
      </header>

      <div className="si-summary-cards">
        <div className="si-summary-card">
          <span className="si-summary-card__icon" aria-hidden>🚢</span>
          <span className="si-summary-card__value">{totalSI.toLocaleString()}</span>
          <span className="si-summary-card__label">TOTAL SI</span>
        </div>
        <div className="si-summary-card">
          <span className="si-summary-card__icon" aria-hidden>🕐</span>
          <span className="si-summary-card__value">{pendingApproval}</span>
          <span className="si-summary-card__label">PENDING APPROVAL</span>
        </div>
        <div className="si-summary-card">
          <span className="si-summary-card__icon" aria-hidden>🕐</span>
          <span className="si-summary-card__value">{upcomingArrivals}</span>
          <span className="si-summary-card__label">UPCOMING ARRIVALS</span>
        </div>
        <div className="si-summary-card">
          <span className="si-summary-card__icon si-summary-card__icon--check" aria-hidden>✓</span>
          <span className="si-summary-card__value">{approvedThisWeek}</span>
          <span className="si-summary-card__label">APPROVED THIS WEEK</span>
        </div>
      </div>

      <div className="si-toolbar">
        <input
          type="search"
          className="si-toolbar__search"
          placeholder="Search by SI ID, Vessel, or Agent..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label="Search shipping instructions"
        />
        <div className="si-toolbar__actions">
          <button
            type="button"
            className={`btn btn--secondary si-toolbar__btn ${filtersPanelOpen ? 'si-toolbar__btn--active' : ''}`}
            onClick={() => setFiltersPanelOpen((o) => !o)}
            aria-expanded={filtersPanelOpen}
          >
            🔽 Filters
          </button>
          <button type="button" className="btn btn--secondary si-toolbar__btn" onClick={handleExport}>
            ⬇ Export
          </button>
        </div>
      </div>

      {filtersPanelOpen && (
        <div className="si-filters-panel">
          <div className="si-filters-panel__row">
            <label className="si-filters-panel__label">Purpose</label>
            <select
              className="si-filters-panel__select"
              value={filters.purpose}
              onChange={(e) => updateFilter('purpose', e.target.value)}
            >
              {PURPOSE_OPTIONS.map((opt) => (
                <option key={opt.value || 'all'} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div className="si-filters-panel__row">
            <label className="si-filters-panel__label">Status</label>
            <select
              className="si-filters-panel__select"
              value={filters.status}
              onChange={(e) => updateFilter('status', e.target.value)}
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value || 'all'} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
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
                    <label htmlFor="purpose">Purpose</label>
                    <select id="purpose" value={form.purpose} onChange={(e) => updateForm({ purpose: e.target.value })}>
                      <option value="Unloading">Unloading</option>
                      <option value="Loading">Loading</option>
                    </select>
                  </div>
                  <div className="input-group">
                    <label htmlFor="jetty">Jetty</label>
                    <select id="jetty" value={form.jetty} onChange={(e) => updateForm({ jetty: e.target.value })}>
                      <option value="">—</option>
                      {BERTH_IDS.map((jid) => (
                        <option key={jid} value={jid}>{jid}</option>
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
                <th className="si-table__col-checkbox">
                  <input
                    type="checkbox"
                    checked={sortedList.length > 0 && selectedIds.size === sortedList.length}
                    onChange={toggleSelectAll}
                    aria-label="Select all"
                  />
                </th>
                {SI_TABLE_COLUMNS.map((col) => (
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
                <th className="si-table__col-actions">ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {sortedList.map((n) => (
                <Fragment key={n.id}>
                  <tr
                    className={`shipping-instruction-table__row ${expandedId === n.id ? 'shipping-instruction-table__row--expanded' : ''}`}
                    onClick={() => setExpandedId((id) => (id === n.id ? null : n.id))}
                  >
                    <td className="si-table__col-checkbox" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(n.id)}
                        onChange={() => toggleSelect(n.id)}
                        aria-label={`Select ${n.siId || n.id}`}
                      />
                    </td>
                    <td>{n.siId || '—'}</td>
                    <td>
                      <div className="si-table__vessel-agent">
                        <strong>{n.vesselName || n.vesselId || '—'}</strong>
                        <span className="si-table__agent">{n.agent || '—'}</span>
                      </div>
                    </td>
                    <td>{n.commodity || n.product || '—'}</td>
                    <td>{n.purpose || '—'}</td>
                    <td>{formatEta(n)}</td>
                    <td>
                      <span className={`si-status-badge si-status-badge--${(getDisplayStatus(n) || 'draft').toLowerCase().replace(/\s+/g, '-')}`}>
                        {getDisplayStatus(n)}
                      </span>
                      {(n.purpose || '').toLowerCase() === 'unloading' && (
                        <span className="si-status-badge si-status-badge--external" title="Instruction from external">
                          External
                        </span>
                      )}
                    </td>
                    <td className="si-table__col-actions" onClick={(e) => e.stopPropagation()}>
                      {isInternalApprovalFlow(n) && n.status === 'Draft' && (
                        <button
                          type="button"
                          className="btn btn--primary btn--small si-table__action-btn si-table__action-icon"
                          onClick={(e) => handleRequestApproval(n, e)}
                          title="Request Approval"
                          aria-label="Request Approval"
                        >
                          <IconRequestApproval />
                        </button>
                      )}
                      {isInternalApprovalFlow(n) && n.status === 'Submitted' && (n.siId || n.id) && (
                        <button
                          type="button"
                          className="btn btn--primary btn--small si-table__action-btn si-table__action-icon"
                          onClick={(e) => { e.stopPropagation(); navigate(`/shipping-instruction/approval/${n.siId || n.id}`, { state: { si: n } }) }}
                          title="Approve SI"
                          aria-label="Approve SI"
                        >
                          <IconApprove />
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn--secondary btn--small si-table__action-btn si-table__action-icon"
                        onClick={(e) => { e.stopPropagation(); setExpandedId((id) => (id === n.id ? null : n.id)) }}
                        title="View details"
                        aria-label="View details"
                      >
                        <IconView />
                      </button>
                      <button
                        type="button"
                        className="btn btn--secondary btn--small si-table__action-btn si-table__action-icon si-table__action-btn--view-si"
                        disabled={!canViewAsDocument(n)}
                        onClick={(e) => {
                          e.stopPropagation()
                          if (canViewAsDocument(n) && (n.siId || n.id)) {
                            navigate(`/shipping-instruction/view/${n.siId || n.id}`, { state: { si: n } })
                          }
                        }}
                        title={canViewAsDocument(n) ? 'View SI document' : 'View SI available after approval'}
                        aria-label={canViewAsDocument(n) ? 'View SI document' : 'View SI available after approval'}
                      >
                        <IconViewDocument />
                      </button>
                    </td>
                  </tr>
                  {expandedId === n.id && (
                    <tr key={n.id + '-detail'} className="shipping-instruction-table__detail-row">
                      <td colSpan={SI_TABLE_COLUMNS.length + 2} className="shipping-instruction-table__detail-cell">
                        <div className="shipping-instruction-detail">
                          <h4 className="shipping-instruction-detail__title">Full details</h4>
                          <dl className="shipping-instruction-detail__grid">
                            <dt>SI ID</dt><dd>{n.siId || '—'}</dd>
                            <dt>Status</dt><dd>{getDisplayStatus(n)}</dd>
                            {(n.purpose || '').toLowerCase() === 'unloading' && (
                              <><dt>Source</dt><dd>External</dd></>
                            )}
                            <dt>Vessel</dt><dd>{n.vesselName || n.vesselId || '—'}</dd>
                            <dt>Purpose</dt><dd>{n.purpose || '—'}</dd>
                            <dt>Jetty</dt><dd>{n.jetty || '—'}</dd>
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
