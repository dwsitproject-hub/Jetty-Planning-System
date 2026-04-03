import { useState, useEffect, useCallback, useMemo, Fragment } from 'react'
import { Link } from 'react-router-dom'
import { fetchAllocationOverview } from '../api/allocation'
import { setOperationShiftingOut } from '../api/operations'
import { formatDateTimeDisplay } from '../utils/formatDateTimeDisplay'
import { atBerthExecutionOpenPath } from '../utils/atBerthOpenPath'
import '../styles/allocation.css'
import '../styles/modal.css'

const PHASES = ['Pre-Checking', 'Operational', 'Post-Checking']
const PHASE_EMOJI = {
  'Pre-Checking': '📋',
  Operational: '⚙️',
  'Post-Checking': '✅',
}

const PURPOSES = [
  { key: 'Loading', label: 'Loading' },
  { key: 'Unloading', label: 'Unloading' },
]

const FILTER_OPTIONS = [
  { value: 'All', label: 'All' },
  { value: 'Loading', label: 'Loading' },
  { value: 'Unloading', label: 'Unloading' },
]

/** Same rule as Allocation "Incoming vessel & berthing plan" status filter. */
function getBerthingPlanStatus(row) {
  if (row?.shiftingOut) return 'incoming'
  const hasTb = Boolean(row?.tbDateTime)
  const opStatus = String(row?.status || '').toUpperCase()
  if (hasTb || opStatus === 'DOCKED' || opStatus === 'IN_PROGRESS' || opStatus === 'COMPLETED') {
    return 'berthed'
  }
  return 'incoming'
}

function statusToPhase(status) {
  if (status === 'IN_PROGRESS') return 'Operational'
  if (status === 'COMPLETED') return 'Post-Checking'
  return 'Pre-Checking'
}

function parseDateMs(val) {
  if (!val) return null
  const t = new Date(val).getTime()
  return Number.isNaN(t) ? null : t
}

const AT_BERTH_COLUMNS = [
  {
    key: 'vesselName',
    label: 'Vessel',
    getValue: (r) => <strong>{r.vesselName || '—'}</strong>,
    getSortValue: (r) => (r.vesselName || '').toLowerCase(),
    getFilterValue: (r) => r.vesselName,
  },
  {
    key: 'shippingInstruction',
    label: 'SI',
    getValue: (r) => r.shippingInstruction || '—',
    getSortValue: (r) => (r.shippingInstruction || '').toLowerCase(),
    getFilterValue: (r) => r.shippingInstruction,
  },
  {
    key: 'commodity',
    label: 'Commodity',
    getValue: (r) => r.commodity || '—',
    getSortValue: (r) => (r.commodity || '').toLowerCase(),
    getFilterValue: (r) => r.commodity,
  },
  {
    key: 'purpose',
    label: 'Purpose',
    getValue: (r) => (
      <span className="loading-list__badge loading-list__badge--purpose" data-purpose={r.purpose}>
        {r.purpose || '—'}
      </span>
    ),
    getSortValue: (r) => (r.purpose || '').toLowerCase(),
    getFilterValue: (r) => r.purpose,
  },
  {
    key: 'jetty',
    label: 'Jetty',
    getValue: (r) => r.jetty || '—',
    getSortValue: (r) => (r.jetty || '').toLowerCase(),
    getFilterValue: (r) => r.jetty,
  },
  {
    key: 'ta',
    label: 'TA',
    getValue: (r) => formatDateTimeDisplay(r.taDateTime),
    getSortValue: (r) => parseDateMs(r.taDateTime) ?? 0,
    getFilterValue: (r) => `${r.taDateTime || ''} ${formatDateTimeDisplay(r.taDateTime)}`,
  },
  {
    key: 'tb',
    label: 'TB',
    getValue: (r) => formatDateTimeDisplay(r.tbDateTime),
    getSortValue: (r) => parseDateMs(r.tbDateTime) ?? 0,
    getFilterValue: (r) => `${r.tbDateTime || ''} ${formatDateTimeDisplay(r.tbDateTime)}`,
  },
  {
    key: 'phaseLabel',
    label: 'Phase',
    getValue: (r) => statusToPhase(r.status),
    getSortValue: (r) => statusToPhase(r.status).toLowerCase(),
    getFilterValue: (r) => statusToPhase(r.status),
  },
  {
    key: 'status',
    label: 'Status',
    getValue: (r) => r.status || '—',
    getSortValue: (r) => (r.status || '').toLowerCase(),
    getFilterValue: (r) => r.status,
  },
]

