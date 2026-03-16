import { useState, useMemo } from 'react'
import { useActivityLog } from '../context/ActivityLogContext'
import '../styles/activity-log.css'

function formatTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
}

const ACTION_LABELS = { add: 'Added', update: 'Updated', delete: 'Deleted' }

export default function ActivityLogPanel({ pageKey }) {
  const { getActivitiesForPage } = useActivityLog()
  const [open, setOpen] = useState(false)
  const [actionFilter, setActionFilter] = useState('all')

  const activities = useMemo(() => getActivitiesForPage(pageKey), [getActivitiesForPage, pageKey])
  const filtered = useMemo(() => {
    if (actionFilter === 'all') return activities
    return activities.filter((a) => a.action === actionFilter)
  }, [activities, actionFilter])

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
            {filtered.length === 0 ? (
              <p className="activity-log-panel__empty">No activity yet.</p>
            ) : (
              filtered.map((entry) => (
                <div key={entry.id} className="activity-log-entry" data-action={entry.action}>
                  <div className="activity-log-entry__meta">
                    <span className="activity-log-entry__user">{entry.user}</span>
                    <span className="activity-log-entry__time">{formatTime(entry.timestamp)}</span>
                  </div>
                  <div className="activity-log-entry__action" data-action={entry.action}>
                    {ACTION_LABELS[entry.action] || entry.action}{' '}
                    {entry.entityType ? (
                      <strong>{entry.entityLabel || entry.entityType}</strong>
                    ) : null}
                  </div>
                  {entry.details && (
                    <div className="activity-log-entry__details">{entry.details}</div>
                  )}
                </div>
              ))
            )}
          </div>
        </aside>
      )}
    </div>
  )
}
