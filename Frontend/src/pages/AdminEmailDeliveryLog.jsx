import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { fetchEmailDeliveries } from '../api/notificationAdmin'
import { fetchPorts } from '../api/ports'
import SortableFilterableTableHead from '../components/SortableFilterableTableHead.jsx'
import { useSortableFilterableRows } from '../hooks/useSortableFilterableRows.js'
import '../styles/allocation.css'
import '../styles/admin.css'

const EMAIL_STATUS_OPTIONS = ['sent', 'failed', 'skipped', 'queued']

function isoSortValue(iso) {
  const n = iso ? new Date(iso).getTime() : 0
  return Number.isNaN(n) ? 0 : n
}

function fmtLocalDate(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function defaultRange() {
  const end = new Date()
  const start = new Date()
  start.setDate(end.getDate() - 6)
  return { from: fmtLocalDate(start), to: fmtLocalDate(end) }
}

function statusClass(status) {
  if (status === 'sent') return 'email-log__status--sent'
  if (status === 'failed') return 'email-log__status--failed'
  if (status === 'skipped') return 'email-log__status--skipped'
  return 'email-log__status--queued'
}

export default function AdminEmailDeliveryLog() {
  const { t } = useTranslation('pages')
  const range = useMemo(() => defaultRange(), [])
  const [items, setItems] = useState([])
  const [nextCursor, setNextCursor] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [err, setErr] = useState(null)
  const [ports, setPorts] = useState([])
  const [status, setStatus] = useState('')
  const [eventKey, setEventKey] = useState('')
  const [portId, setPortId] = useState('')
  const [from, setFrom] = useState(range.from)
  const [to, setTo] = useState(range.to)
  const [q, setQ] = useState('')
  const [autoRefresh, setAutoRefresh] = useState(false)

  const loadPorts = useCallback(async () => {
    try {
      const po = await fetchPorts()
      setPorts(Array.isArray(po) ? po : [])
    } catch {
      setPorts([])
    }
  }, [])

  const load = useCallback(
    async (cursor = null, append = false) => {
      if (append) setLoadingMore(true)
      else {
        setLoading(true)
        setErr(null)
      }
      try {
        const res = await fetchEmailDeliveries({
          status: status || undefined,
          eventKey: eventKey || undefined,
          portId: portId || undefined,
          from: from || undefined,
          to: to || undefined,
          q: q.trim() || undefined,
          cursor: cursor || undefined,
          limit: 50,
        })
        const list = Array.isArray(res?.items) ? res.items : []
        setItems((prev) => (append ? [...prev, ...list] : list))
        setNextCursor(res?.nextCursor ?? null)
      } catch (e) {
        setErr(e?.message || 'Failed to load')
        if (!append) setItems([])
      } finally {
        setLoading(false)
        setLoadingMore(false)
      }
    },
    [status, eventKey, portId, from, to, q]
  )

  useEffect(() => {
    loadPorts()
  }, [loadPorts])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!autoRefresh) return undefined
    const id = window.setInterval(() => load(), 30000)
    return () => window.clearInterval(id)
  }, [autoRefresh, load])

  const formatWhen = (v) => {
    if (!v) return '—'
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
  }

  const logColumns = useMemo(
    () => [
      {
        key: 'status',
        label: t('emailLogColStatus'),
        filterType: 'select',
        selectOptions: EMAIL_STATUS_OPTIONS,
        getSortValue: (row) => row.status || '',
        getFilterValue: (row) => row.status || '',
      },
      {
        key: 'updatedAt',
        label: t('emailLogColUpdated'),
        filterType: 'dateRange',
        getDateIso: (row) => row.updatedAt,
        getSortValue: (row) => isoSortValue(row.updatedAt),
      },
      {
        key: 'recipient',
        label: t('emailLogColRecipient'),
        getSortValue: (row) => (row.recipientEmail || row.recipientUsername || '').toLowerCase(),
        getFilterValue: (row) => [row.recipientEmail, row.recipientUsername].filter(Boolean).join(' '),
      },
      {
        key: 'event',
        label: t('emailLogColEvent'),
        getSortValue: (row) => (row.eventLabel || row.eventKey || '').toLowerCase(),
        getFilterValue: (row) => [row.eventLabel, row.eventKey].filter(Boolean).join(' '),
      },
      {
        key: 'subject',
        label: t('emailLogColSubject'),
        getSortValue: (row) => (row.subject || '').toLowerCase(),
        getFilterValue: (row) => row.subject || '',
      },
      {
        key: 'vessel',
        label: t('emailLogColVessel'),
        getSortValue: (row) => (row.vesselName || '').toLowerCase(),
        getFilterValue: (row) => [row.vesselName, row.jettyOperationCode].filter(Boolean).join(' '),
      },
      {
        key: 'port',
        label: t('emailLogColPort'),
        getSortValue: (row) => (row.portName || '').toLowerCase(),
        getFilterValue: (row) => row.portName || '',
      },
      {
        key: 'messageId',
        label: t('emailLogColMessageId'),
        getSortValue: (row) => (row.providerMessageId || '').toLowerCase(),
        getFilterValue: (row) => row.providerMessageId || '',
      },
      {
        key: 'error',
        label: t('emailLogColError'),
        getSortValue: (row) => (row.errorText || '').toLowerCase(),
        getFilterValue: (row) => row.errorText || '',
      },
    ],
    [t]
  )

  const { displayRows, filters, updateFilter, sortState, handleSort } = useSortableFilterableRows(
    items,
    logColumns,
    { key: 'updatedAt', dir: 'desc' }
  )

  const copyMessageId = async (id) => {
    if (!id) return
    try {
      await navigator.clipboard.writeText(String(id))
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="allocation-page admin-email-log">
      <Link to="/admin/notifications" className="admin-notifications__back">
        ← {t('adminHubNotificationsTitle')}
      </Link>
      <h1 className="page-title">{t('adminHubEmailLogTitle')}</h1>
      <p className="allocation-page__intro">{t('adminHubEmailLogDesc')}</p>

      <div className="admin-email-log__filters card">
        <label>
          {t('emailLogStatus')}
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t('emailLogAllStatuses')}</option>
            <option value="sent">sent</option>
            <option value="failed">failed</option>
            <option value="skipped">skipped</option>
            <option value="queued">queued</option>
          </select>
        </label>
        <label>
          {t('emailLogEvent')}
          <select value={eventKey} onChange={(e) => setEventKey(e.target.value)}>
            <option value="">{t('emailLogAllEvents')}</option>
            <option value="operation.sla_etc_d1">SLA D-1 Reminder</option>
            <option value="operation.sla_etc_breach">SLA Breach Alert</option>
            <option value="operation.signoff_requested">Clearance Sign Off Request</option>
            <option value="shipment_plan.submitted">Shipment Plan Approval</option>
          </select>
        </label>
        <label>
          {t('emailLogPort')}
          <select value={portId} onChange={(e) => setPortId(e.target.value)}>
            <option value="">{t('emailLogAllPorts')}</option>
            {ports.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('emailLogFrom')}
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          {t('emailLogTo')}
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label className="admin-email-log__search">
          {t('emailLogSearch')}
          <input
            type="search"
            value={q}
            placeholder={t('emailLogSearchPlaceholder')}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <label className="admin-email-log__auto">
          <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
          {t('emailLogAutoRefresh')}
        </label>
        <button type="button" className="btn btn--secondary btn--sm" onClick={() => load()}>
          {t('emailLogApply')}
        </button>
      </div>

      {err && <p className="admin-notifications__err">{err}</p>}

      <div className="card admin-email-log__table-wrap">
        {loading ? (
          <p>{t('notifAdminLoading')}</p>
        ) : items.length === 0 ? (
          <p>{t('emailLogEmpty')}</p>
        ) : (
          <table className="admin-email-log__table data-table allocation-table">
            <thead>
              <SortableFilterableTableHead
                columns={logColumns}
                sortState={sortState}
                onSort={handleSort}
                filters={filters}
                onFilterChange={updateFilter}
                trailingBlankCols={0}
                trailingBlankLabel=""
              />
            </thead>
            <tbody>
              {displayRows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <span className={`email-log__status ${statusClass(row.status)}`}>{row.status}</span>
                  </td>
                  <td>{formatWhen(row.updatedAt)}</td>
                  <td>
                    <div>{row.recipientEmail || '—'}</div>
                    <div className="admin-email-log__muted">{row.recipientUsername}</div>
                  </td>
                  <td>{row.eventLabel || row.eventKey}</td>
                  <td>{row.subject}</td>
                  <td>
                    {row.vesselName || '—'}
                    {row.jettyOperationCode ? (
                      <div className="admin-email-log__muted">{row.jettyOperationCode}</div>
                    ) : null}
                  </td>
                  <td>{row.portName || '—'}</td>
                  <td className="admin-email-log__message-id">
                    {row.providerMessageId ? (
                      <>
                        <code title={row.providerMessageId}>{row.providerMessageId}</code>
                        <button
                          type="button"
                          className="btn btn--ghost btn--xs admin-email-log__copy"
                          title={t('emailLogCopyMessageId')}
                          onClick={() => copyMessageId(row.providerMessageId)}
                        >
                          {t('emailLogCopyMessageId')}
                        </button>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="admin-email-log__error" title={row.errorText || ''}>
                    {row.errorText ? row.errorText.slice(0, 80) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!loading && items.length > 0 && displayRows.length === 0 && (
          <p className="text-steel">{t('tableNoFilterMatch')}</p>
        )}
        {nextCursor && (
          <button
            type="button"
            className="btn btn--ghost admin-email-log__more"
            disabled={loadingMore}
            onClick={() => load(nextCursor, true)}
          >
            {loadingMore ? t('notifAdminLoading') : t('emailLogLoadMore')}
          </button>
        )}
      </div>
    </div>
  )
}