function AtBerthDetailPanel({ r }) {
  const purposeDisplay =
    r.purpose ||
    (r.loadDischarge === 'LOAD' ? 'Loading' : r.loadDischarge === 'DISCH' ? 'Unloading' : r.loadDischarge) ||
    '—'

  return (
    <div className="allocation-detail">
      <h4 className="allocation-detail__title">Full details</h4>
      <dl className="allocation-detail__grid">
        <dt>Vessel Name</dt>
        <dd>{r.vesselName || '—'}</dd>
        <dt>Shipping Instruction</dt>
        <dd>{r.shippingInstruction || '—'}</dd>
        <dt>No PKK</dt>
        <dd>{r.noPkk ?? '—'}</dd>
        <dt>Priority</dt>
        <dd>{r.priority || '—'}</dd>
        <dt>Number of Palka</dt>
        <dd>{r.numberOfPalka ?? '—'}</dd>
        <dt>Purpose</dt>
        <dd>{purposeDisplay}</dd>
        <dt>Shipper</dt>
        <dd>{r.shipper || '—'}</dd>
        <dt>Agent</dt>
        <dd>{r.agent || '—'}</dd>
        <dt>Surveyor</dt>
        <dd>{r.surveyor || '—'}</dd>
        <dt>Jetty</dt>
        <dd>{r.jetty || '—'}</dd>
        <dt>ETA</dt>
        <dd>{formatDateTimeDisplay(r.etaDateTime || r.eta)}</dd>
        <dt>TA</dt>
        <dd>{formatDateTimeDisplay(r.taDateTime)}</dd>
        <dt>ETB</dt>
        <dd>{formatDateTimeDisplay(r.etbDateTime || r.etb)}</dd>
        <dt>TB</dt>
        <dd>{formatDateTimeDisplay(r.tbDateTime)}</dd>
        <dt>Remark</dt>
        <dd>{r.remark || r.remarks || '—'}</dd>
      </dl>
    </div>
  )
}

