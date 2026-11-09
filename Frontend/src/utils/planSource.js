export const SOURCE_ALL = 'all'
export const SOURCE_INTERNAL = 'internal'
const PARTNER_PREFIX = 'partner:'

function partnerNameOf(row) {
  const name = typeof row?.partnerName === 'string' ? row.partnerName.trim() : ''
  return name || null
}

/** Selection key for a partner name. Prefixed so a partner can never collide with All or Internal. */
export function partnerSourceKey(name) {
  return `${PARTNER_PREFIX}${name}`
}

/** @returns {{ kind: 'internal' } | { kind: 'partner', name: string }} */
export function planSourceOf(row) {
  const name = partnerNameOf(row)
  return name ? { kind: 'partner', name } : { kind: 'internal' }
}

/** Sort value: Internal first, then partners alphabetically. */
export function planSourceSortValue(row) {
  const name = partnerNameOf(row)
  return name ? name.toLowerCase() : ''
}

function rowSourceKey(row) {
  const name = partnerNameOf(row)
  return name ? partnerSourceKey(name) : SOURCE_INTERNAL
}

/** @param {unknown[]} rows @param {string} selected */
export function filterRowsBySource(rows, selected) {
  if (!selected || selected === SOURCE_ALL) return rows
  return rows.filter((row) => rowSourceKey(row) === selected)
}

/**
 * Chips for the source filter: All, Internal, then one per partner (alphabetical), each with a count.
 * Empty when no partner plan exists and no partner is selected, so internal-only lists show no chips.
 * A selected partner with no rows stays as a chip at 0 so an empty table is explained.
 * @param {unknown[]} rows
 * @param {string} selected
 * @returns {{ key: string, kind: 'all' | 'internal' | 'partner', name?: string, count: number }[]}
 */
export function buildSourceChips(rows, selected) {
  const partnerCounts = new Map()
  let internal = 0
  for (const row of rows) {
    const name = partnerNameOf(row)
    if (name) partnerCounts.set(name, (partnerCounts.get(name) ?? 0) + 1)
    else internal += 1
  }
  if (selected?.startsWith(PARTNER_PREFIX)) {
    const name = selected.slice(PARTNER_PREFIX.length)
    if (!partnerCounts.has(name)) partnerCounts.set(name, 0)
  }
  if (partnerCounts.size === 0) return []

  const partners = [...partnerCounts.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    .map(([name, count]) => ({ key: partnerSourceKey(name), kind: 'partner', name, count }))

  return [
    { key: SOURCE_ALL, kind: 'all', count: rows.length },
    { key: SOURCE_INTERNAL, kind: 'internal', count: internal },
    ...partners,
  ]
}
