import { formatDateTimeDisplay } from './formatDateTimeDisplay.js'

function displayName(row, created) {
  const raw = created
    ? row?.createdByDisplayName ?? row?.created_by_display_name
    : row?.updatedByDisplayName ?? row?.updated_by_display_name
  return typeof raw === 'string' ? raw.trim() : ''
}

/** "Created on {datetime} by {name}" — omit " by …" when the user is unknown. */
export function formatMasterCreatedLine(row) {
  const iso = row?.createdAt ?? row?.created_at
  if (!iso) return '—'
  const by = displayName(row, true)
  return `Created on ${formatDateTimeDisplay(iso)}${by ? ` by ${by}` : ''}`
}

/** Allocation phrasing: "Last updated on {datetime} by {name}". */
export function formatMasterLastUpdatedLine(row) {
  const iso = row?.updatedAt ?? row?.updated_at
  if (!iso) return '—'
  const by = displayName(row, false)
  return `Last updated on ${formatDateTimeDisplay(iso)}${by ? ` by ${by}` : ''}`
}

export const MASTER_AUDIT_COLUMNS = [
  {
    key: 'createdAt',
    label: 'Created',
    getSortValue: (row) => Date.parse(row?.createdAt || row?.created_at || '') || 0,
    getFilterValue: (row) => formatMasterCreatedLine(row),
  },
  {
    key: 'updatedAt',
    label: 'Last updated',
    getSortValue: (row) => Date.parse(row?.updatedAt || row?.updated_at || '') || 0,
    getFilterValue: (row) => formatMasterLastUpdatedLine(row),
  },
]
