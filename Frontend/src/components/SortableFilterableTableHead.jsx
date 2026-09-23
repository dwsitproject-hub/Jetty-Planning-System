/**
 * Sortable column headers + per-column filter row (Allocation table pattern).
 */
import ColumnSelectFilter from './ColumnSelectFilter.jsx'
import ColumnDateRangeFilter from './ColumnDateRangeFilter.jsx'
import { dateRangeFilterParts, mergeDateRangeBound } from '../utils/sortableFilterableTable.js'

export default function SortableFilterableTableHead({
  columns,
  sortState,
  onSort,
  filters,
  onFilterChange,
  leadingBlankCols = 0,
  leadingBlankLabel,
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
        aria-hidden={!label || undefined}
      >
        {count === 1 && label ? label : null}
      </th>
    ))

  return (
    <>
      <tr>
        {blankThs(leadingBlankCols, 'leading', leadingBlankLabel)}
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
            {col.filterType === 'select' ? (
              <ColumnSelectFilter
                value={filters[col.key] ?? ''}
                onChange={(value) => onFilterChange(col.key, value)}
                options={col.selectOptions || []}
                allLabel={col.filterAllLabel || 'All'}
                ariaLabel={col.filterAriaLabel || `Filter by ${col.label}`}
              />
            ) : col.filterType === 'dateRange' ? (
              <ColumnDateRangeFilter
                from={dateRangeFilterParts(filters[col.key]).from}
                to={dateRangeFilterParts(filters[col.key]).to}
                onChange={(bound, value) =>
                  onFilterChange(col.key, mergeDateRangeBound(filters[col.key], bound, value))
                }
                fromAria={col.dateRangeFromAria || `${col.label} from`}
                toAria={col.dateRangeToAria || `${col.label} to`}
              />
            ) : (
              <input
                type="text"
                className="allocation-table__filter"
                placeholder={`Filter ${col.label}`}
                value={filters[col.key] ?? ''}
                onChange={(e) => onFilterChange(col.key, e.target.value)}
                onClick={(e) => e.stopPropagation()}
                aria-label={`Filter by ${col.label}`}
              />
            )}
          </th>
        ))}
        {blankThs(trailingBlankCols, 'trailing')}
      </tr>
    </>
  )
}
