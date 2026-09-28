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
  const hub = row?.hubCode ?? row?.hub_code
  const runId = row?.datahubLastApplyRunId ?? row?.datahub_last_apply_run_id
  const source = row?.datahubLastApplySource ?? row?.datahub_last_apply_source

  if (source === 'webhook') {
    const hubPart = hub ? ` · ${hub}` : ''
    const runPart = runId != null ? ` · sync #${runId}` : ''
    const approver = by ? ` · approved by ${by}` : ''
    return `Last updated on ${formatDateTimeDisplay(iso)} via DataHub webhook${hubPart}${runPart}${approver}`
  }
  if (source === 'manual_sync') {
    const hubPart = hub ? ` · ${hub}` : ''
    return `Last updated on ${formatDateTimeDisplay(iso)}${by ? ` by ${by}` : ''} via DataHub sync${hubPart}`
  }

  return `Last updated on ${formatDateTimeDisplay(iso)}${by ? ` by ${by}` : ''}`
}

export const MASTER_AUDIT_COLUMNS = [
  {
    key: 'createdAt',
    label: 'Created',
    filterType: 'dateRange',
    getDateIso: (row) => row?.createdAt ?? row?.created_at ?? null,
    dateRangeFromAria: 'Created from',
    dateRangeToAria: 'Created to',
    getSortValue: (row) => Date.parse(row?.createdAt || row?.created_at || '') || 0,
    getFilterValue: (row) => formatMasterCreatedLine(row),
  },
  {
    key: 'updatedAt',
    label: 'Last updated',
    filterType: 'dateRange',
    getDateIso: (row) => row?.updatedAt ?? row?.updated_at ?? null,
    dateRangeFromAria: 'Last updated from',
    dateRangeToAria: 'Last updated to',
    getSortValue: (row) => Date.parse(row?.updatedAt || row?.updated_at || '') || 0,
    getFilterValue: (row) => formatMasterLastUpdatedLine(row),
  },
]
