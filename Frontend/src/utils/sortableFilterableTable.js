/**
 * Client-side column filter + sort for data tables (Allocation / master pattern).
 */

function resolveFilterValue(row, col) {
  if (col.getFilterValue) return col.getFilterValue(row)
  const v = col.getSortValue(row)
  return v == null ? '' : String(v)
}

export function filterRows(rows, columns, filters) {
  return rows.filter((row) =>
    columns.every((col) => {
      const f = (filters[col.key] || '').trim().toLowerCase()
      if (!f) return true
      return String(resolveFilterValue(row, col) ?? '')
        .toLowerCase()
        .includes(f)
    })
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
  return Object.fromEntries(columns.map((c) => [c.key, '']))
}
