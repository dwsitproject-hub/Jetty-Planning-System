import { useState } from 'react'
import { formatCount, formatRelativeTime, formatWhen, shortBatchId } from '../../utils/adminOpsDisplay'

function DetailTable({ columns, rows, emptyMessage }) {
  if (!rows?.length) {
    return emptyMessage ? <p className="text-steel admin-ops-detail__empty">{emptyMessage}</p> : null
  }
  return (
    <div className="admin-ops-detail-table-wrap">
      <table className="admin-ops-detail-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} className={col.className}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
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
      <button type="button" className="btn btn--secondary btn--small admin-ops-copy-btn" onClick={copy}>
        {copied ? t('adminOpsCopied') : t('adminOpsCopy')}
      </button>
    </span>
  )
}

export function PurgeBatchTable({ batches, expectedCadence, t }) {
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

  return (
    <div className="admin-ops-purge-table-wrap">
      <h3 className="admin-ops-purge-table__title">{t('adminOpsPurgeBatchLogTitle')}</h3>
      <table className="admin-ops-purge-table">
        <thead>
          <tr>
            <th>{t('adminOpsPurgeBatchId')}</th>
            <th className="admin-ops-purge-table__num">{t('adminOpsPurgeArchive')}</th>
            <th className="admin-ops-purge-table__num">{t('adminOpsPurgeDelete')}</th>
            <th>{t('adminOpsPurgeCompleted')}</th>
          </tr>
        </thead>
        <tbody>
          {batches.map((batch, index) => (
            <tr
              key={batch.batchId}
              className={index === 0 ? 'admin-ops-purge-table__row--latest' : undefined}
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
      stale: formatCount(port.staleCount),
      sources: staleLabels || (port.staleCount > 0 ? t('adminOpsAtgStaleSources') : '—'),
    }
  })

  return (
    <DetailTable
      columns={[
        { key: 'port', label: t('adminOpsAtgPort') },
        { key: 'enabled', label: t('adminOpsAtgEnabled'), className: 'admin-ops-detail-table__num' },
        { key: 'stale', label: t('adminOpsAtgStale'), className: 'admin-ops-detail-table__num' },
        { key: 'sources', label: t('adminOpsAtgStaleSource') },
      ]}
      rows={rows}
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
    subs30d: formatCount(p.submissionsLast30d),
  }))

  return (
    <DetailTable
      columns={[
        { key: 'name', label: t('adminOpsPartnerName') },
        { key: 'activity', label: t('adminOpsPartnerLastActivity') },
        { key: 'subs30d', label: t('adminOpsPartnerSubs30d'), className: 'admin-ops-detail-table__num' },
      ]}
      rows={rows}
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
        className="btn btn--secondary btn--small"
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
