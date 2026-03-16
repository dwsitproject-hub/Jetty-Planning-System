import { useState } from 'react'
import { Link } from 'react-router-dom'
import { getAtBerthOperations } from '../data/mockData'
import { useLoading, getLoadingPhaseIndex } from '../context/LoadingContext'
import '../styles/allocation.css'

const PHASE_LABELS = {
  3: 'Pre-Checking',
  4: 'Operational',
  5: 'Post-Checking',
  6: 'Post-Checking',
}

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

const AT_BERTH_COLUMNS = [
  { key: 'vesselName', label: 'Vessel', getValue: (r) => <strong>{r.vesselName || '—'}</strong>, getSortValue: (r) => (r.vesselName || '').toLowerCase() },
  { key: 'si', label: 'SI', getValue: (r) => `${r.siId ?? ''} · ${r.product ?? ''}`.trim() || '—', getSortValue: (r) => `${r.siId ?? ''} ${r.product ?? ''}`.toLowerCase() },
  { key: 'purpose', label: 'Purpose', getValue: (r) => (
    <span className="loading-list__badge loading-list__badge--purpose" data-purpose={r.purpose}>{r.purpose}</span>
  ), getSortValue: (r) => (r.purpose || '').toLowerCase() },
  { key: 'phaseLabel', label: 'Current phase', getValue: (r) => r.phaseLabel || '—', getSortValue: (r) => (r.phaseLabel || '').toLowerCase() },
]

export default function AtBerthExecutions() {
  const { getSteps } = useLoading()
  const [purposeFilter, setPurposeFilter] = useState('All')
  const filterKeys = AT_BERTH_COLUMNS.map((c) => c.key)
  const [filters, setFilters] = useState(() => Object.fromEntries(filterKeys.map((k) => [k, ''])))
  const [sortState, setSortState] = useState({ key: 'vesselName', dir: 'asc' })

  const loadingOps = getAtBerthOperations('Loading').map((o) => ({ ...o, purpose: 'Loading' }))
  const unloadingOps = getAtBerthOperations('Unloading').map((o) => ({ ...o, purpose: 'Unloading' }))
  const atBerthVessels = [...loadingOps, ...unloadingOps]

  const vesselsWithPhase = atBerthVessels.map((v) => {
    const steps = getSteps(v.vesselId)
    const phaseIndex = getLoadingPhaseIndex(steps ?? null)
    const phaseLabel = PHASE_LABELS[phaseIndex] ?? 'Pre-Checking'
    const si = `${v.siId ?? ''} · ${v.product ?? ''}`.trim()
    return { ...v, phaseIndex, phaseLabel, si }
  })

  const counts = {
    Loading: { 'Pre-Checking': 0, Operational: 0, 'Post-Checking': 0 },
    Unloading: { 'Pre-Checking': 0, Operational: 0, 'Post-Checking': 0 },
  }
  vesselsWithPhase.forEach((v) => {
    counts[v.purpose][v.phaseLabel] += 1
  })

  const byPurpose = purposeFilter === 'All' ? vesselsWithPhase : vesselsWithPhase.filter((v) => v.purpose === purposeFilter)
  const updateFilter = (key, value) => setFilters((f) => ({ ...f, [key]: value }))
  const handleSort = (key) => setSortState((s) => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }))

  const filteredVessels = byPurpose.filter((r) => {
    return filterKeys.every((key) => {
      const f = (filters[key] || '').trim().toLowerCase()
      if (!f) return true
      const val = key === 'si' ? r.si : r[key]
      return String(val ?? '').toLowerCase().includes(f)
    })
  })

  const sortedVessels = [...filteredVessels].sort((a, b) => {
    const col = AT_BERTH_COLUMNS.find((c) => c.key === sortState.key)
    if (!col) return 0
    const va = col.getSortValue(a)
    const vb = col.getSortValue(b)
    const isNum = typeof va === 'number' && typeof vb === 'number'
    const cmp = isNum ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true })
    return sortState.dir === 'asc' ? cmp : -cmp
  })

  return (
    <div className="allocation-page at-berth-page">
      <h1 className="page-title">At-Berth Executions</h1>
      <p className="allocation-page__intro">
        Summary of vessels in pre-checking, operational, and post-checking. Click a vessel to open Loading or Unloading.
      </p>

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
                    <h4 className="at-berth-card__title">{PHASE_EMOJI[phase]} {phase}</h4>
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
          <div className="allocation-tabs at-berth-filter" role="tablist" aria-label="Filter by purpose">
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
        {atBerthVessels.length === 0 ? (
          <p className="text-steel">No at-berth vessels.</p>
        ) : sortedVessels.length === 0 ? (
          <p className="text-steel">No vessels match the filters.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table allocation-table">
              <thead>
                <tr>
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
                  <th className="allocation-table__action-col">Action</th>
                </tr>
                <tr className="allocation-table__filter-row">
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
                  <th className="allocation-table__action-col" />
                </tr>
              </thead>
              <tbody>
                {sortedVessels.map((v) => (
                  <tr key={v.vesselId} className="allocation-table__row">
                    {AT_BERTH_COLUMNS.map((col) => (
                      <td key={col.key}>{col.getValue(v)}</td>
                    ))}
                    <td className="allocation-table__action-col">
                      <Link
                        to={v.purpose === 'Unloading' ? `/unloading/${v.vesselId}` : `/loading/${v.vesselId}`}
                        className="btn btn--small btn--primary"
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
