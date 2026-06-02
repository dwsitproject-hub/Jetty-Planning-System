/**
 * Sortable column headers + per-column filter row (Allocation table pattern).
 */
export default function SortableFilterableTableHead({
  columns,
  sortState,
  onSort,
  filters,
  onFilterChange,
  leadingBlankCols = 0,
  trailingBlankCols = 0,
  trailingBlankLabel = 'Actions',
}) {
  const blankThs = (count, side, label) =>
    Array.from({ length: count }, (_, i) => (
      <th
        key={`${side}-blank-${i}`}
        className={
          count === 1 && side === 'leading' && leadingBlankCols === 1
            ? 'allocation-table__action-col'
            : count === 1 && side === 'trailing' && trailingBlankCols === 1
              ? 'allocation-table__action-col'
              : undefined
        }
      >
        {side === 'trailing' && count === 1 && label ? label : null}
      </th>
    ))

  return (
    <>
      <tr>
        {blankThs(leadingBlankCols, 'leading')}
        {columns.map((col) => (
          <th key={col.key} className="allocation-table__th">
            <button
              type="button"
              className="allocation-table__sort"
              onClick={() => onSort(col.key)}
              title={`Sort by ${col.label}`}
            >
              {col.label}
              <span className="allocation-table__sort-icon">
                {sortState.key === col.key ? (sortState.dir === 'asc' ? ' ↑' : ' ↓') : ' ⇅'}
              </span>
            </button>
          </th>
        ))}
        {blankThs(trailingBlankCols, 'trailing', trailingBlankLabel)}
      </tr>
      <tr className="allocation-table__filter-row">
        {blankThs(leadingBlankCols, 'leading')}
        {columns.map((col) => (
          <th key={col.key}>
            <input
              type="text"
              className="allocation-table__filter"
              placeholder={`Filter ${col.label}`}
              value={filters[col.key] ?? ''}
              onChange={(e) => onFilterChange(col.key, e.target.value)}
              onClick={(e) => e.stopPropagation()}
              aria-label={`Filter by ${col.label}`}
            />
          </th>
        ))}
        {blankThs(trailingBlankCols, 'trailing')}
      </tr>
    </>
  )
}
