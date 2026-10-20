/**
 * Sortable column headers + per-column filter row (Allocation table pattern).
 */
import ColumnSelectFilter from './ColumnSelectFilter.jsx'
import ColumnDateRangeFilter from './ColumnDateRangeFilter.jsx'
import DropdownMultiSelect from './DropdownMultiSelect.jsx'
import { dateRangeFilterParts, mergeDateRangeBound } from '../utils/sortableFilterableTable.js'

export default function SortableFilterableTableHead({
  columns,
  sortState,
  onSort,
  filters,
  onFilterChange,
  leadingBlankCols = 0,
  leadingBlankLabel,
  leadingBlankAriaLabel,
  leadingBlankClassName = 'allocation-table__action-col',
  trailingBlankCols = 0,
  trailingBlankLabel = 'Actions',
}) {
  const blankThs = (count, side, label, ariaLabel) =>
    Array.from({ length: count }, (_, i) => (
      <th
        key={`${side}-blank-${i}`}
        className={
          count === 1 && side === 'leading' && leadingBlankCols === 1
            ? leadingBlankClassName
            : count === 1 && side === 'trailing' && trailingBlankCols === 1
              ? 'allocation-table__action-col'
              : undefined
        }
        aria-label={count === 1 ? ariaLabel : undefined}
        aria-hidden={!label && !ariaLabel ? true : undefined}
      >
        {count === 1 && label ? label : null}
      </th>
    ))

  return (
    <>
      <tr>
        {blankThs(leadingBlankCols, 'leading', leadingBlankLabel, leadingBlankAriaLabel)}
        {columns.map((col) => {
          const columnLabel = col.labelText || (typeof col.label === 'string' ? col.label : col.key)
          return (
          <th key={col.key} className={['allocation-table__th', col.headerClassName].filter(Boolean).join(' ')}>
            <button
              type="button"
              className="allocation-table__sort"
              onClick={() => onSort(col.key)}
              title={`Sort by ${columnLabel}`}
            >
              {col.label}
              <span className="allocation-table__sort-icon">
                {sortState.key === col.key ? (sortState.dir === 'asc' ? ' ↑' : ' ↓') : ' ⇅'}
              </span>
            </button>
          </th>
          )
        })}
        {blankThs(trailingBlankCols, 'trailing', trailingBlankLabel)}
      </tr>
      <tr className="allocation-table__filter-row">
        {blankThs(leadingBlankCols, 'leading')}
        {columns.map((col) => {
          const columnLabel = col.labelText || (typeof col.label === 'string' ? col.label : col.key)
          return (
          <th key={col.key} className={col.headerClassName || undefined}>
            {col.filterType === 'select' ? (
              <ColumnSelectFilter
                value={filters[col.key] ?? ''}
                onChange={(value) => onFilterChange(col.key, value)}
                options={col.selectOptions || []}
                allLabel={col.filterAllLabel || 'All'}
                ariaLabel={
                  col.filterAriaLabel ||
                  `Filter by ${columnLabel}`
                }
              />
            ) : col.filterType === 'multiSelect' ? (
              <DropdownMultiSelect
                className="allocation-table__multi-filter"
                options={(col.selectOptions || []).map((opt) =>
                  typeof opt === 'string' ? { value: opt, label: opt } : opt
                )}
                selectedValues={Array.isArray(filters[col.key]) ? filters[col.key] : []}
                onChange={(value) => onFilterChange(col.key, value)}
                placeholder={col.filterAllLabel || 'All'}
                ariaLabel={col.filterAriaLabel || `Filter by ${columnLabel}`}
                emptyText={col.emptyFilterText || 'No options'}
                portal
                searchable={(col.selectOptions || []).length > 8}
              />
            ) : col.filterType === 'dateRange' ? (
              <ColumnDateRangeFilter
                from={dateRangeFilterParts(filters[col.key]).from}
                to={dateRangeFilterParts(filters[col.key]).to}
                onChange={(bound, value) =>
                  onFilterChange(col.key, mergeDateRangeBound(filters[col.key], bound, value))
                }
                fromAria={col.dateRangeFromAria || `${columnLabel} from`}
                toAria={col.dateRangeToAria || `${columnLabel} to`}
              />
            ) : (
              <input
                type="text"
                className="allocation-table__filter"
                placeholder={`Filter ${columnLabel}`}
                value={filters[col.key] ?? ''}
                onChange={(e) => onFilterChange(col.key, e.target.value)}
                onClick={(e) => e.stopPropagation()}
                aria-label={`Filter by ${columnLabel}`}
              />
            )}
          </th>
          )
        })}
        {blankThs(trailingBlankCols, 'trailing')}
      </tr>
    </>
  )
}
