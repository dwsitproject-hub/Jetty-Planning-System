import { useMemo, useState } from 'react'
import SortableFilterableTableHead from '../SortableFilterableTableHead.jsx'
import { useSortableFilterableRows } from '../../hooks/useSortableFilterableRows.js'
import { formatCount, formatRelativeTime, formatWhen, shortBatchId } from '../../utils/adminOpsDisplay'

function isoSortValue(iso) {
  const n = iso ? new Date(iso).getTime() : 0
  return Number.isNaN(n) ? 0 : n
}

function DetailTable({ columns, rows, emptyMessage, noMatchLabel }) {
  const tableColumns = useMemo(
    () =>
      (columns || []).map((col) => ({
        key: col.key,
        label: col.label,
        headerClassName: col.className,
        filterType: col.filterType,
        selectOptions: col.selectOptions,
        getDateIso: col.getDateIso,
        getSortValue: col.getSortValue || ((row) => String(row[col.key] ?? '').toLowerCase()),
        getFilterValue: col.getFilterValue || ((row) => String(row[col.key] ?? '')),
      })),
    [columns]
  )
  const { displayRows, filters, updateFilter, sortState, handleSort } = useSortableFilterableRows(
    rows || [],
    tableColumns,
    { key: tableColumns[0]?.key || '', dir: 'asc' }
  )
  if (!rows?.length) {
    return emptyMessage ? <p className="text-steel admin-ops-detail__empty">{emptyMessage}</p> : null
  }
  return (
    <div className="admin-ops-detail-table-wrap">
      <table className="admin-ops-detail-table data-table allocation-table">
        <thead>
          <SortableFilterableTableHead
            columns={tableColumns}
            sortState={sortState}
            onSort={handleSort}
            filters={filters}
            onFilterChange={updateFilter}
          />
        </thead>
        <tbody>
          {displayRows.map((row) => (
            <tr key={row.key}>
              {columns.map((col) => (
                <td key={col.key} className={col.className}>
                  {row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {displayRows.length === 0 && noMatchLabel ? (
        <p className="text-steel admin-ops-detail__empty">{noMatchLabel}</p>
      ) : null}
    </div>
  )
}

function BatchIdCell({ batchId, t }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    if (!batchId || !navigator.clipboard?.writeText) return
    try {
      await navigator.clipboard.writeText(batchId)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* ignore */
    }
  }

  return (
    <span className="admin-ops-purge-table__batch-cell">
      <code title={batchId}>{shortBatchId(batchId)}</code>
      <button type="button" className="btn btn--ghost admin-ops-copy-btn" onClick={copy}>
        {copied ? t('adminOpsCopied') : t('adminOpsCopy')}
      </button>
    </span>
  )
}

export function PurgeBatchTable({ batches, expectedCadence, t }) {
  const columns = useMemo(
    () => [
      {
        key: 'batchId',
        label: t('adminOpsPurgeBatchId'),
        getSortValue: (b) => b.batchId || '',
        getFilterValue: (b) => b.batchId || '',
      },
      {
        key: 'archived',
        label: t('adminOpsPurgeArchive'),
        headerClassName: 'admin-ops-purge-table__num',
        getSortValue: (b) => Number(b.archived) || 0,
        getFilterValue: (b) => String(b.archived ?? ''),
      },
      {
        key: 'deleted',
        label: t('adminOpsPurgeDelete'),
        headerClassName: 'admin-ops-purge-table__num',
        getSortValue: (b) => Number(b.deleted) || 0,
        getFilterValue: (b) => String(b.deleted ?? ''),
      },
      {
        key: 'completed',
        label: t('adminOpsPurgeCompleted'),
        filterType: 'dateRange',
        getDateIso: (b) => b.lastActedAt,
        getSortValue: (b) => isoSortValue(b.lastActedAt),
      },
    ],
    [t]
  )
  const { displayRows, filters, updateFilter, sortState, handleSort } = useSortableFilterableRows(
    batches || [],
    columns,
    { key: 'completed', dir: 'desc' }
  )

  if (!batches?.length) {
    return (
      <div className="admin-ops-purge-table-wrap">
        <p className="text-steel admin-ops-purge-table__empty">{t('adminOpsPurgeNoBatchesHint')}</p>
        {expectedCadence ? (
          <p className="text-steel admin-ops-purge-table__empty">{expectedCadence}</p>
        ) : null}
      </div>
    )
  }

  const latestId = batches[0]?.batchId

  return (
    <div className="admin-ops-purge-table-wrap">
      <h3 className="admin-ops-purge-table__title">{t('adminOpsPurgeBatchLogTitle')}</h3>
      <table className="admin-ops-purge-table data-table allocation-table">
        <thead>
          <SortableFilterableTableHead
            columns={columns}
            sortState={sortState}
            onSort={handleSort}
            filters={filters}
            onFilterChange={updateFilter}
          />
        </thead>
        <tbody>
          {displayRows.map((batch) => (
            <tr
              key={batch.batchId}
              className={batch.batchId === latestId ? 'admin-ops-purge-table__row--latest' : undefined}
            >
              <td className="admin-ops-purge-table__batch">
                <BatchIdCell batchId={batch.batchId} t={t} />
              </td>
              <td className="admin-ops-purge-table__num">{formatCount(batch.archived)}</td>
              <td className="admin-ops-purge-table__num">{formatCount(batch.deleted)}</td>
              <td className="admin-ops-purge-table__window">
                <span title={formatWhen(batch.lastActedAt)}>{formatRelativeTime(batch.lastActedAt)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {displayRows.length === 0 ? (
        <p className="text-steel admin-ops-detail__empty">{t('tableNoFilterMatch')}</p>
      ) : null}
    </div>
  )
}

export function AtgSyncDetail({ details, t }) {
  const ports = details?.ports ?? []
  if (!ports.length) return null

  const rows = ports.map((port) => {
    const staleLabels = (port.staleSources ?? [])
      .slice(0, 3)
      .map((s) => s.label || s.baseUrl || '—')
      .join(', ')
    return {
      key: port.portId,
      port: port.portName || `Port ${port.portId}`,
      enabled: formatCount(port.totalEnabled),
      enabledSort: Number(port.totalEnabled) || 0,
      stale: formatCount(port.staleCount),
      staleSort: Number(port.staleCount) || 0,
      sources: staleLabels || (port.staleCount > 0 ? t('adminOpsAtgStaleSources') : '—'),
    }
  })

  return (
    <DetailTable
      columns={[
        { key: 'port', label: t('adminOpsAtgPort') },
        {
          key: 'enabled',
          label: t('adminOpsAtgEnabled'),
          className: 'admin-ops-detail-table__num',
          getSortValue: (row) => row.enabledSort,
          getFilterValue: (row) => row.enabled,
        },
        {
          key: 'stale',
          label: t('adminOpsAtgStale'),
          className: 'admin-ops-detail-table__num',
          getSortValue: (row) => row.staleSort,
          getFilterValue: (row) => row.stale,
        },
        { key: 'sources', label: t('adminOpsAtgStaleSource') },
      ]}
      rows={rows}
      noMatchLabel={t('tableNoFilterMatch')}
    />
  )
}

export function SynologyMountDetail({ details, t }) {
  if (!details) return null
  const hb = details.heartbeat
  return (
    <dl className="admin-ops-kv">
      <div className="admin-ops-kv__row">
        <dt>{t('adminOpsSynologyPath')}</dt>
        <dd><code>{details.uploadRoot || '—'}</code></dd>
      </div>
      <div className="admin-ops-kv__row">
        <dt>{t('adminOpsSynologyWritable')}</dt>
        <dd>{details.writable ? t('adminOpsYes') : t('adminOpsNo')}</dd>
      </div>
      <div className="admin-ops-kv__row">
        <dt>{t('adminOpsSynologyHeartbeat')}</dt>
        <dd>
          {hb?.checkedAt
            ? `${hb.ok ? t('adminOpsSynologyHbOk') : t('adminOpsSynologyHbFail')} · ${formatRelativeTime(hb.checkedAt)}`
            : t('adminOpsSynologyHbMissing')}
        </dd>
      </div>
      {details.operationsCount != null ? (
        <div className="admin-ops-kv__row">
          <dt>{t('adminOpsSynologyOpsDirs')}</dt>
          <dd>{formatCount(details.operationsCount)}</dd>
        </div>
      ) : null}
    </dl>
  )
}

export function DataHubDetail({ details, t }) {
  if (!details) return null
  return (
    <dl className="admin-ops-kv">
      <div className="admin-ops-kv__row">
        <dt>{t('adminOpsDataHubEnabled')}</dt>
        <dd>{details.enabled ? t('adminOpsYes') : t('adminOpsNo')}</dd>
      </div>
      {details.baseUrl ? (
        <div className="admin-ops-kv__row">
          <dt>{t('adminOpsDataHubBaseUrl')}</dt>
          <dd><code>{details.baseUrl}</code></dd>
        </div>
      ) : null}
      <div className="admin-ops-kv__row">
        <dt>{t('adminOpsDataHubLastSync')}</dt>
        <dd>
          {details.lastSyncAt ? (
            <>
              {formatRelativeTime(details.lastSyncAt)}
              <span className="admin-ops-kv__sub" title={formatWhen(details.lastSyncAt)}>
                {' '}
                ({details.lastSyncOk ? t('adminOpsDataHubSyncOk') : t('adminOpsDataHubSyncFail')})
              </span>
            </>
          ) : (
            t('adminOpsDataHubNeverSynced')
          )}
        </dd>
      </div>
      {details.lastError ? (
        <div className="admin-ops-kv__row">
          <dt>{t('adminOpsDataHubLastError')}</dt>
          <dd className="admin-ops-kv__error">{details.lastError}</dd>
        </div>
      ) : null}
    </dl>
  )
}

export function PartnerApiDetail({ details, t }) {
  const partners = details?.partners ?? []
  if (!partners.length) {
    return (
      <p className="text-steel admin-ops-detail__empty">
        {details?.activeKeys
          ? t('adminOpsPartnerNoUsage')
          : t('adminOpsPartnerNoKeys')}
      </p>
    )
  }

  const rows = partners.map((p) => ({
    key: p.id,
    name: p.partnerName || '—',
    activity: p.lastActivityAt ? formatRelativeTime(p.lastActivityAt) : '—',
    activitySort: isoSortValue(p.lastActivityAt),
    subs30d: formatCount(p.submissionsLast30d),
    subs30dSort: Number(p.submissionsLast30d) || 0,
  }))

  return (
    <DetailTable
      columns={[
        { key: 'name', label: t('adminOpsPartnerName') },
        {
          key: 'activity',
          label: t('adminOpsPartnerLastActivity'),
          getSortValue: (row) => row.activitySort,
          getFilterValue: (row) => row.activity,
        },
        {
          key: 'subs30d',
          label: t('adminOpsPartnerSubs30d'),
          className: 'admin-ops-detail-table__num',
          getSortValue: (row) => row.subs30dSort,
          getFilterValue: (row) => row.subs30d,
        },
      ]}
      rows={rows}
      noMatchLabel={t('tableNoFilterMatch')}
    />
  )
}

export function StructuredCheckDetail({ check, t }) {
  const details = check.details ?? {}
  switch (check.id) {
    case 'atg_sync':
      return <AtgSyncDetail details={details} t={t} />
    case 'purge_job':
      return (
        <PurgeBatchTable
          batches={details.recentBatches}
          expectedCadence={details.expectedCadence}
          t={t}
        />
      )
    case 'synology_mount':
      return <SynologyMountDetail details={details} t={t} />
    case 'datahub':
      return <DataHubDetail details={details} t={t} />
    case 'partner_api':
      return <PartnerApiDetail details={details} t={t} />
    default:
      return null
  }
}

export function TechnicalJsonDetails({ details, open, onToggle, t }) {
  if (!details || Object.keys(details).length === 0) return null
  return (
    <div className="admin-ops-card__details">
      <button
        type="button"
        className="btn btn--ghost admin-ops-tech-toggle"
        onClick={onToggle}
        aria-expanded={open}
      >
        {open ? t('adminOpsHideTechnical') : t('adminOpsShowTechnical')}
      </button>
      {open ? (
        <pre className="admin-ops-card__json">{JSON.stringify(details, null, 2)}</pre>
      ) : null}
    </div>
  )
}
