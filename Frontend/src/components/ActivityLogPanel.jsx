import { useState, useMemo, useCallback, useEffect } from 'react'
import { fetchActivityLogs } from '../api/activityLogs'
import '../styles/activity-log.css'

function formatTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
}

const ACTION_LABELS = { add: 'Added', update: 'Updated', delete: 'Deleted' }

const LEGACY_PORT_ID_LABEL = /^Port\s*#?\d+$/i

/** Resolve display name for port activity rows (never show "Port 4" id-style labels). */
function resolvePortActivityName(entry) {
  const metaName = entry.meta?.portName != null ? String(entry.meta.portName).trim() : ''
  if (metaName) return metaName
  const quoted = entry.summary?.match(/"([^"]+)"/)?.[1]?.trim()
  if (quoted) return quoted
  const summaryTrim = (entry.summary || '').trim()
  if (
    summaryTrim &&
    !/^deleted\b/i.test(summaryTrim) &&
    !LEGACY_PORT_ID_LABEL.test(summaryTrim) &&
    !/^\d+$/.test(summaryTrim)
  ) {
    return summaryTrim
  }
  const label = (entry.entityLabel || '').trim()
  if (label && !LEGACY_PORT_ID_LABEL.test(label) && !/^\d+$/.test(label)) return label
  return null
}

function formatActivityEntityLabel(entry) {
  const type = (entry.entityType || '').trim()
  if (type.toLowerCase() === 'port') {
    return resolvePortActivityName(entry) || ''
  }
  const label = (entry.entityLabel || '').trim()
  if (LEGACY_PORT_ID_LABEL.test(label)) {
    const resolved = resolvePortActivityName({ ...entry, entityType: 'Port' })
    if (resolved) return resolved
    return ''
  }
  return label || type || ''
}

function normalizeDetails(details) {
  if (!details) return null
  if (typeof details === 'string') return { summary: details }
  if (typeof details === 'object') return details
  return { summary: String(details) }
}

