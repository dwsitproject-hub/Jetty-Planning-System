import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import '../styles/allocation.css'
import SortableFilterableTableHead from '../components/SortableFilterableTableHead.jsx'
import { useSortableFilterableRows } from '../hooks/useSortableFilterableRows.js'

const FREIGHT_TERM_OPTIONS = [
  { value: '', label: '—' },
  { value: 'PREPAID', label: 'PREPAID' },
  { value: 'COLLECT', label: 'COLLECT' },
  { value: 'AS_PER_CHARTER_PARTY', label: 'AS PER CHARTER PARTY' },
  { value: 'OTHER', label: 'OTHER' },
]

const FREIGHT_COLUMNS = [
  {
    key: 'code',
    label: 'Code',
    getSortValue: (r) => (r.code || '').toLowerCase(),
  },
  {
    key: 'label',
    label: 'Label',
    getSortValue: (r) => (r.label || '').toLowerCase(),
  },
]

export default function MasterFreightTerms() {
  const freightRows = useMemo(
    () =>
      FREIGHT_TERM_OPTIONS.filter((o) => o.value).map((o) => ({
        id: o.value,
        code: o.value,
        label: o.label,
      })),
    []
  )

  const { displayRows, filters, updateFilter, sortState, handleSort } = useSortableFilterableRows(
    freightRows,
    FREIGHT_COLUMNS,
    { key: 'code', dir: 'asc' }
  )

  return (
    <div className="allocation-page">
      <h1 className="page-title">Master – Freight Terms</h1>
      <p className="allocation-page__intro">
        Freight terms are currently fixed in the backend (validation/check constraint).
      </p>
      <p className="text-steel" style={{ fontSize: 'var(--font-size-small)' }}>
        <Link to="/master" className="link">← Back to Master Menu</Link>
      </p>

      <section className="card at-berth-list-section">
        <div className="card__header-row">
          <h2 className="card__title">Freight Terms</h2>
        </div>

        <div className="table-wrap">
          <table className="data-table allocation-table">
            <thead>
              <SortableFilterableTableHead
                columns={FREIGHT_COLUMNS}
                sortState={sortState}
                onSort={handleSort}
                filters={filters}
                onFilterChange={updateFilter}
              />
            </thead>
            <tbody>
              {displayRows.map((o) => (
                <tr key={o.id} className="allocation-table__row">
                  <td>
                    <strong>{o.code}</strong>
                  </td>
                  <td>{o.label}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {displayRows.length === 0 && (
            <p className="text-steel" style={{ marginTop: 'var(--spacing-3)' }}>
              No entries match the current filters.
            </p>
          )}
        </div>
      </section>
    </div>
  )
}