export default function AtBerthExecutions() {
  const [queue, setQueue] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [purposeFilter, setPurposeFilter] = useState('All')
  const filterKeys = AT_BERTH_COLUMNS.map((c) => c.key)
  const [filters, setFilters] = useState(() => Object.fromEntries(filterKeys.map((k) => [k, ''])))
  const [sortState, setSortState] = useState({ key: 'vesselName', dir: 'asc' })
  const [expandedId, setExpandedId] = useState(null)
  const [shiftSavingByOpId, setShiftSavingByOpId] = useState({})
  const [shiftModal, setShiftModal] = useState(null)
  const [shiftRemarkDraft, setShiftRemarkDraft] = useState('')
  const [shiftOutToastMessage, setShiftOutToastMessage] = useState(null)

  useEffect(() => {
    if (!shiftOutToastMessage) return undefined
    const t = window.setTimeout(() => setShiftOutToastMessage(null), 7500)
    return () => clearTimeout(t)
  }, [shiftOutToastMessage])

  const load = useCallback(async () => {
    setErr(null)
    setLoading(true)
    try {
      const data = await fetchAllocationOverview()
      setQueue(Array.isArray(data?.queue) ? data.queue : [])
    } catch (e) {
      setErr(e?.message || 'Failed to load')
      setQueue([])
    } finally {
      setLoading(false)
    }
  }, [])

  const closeShiftModal = useCallback(() => {
    setShiftModal(null)
    setShiftRemarkDraft('')
  }, [])

  const confirmShiftOut = useCallback(async () => {
    const row = shiftModal?.row
    const opId = row?.operationId
    if (!opId) return
    const trimmed = shiftRemarkDraft.trim()
    if (!trimmed) {
      setErr('Enter a remark before confirming shift-out.')
      return
    }
    setErr(null)
    setShiftSavingByOpId((m) => ({ ...m, [opId]: true }))
    try {
      await setOperationShiftingOut(opId, true, trimmed, { activityLogPage: 'at-berth' })
      const vesselLabel = row.vesselName || row.shippingInstruction || 'Vessel'
      setShiftOutToastMessage(
        `Shift out complete for ${vesselLabel}. Please visit 'Allocation & Berthing' to re-dock.`
      )
      closeShiftModal()
      await load()
    } catch (err) {
      setErr(err?.message || 'Shift-out failed')
    } finally {
      setShiftSavingByOpId((m) => ({ ...m, [opId]: false }))
    }
  }, [shiftModal, shiftRemarkDraft, load, closeShiftModal])

  const handleShiftOutToggle = useCallback(
    async (row, e) => {
      e?.stopPropagation?.()
      const opId = row?.operationId
      if (!opId) return
      if (!row.shiftingOut) {
        setErr(null)
        setShiftModal({ row })
        setShiftRemarkDraft(String(row.remark ?? row.remarks ?? ''))
        return
      }
      setShiftSavingByOpId((m) => ({ ...m, [opId]: true }))
      try {
        await setOperationShiftingOut(opId, false)
        await load()
      } catch (err) {
        setErr(err?.message || 'Shift-out failed')
      } finally {
        setShiftSavingByOpId((m) => ({ ...m, [opId]: false }))
      }
    },
    [load]
  )

  useEffect(() => {
    load()
  }, [load])

  /** Same queue rows as Allocation; only berthed vessels with an operation. */
  const rows = useMemo(() => {
    return queue.filter((r) => r.operationId != null && getBerthingPlanStatus(r) === 'berthed')
  }, [queue])

  const counts = {
    Loading: { 'Pre-Checking': 0, Operational: 0, 'Post-Checking': 0 },
    Unloading: { 'Pre-Checking': 0, Operational: 0, 'Post-Checking': 0 },
  }
  rows.forEach((v) => {
    const phase = statusToPhase(v.status)
    if (counts[v.purpose]) counts[v.purpose][phase] += 1
  })

  const byPurpose = purposeFilter === 'All' ? rows : rows.filter((v) => v.purpose === purposeFilter)
  const updateFilter = (key, value) => setFilters((f) => ({ ...f, [key]: value }))
  const handleSort = (key) => setSortState((s) => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }))

  const filteredVessels = byPurpose.filter((r) => {
    return filterKeys.every((key) => {
      const f = (filters[key] || '').trim().toLowerCase()
      if (!f) return true
      const col = AT_BERTH_COLUMNS.find((c) => c.key === key)
      const raw = col?.getFilterValue ? col.getFilterValue(r) : r[key]
      return String(raw ?? '').toLowerCase().includes(f)
    })
  })

  const sortedVessels = [...filteredVessels].sort((a, b) => {
    const col = AT_BERTH_COLUMNS.find((c) => c.key === sortState.key)
    if (!col) return 0
    const va = col.getSortValue(a)
    const vb = col.getSortValue(b)
    let cmp
    if (typeof va === 'number' && typeof vb === 'number') {
      cmp = va - vb
    } else {
      cmp = String(va).localeCompare(String(vb), undefined, { numeric: true })
    }
    return sortState.dir === 'asc' ? cmp : -cmp
  })

  const tableColSpan = AT_BERTH_COLUMNS.length + 2

  return (
    <div className="allocation-page at-berth-page">
      {shiftOutToastMessage ? (
        <div
          className="toast toast--success"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <span className="toast__icon" aria-hidden>
            ✓
          </span>
          <p className="toast__message">{shiftOutToastMessage}</p>
          <button
            type="button"
            className="toast__close"
            onClick={() => setShiftOutToastMessage(null)}
            aria-label="Dismiss notification"
          >
            ×
          </button>
        </div>
      ) : null}
      <h1 className="page-title">At-Berth Executions</h1>
      {err && <p style={{ color: '#c00' }}>{err}</p>}

      <section className="at-berth-summary" aria-label="Summary by purpose and phase">
        <div className="at-berth-summary__groups">
          {PURPOSES.map(({ key: purpose, label }) => (
            <div key={purpose} className="at-berth-summary__group">
              <h3 className="at-berth-summary__group-title">{label}</h3>
              <div className="at-berth-summary__grid">
                {PHASES.map((phase) => (
                  <div
                    key={phase}
                    className={`at-berth-card at-berth-card--${purpose.toLowerCase()}`}
                  >
                    <h4 className="at-berth-card__title">
                      {PHASE_EMOJI[phase]} {phase}
                    </h4>
                    <p className="at-berth-card__count" aria-label={`${purpose} ${phase} count`}>
                      {counts[purpose][phase]}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="card at-berth-list-section">
        <div className="at-berth-list-section__header">
          <h2 className="card__title">Vessels</h2>
          <div className="allocation-tabs at-berth-filter" role="tablist">
            {FILTER_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={purposeFilter === value}
                className={`allocation-tabs__tab ${purposeFilter === value ? 'allocation-tabs__tab--active' : ''}`}
                onClick={() => setPurposeFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {loading ? (
          <p className="text-steel">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-steel">No at-berth operations. Use Allocation to log arrival and confirm berthing.</p>
        ) : sortedVessels.length === 0 ? (
          <p className="text-steel">No vessels match filters.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table allocation-table">
              <thead>
                <tr>
                  <th className="allocation-table__expand-col" aria-label="Expand row" />
                  <th className="allocation-table__action-col">Action</th>
                  {AT_BERTH_COLUMNS.map((col) => (
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
                  <th className="allocation-table__expand-col" />
                  <th className="allocation-table__action-col" />
                  {AT_BERTH_COLUMNS.map((col) => (
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
                {sortedVessels.map((r) => (
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
                        <Link to={atBerthExecutionOpenPath(r)} className="btn btn--small btn--primary">
                          Open
                        </Link>
                      {r.operationId != null && (
                        <button
                          type="button"
                          className="btn btn--small btn--secondary"
                          style={{ marginLeft: '0.5rem' }}
                          onClick={(e) => handleShiftOutToggle(r, e)}
                          disabled={Boolean(shiftSavingByOpId[r.operationId])}
                          title={r.shiftingOut ? 'Clear shift-out (return to berth state)' : 'Shift out: move back to incoming queue and free berth capacity'}
                        >
                          {shiftSavingByOpId[r.operationId]
                            ? 'Saving…'
                            : r.shiftingOut
                              ? 'Undo Shift Out'
                              : 'Shifting Out'}
                        </button>
                      )}
                      </td>
                      {AT_BERTH_COLUMNS.map((col) => (
                        <td key={col.key}>{col.getValue(r)}</td>
                      ))}
                    </tr>
                    {expandedId === r.id && (
                      <tr className="allocation-table__detail-row">
                        <td colSpan={tableColSpan} className="allocation-table__detail-cell">
                          <AtBerthDetailPanel r={r} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {shiftModal?.row ? (
        <div className="modal-overlay" onClick={closeShiftModal} aria-hidden="true">
          <div
            className="modal"
            onClick={(ev) => ev.stopPropagation()}
            role="dialog"
            aria-labelledby="shift-out-modal-title"
            aria-modal="true"
          >
            <h2 id="shift-out-modal-title" className="modal__title">
              Shift out — {shiftModal.row.vesselName || shiftModal.row.shippingInstruction || 'Vessel'}
            </h2>
            <p className="text-steel" style={{ marginBottom: '0.75rem', fontSize: '0.9rem' }}>
              The vessel returns to the incoming queue and berth capacity is freed. Set the operation remark (required).
            </p>
            <div className="modal__section">
              <label htmlFor="shift-out-remark" className="modal__label">
                Remark
              </label>
              <textarea
                id="shift-out-remark"
                className="modal__textarea"
                rows={4}
                value={shiftRemarkDraft}
                onChange={(ev) => setShiftRemarkDraft(ev.target.value)}
                disabled={Boolean(shiftSavingByOpId[shiftModal.row.operationId])}
              />
            </div>
            <div className="modal__actions" style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn--secondary" onClick={closeShiftModal}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => confirmShiftOut()}
                disabled={Boolean(shiftSavingByOpId[shiftModal.row.operationId])}
              >
                {shiftSavingByOpId[shiftModal.row.operationId] ? 'Saving…' : 'Confirm shift-out'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