export default function ActivityLogPanel({ pageKey }) {
  const [open, setOpen] = useState(false)
  const [actionFilter, setActionFilter] = useState('all')
  const [expanded, setExpanded] = useState(() => new Set())
  const [items, setItems] = useState([])
  const [nextCursor, setNextCursor] = useState(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(null)

  const activities = items
  const filtered = useMemo(() => {
    if (actionFilter === 'all') return activities
    return activities.filter((a) => a.action === actionFilter)
  }, [activities, actionFilter])

  const loadFirst = useCallback(async () => {
    if (!pageKey) return
    setErr(null)
    setLoading(true)
    try {
      const res = await fetchActivityLogs({ pageKey, limit: 50 })
      setItems(res.items || [])
      setNextCursor(res.nextCursor || null)
    } catch (e) {
      setErr(e?.message || 'Failed to load')
      setItems([])
      setNextCursor(null)
    } finally {
      setLoading(false)
    }
  }, [pageKey])

  const loadMore = useCallback(async () => {
    if (!pageKey || !nextCursor || loading) return
    setErr(null)
    setLoading(true)
    try {
      const res = await fetchActivityLogs({ pageKey, limit: 50, cursor: nextCursor })
      setItems((prev) => [...prev, ...(res.items || [])])
      setNextCursor(res.nextCursor || null)
    } catch (e) {
      setErr(e?.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [pageKey, nextCursor, loading])

  useEffect(() => {
    if (open) loadFirst()
  }, [open, loadFirst])

  useEffect(() => {
    // When navigating between pages, reset pagination and collapse state
    setExpanded(new Set())
    setItems([])
    setNextCursor(null)
    setErr(null)
    if (open) loadFirst()
  }, [pageKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleExpanded = useCallback((id) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  if (!pageKey) return null

  return (
    <div className={`activity-log-wrap ${open ? 'activity-log-wrap--open' : ''}`}>
      <button
        type="button"
        className="activity-log-tab"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={open ? 'Close Activity Log' : 'Open Activity Log'}
        title="Activity Log"
      >
        <span className="activity-log-tab__icon">📋</span>
        <span className="activity-log-tab__label">Activity Log</span>
        {activities.length > 0 && (
          <span className="activity-log-tab__badge" aria-label={`${activities.length} entries`}>
            {activities.length}
          </span>
        )}
      </button>
      {open && (
        <aside className="activity-log-panel" aria-label="Activity log for this page">
          <div className="activity-log-panel__header">
            <h3 className="activity-log-panel__title">Activity Log</h3>
            <button
              type="button"
              className="activity-log-panel__close"
              onClick={() => setOpen(false)}
              aria-label="Close"
            >
              ×
            </button>
          </div>
          <div className="activity-log-panel__filters">
            {['all', 'add', 'update', 'delete'].map((a) => (
              <button
                key={a}
                type="button"
                className={`activity-log-panel__filter ${actionFilter === a ? 'activity-log-panel__filter--active' : ''}`}
                onClick={() => setActionFilter(a)}
              >
                {a === 'all' ? 'All' : ACTION_LABELS[a]}
              </button>
            ))}
          </div>
          <div className="activity-log-panel__list">
            {err && <p className="activity-log-panel__empty" style={{ color: '#c00' }}>{err}</p>}
            {loading && filtered.length === 0 ? (
              <p className="activity-log-panel__empty">Loading…</p>
            ) : filtered.length === 0 ? (
              <p className="activity-log-panel__empty">No activity yet.</p>
            ) : (
              filtered.map((entry) => (
                (() => {
                  const d = normalizeDetails(entry.changes || entry.details ? { summary: entry.summary || entry.details, changes: entry.changes } : entry.details)
                  const hasChanges = Array.isArray(d?.changes) && d.changes.length > 0
                  const isOpen = expanded.has(entry.id)
                  const entityDisplay = formatActivityEntityLabel(entry)
                  return (
                <div key={entry.id} className="activity-log-entry" data-action={entry.action}>
                  <div className="activity-log-entry__meta">
                    <span className="activity-log-entry__user">{entry.actorUsername || '—'}</span>
                    <span className="activity-log-entry__time">{formatTime(entry.createdAt || entry.timestamp)}</span>
                  </div>
                  <div className="activity-log-entry__action" data-action={entry.action}>
                    {ACTION_LABELS[entry.action] || entry.action}
                    {entityDisplay ? (
                      <>
                        {' '}
                        <strong>{entityDisplay}</strong>
                      </>
                    ) : null}
                  </div>
                  {d?.summary && <div className="activity-log-entry__details">{d.summary}</div>}
                  {hasChanges && (
                    <button
                      type="button"
                      className="activity-log-entry__toggle"
                      onClick={() => toggleExpanded(entry.id)}
                      aria-expanded={isOpen}
                    >
                      {isOpen ? 'Hide details' : 'Show details'}
                    </button>
                  )}
                  {hasChanges && isOpen && (
                    <div className="activity-log-entry__changes" role="region" aria-label="Detailed changes">
                      <ul className="activity-log-entry__changes-list">
                        {d.changes.map((c, idx) => (
                          <li key={idx} className="activity-log-entry__change">
                            <div className="activity-log-entry__change-field">{c.field}</div>
                            <div className="activity-log-entry__change-values">
                              <span className="activity-log-entry__change-from">{c.from ?? '—'}</span>
                              <span className="activity-log-entry__change-arrow">→</span>
                              <span className="activity-log-entry__change-to">{c.to ?? '—'}</span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
                  )
                })()
              ))
            )}
            {nextCursor && (
              <button type="button" className="activity-log-panel__filter" onClick={loadMore} disabled={loading} style={{ width: '100%', marginTop: 8 }}>
                {loading ? 'Loading…' : 'Load more'}
              </button>
            )}
          </div>
        </aside>
      )}
    </div>
  )
}
