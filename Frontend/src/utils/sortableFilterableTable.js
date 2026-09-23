/**
 * Client-side column filter + sort for data tables (Allocation / master pattern).
 */
import { isIsoInLocalDateRange } from './clearanceSailedLookback.js'

function resolveFilterValue(row, col) {
  if (col.getFilterValue) return col.getFilterValue(row)
  const v = col.getSortValue(row)
  return v == null ? '' : String(v)
}

export function emptyFilterValue(col) {
  return col?.filterType === 'dateRange' ? { from: '', to: '' } : ''
}

export function dateRangeFilterParts(value) {
  return value && typeof value === 'object'
    ? { from: value.from || '', to: value.to || '' }
    : { from: '', to: '' }
}

export function mergeDateRangeBound(prev, bound, value) {
  const base = dateRangeFilterParts(prev)
  return { ...base, [bound]: value }
}

/**
 * Distinct trimmed labels, optional preferred order first.
 * @param {unknown[]} values
 * @param {string[]} [preferredOrder]
 * @returns {string[]}
 */
export function uniqueSortedOptions(values, preferredOrder = []) {
  const set = new Set((values || []).map((v) => String(v ?? '').trim()).filter(Boolean))
  const preferred = preferredOrder.filter((v) => set.has(v))
  const rest = [...set]
    .filter((v) => !preferredOrder.includes(v))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
  return [...preferred, ...rest]
}

export function rowMatchesColumnFilter(row, col, filterValue) {
  if (!col || col.filterable === false) return true
  if (col.filterType === 'select') {
    const selected = String(filterValue || '').trim()
    if (!selected) return true
    if (col.matchesFilter) return col.matchesFilter(row, selected)
    return String(resolveFilterValue(row, col) ?? '') === selected
  }
  if (col.filterType === 'dateRange') {
    const range = dateRangeFilterParts(filterValue)
    const iso = col.getDateIso ? col.getDateIso(row) : null
    return isIsoInLocalDateRange(iso, range.from, range.to)
  }
  const f = String(filterValue || '').trim().toLowerCase()
  if (!f) return true
  return String(resolveFilterValue(row, col) ?? '')
    .toLowerCase()
    .includes(f)
}

export function filterRows(rows, columns, filters) {
  return rows.filter((row) =>
    columns.every((col) => rowMatchesColumnFilter(row, col, filters[col.key]))
  )
}

export function sortRows(rows, columns, sortState) {
  const col = columns.find((c) => c.key === sortState.key)
  if (!col) return [...rows]
  const sorted = [...rows]
  sorted.sort((a, b) => {
    const va = col.getSortValue(a)
    const vb = col.getSortValue(b)
    const isNum = typeof va === 'number' && typeof vb === 'number'
    const cmp = isNum ? va - vb : String(va ?? '').localeCompare(String(vb ?? ''), undefined, { numeric: true })
    return sortState.dir === 'asc' ? cmp : -cmp
  })
  return sorted
}

export function filterAndSortRows(rows, columns, filters, sortState) {
  return sortRows(filterRows(rows, columns, filters), columns, sortState)
}

export function emptyFiltersForColumns(columns) {
  return Object.fromEntries((columns || []).map((c) => [c.key, emptyFilterValue(c)]))
}
