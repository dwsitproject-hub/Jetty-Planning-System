import { useMemo, useState, useCallback } from 'react'
import { emptyFiltersForColumns, filterAndSortRows } from '../utils/sortableFilterableTable'

/**
 * @param {Array} rows
 * @param {Array<{ key: string, label: string, getSortValue: (row: unknown) => unknown, getFilterValue?: (row: unknown) => unknown }>} columns
 * @param {{ key: string, dir: 'asc' | 'desc' }} defaultSort
 * @param {Record<string, unknown>} [initialFilters] merged over the empty column filters on first render
 */
export function useSortableFilterableRows(rows, columns, defaultSort, initialFilters) {
  const [filters, setFilters] = useState(() => ({
    ...emptyFiltersForColumns(columns),
    ...(initialFilters || {}),
  }))
  const [sortState, setSortState] = useState(defaultSort)

  const updateFilter = useCallback((key, value) => {
    setFilters((f) => ({ ...f, [key]: value }))
  }, [])

  const handleSort = useCallback((key) => {
    setSortState((s) => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }))
  }, [])

  const displayRows = useMemo(
    () => filterAndSortRows(rows, columns, filters, sortState),
    [rows, columns, filters, sortState]
  )

  return { displayRows, filters, updateFilter, sortState, handleSort }
}
