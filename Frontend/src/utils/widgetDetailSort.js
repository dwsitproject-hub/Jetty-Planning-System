/**
 * Sort widget-detail modal rows. Missing values stay last in either direction.
 */

function isMissing(value) {
  return value == null || value === ''
}

/**
 * @param {unknown} a
 * @param {unknown} b
 * @param {'asc' | 'desc'} dir
 */
export function compareSortValues(a, b, dir) {
  if (isMissing(a) || isMissing(b)) {
    if (isMissing(a) && isMissing(b)) return 0
    return isMissing(a) ? 1 : -1
  }
  const cmp = typeof a === 'number' && typeof b === 'number'
    ? a - b
    : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
  return dir === 'desc' ? -cmp : cmp
}

/**
 * @param {Array<object>} rows
 * @param {Array<{ key?: string, sortValue?: (row: object) => unknown }>} columns
 * @param {{ key: string, dir: 'asc' | 'desc' } | null | undefined} sort
 */
export function sortModalRows(rows, columns, sort) {
  const list = Array.isArray(rows) ? rows : []
  if (!sort?.key) return list
  const col = (columns || []).find((c) => c.key === sort.key)
  if (!col?.sortValue) return list
  const dir = sort.dir === 'desc' ? 'desc' : 'asc'
  return [...list].sort((a, b) => compareSortValues(col.sortValue(a), col.sortValue(b), dir))
}
