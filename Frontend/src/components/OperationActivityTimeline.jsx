import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchActivityTimeline, deleteOperationalEntry, deleteSubProcess } from '../api/operations'
import { formatDateTimeDisplay } from '../utils/formatDateTimeDisplay'
import {
  buildActivityLogEditPath,
  activityLogRowCanDelete,
} from '../utils/atBerthActivityLogNav'

function formatTimelineDuration(startIso, endIso) {
  if (!startIso || !endIso) return '—'
  const a = new Date(startIso).getTime()
  const b = new Date(endIso).getTime()
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return '—'
  const mins = Math.round((b - a) / 60000)
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${h}h ${m}m`
}

/** Resolve display timestamps + duration per timeline source (API event shape). */
function timelineRowSchedule(ev) {
  if (ev.source === 'operational_activity') {
    return {
      start: ev.startAt ?? null,
      end: ev.endAt ?? null,
      duration: formatTimelineDuration(ev.startAt, ev.endAt),
    }
  }
  if (ev.source === 'operational_milestone_na') {
    return {
      start: ev.sortAt ?? null,
      end: null,
      duration: '—',
    }
  }
  if (ev.source === 'sub_process') {
    const at = ev.occurredAt ?? null
    return {
      start: at,
      end: null,
      duration: '—',
    }
  }
  return {
    start: ev.sortAt ?? null,
    end: null,
    duration: '—',
  }
}

function parseOperationalEntryId(ev) {
  const m = /^op-(\d+)$/.exec(String(ev.id || ''))
  return m ? parseInt(m[1], 10) : null
}

/**
 * Unified Pre-Checking + Operational + Post-Checking timeline for one operation.
 */
export default function OperationActivityTimeline({
  operationId,
  refreshToken = 0,
  className = '',
  vesselId = null,
  basePath = null,
  onActivityLogRefresh,
}) {
  const navigate = useNavigate()
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [deletingId, setDeletingId] = useState(null)
  const [toast, setToast] = useState(null)

  useEffect(() => {
    if (!toast?.message) return undefined
    const t = window.setTimeout(() => setToast(null), 6500)
    return () => clearTimeout(t)
  }, [toast])

  const load = useCallback(() => {
    if (!operationId) {
      setEvents([])
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    fetchActivityTimeline(operationId)
      .then((res) => setEvents(Array.isArray(res?.events) ? res.events : []))
      .catch((e) => {
        setEvents([])
        setError(e?.message || 'Failed to load activity timeline')
      })
      .finally(() => setLoading(false))
  }, [operationId])

  useEffect(() => {
    load()
  }, [load, refreshToken])

  const handleEdit = (ev) => {
    const path = buildActivityLogEditPath(ev, { vesselId, basePath })
    if (!path) return
    // Do not toast here: the destination (Pre/Post/Operational) already shows "Editing …"
    // after ?edit=1; a second toast would overlap (same fixed bottom-right position).
    navigate(path)
  }

  const handleDelete = async (ev) => {
    if (!operationId || !activityLogRowCanDelete(ev)) return
    const label = ev.title || ev.phase || 'this entry'
    if (!window.confirm(`Remove ${label} from the activity log? This cannot be undone.`)) return

    setDeletingId(ev.id)
    try {
      if (ev.source === 'sub_process') {
        const phase = ev.phase
        const key = ev.subProcessKey
        if (!phase || !key) throw new Error('Missing phase or sub-process key')
        await deleteSubProcess(operationId, key, phase)
      } else if (ev.source === 'operational_activity' || ev.source === 'operational_milestone_na') {
        const entryId = parseOperationalEntryId(ev)
        if (entryId == null) throw new Error('Invalid entry id')
        await deleteOperationalEntry(operationId, entryId)
      } else {
        throw new Error('This row cannot be deleted')
      }
      setToast({ message: 'Activity removed.', variant: 'success' })
      await load()
      onActivityLogRefresh?.()
    } catch (e) {
      setToast({ message: e?.message || 'Remove failed.', variant: 'error' })
    } finally {
      setDeletingId(null)
    }
  }

  if (!operationId) {
    return (
      <section className={`operation-activity-timeline berthing-modal__card ${className}`}>
        <h3 className="berthing-modal__card-title">Activity log</h3>
        <p className="text-steel">Open an operation from At-Berth to see a saved timeline.</p>
      </section>
    )
  }

  return (
    <section className={`operation-activity-timeline berthing-modal__card ${className}`}>
      <h3 className="berthing-modal__card-title">Detailed At-Berth Executions Log</h3>
      {toast?.message && (
        <div
          className={`toast ${toast.variant === 'error' ? 'toast--warning' : 'toast--success'}`}
          role={toast.variant === 'error' ? 'alert' : 'status'}
          aria-live={toast.variant === 'error' ? 'assertive' : 'polite'}
          aria-atomic="true"
        >
          <span className="toast__icon" aria-hidden>
            {toast.variant === 'error' ? '!' : '✓'}
          </span>
          <p className="toast__message">{toast.message}</p>
          <button type="button" className="toast__close" onClick={() => setToast(null)} aria-label="Dismiss notification">
            ×
          </button>
        </div>
      )}
      {loading && <p className="text-steel">Loading…</p>}
      {error && (
        <p className="text-steel" style={{ color: 'var(--danger-600, #c00)' }}>
          {error}
        </p>
      )}
      {!loading && !error && events.length === 0 && (
        <p className="text-steel">No recorded activities yet for this operation.</p>
      )}
      {!loading && !error && events.length > 0 && (
        <div className="operation-activity-timeline__table-wrap">
          <table className="loading-detail-activity-table operation-activity-timeline__table">
            <thead>
              <tr>
                <th>Phase</th>
                <th>Title</th>
                <th>Detail</th>
                <th className="operation-activity-timeline__time">Start time</th>
                <th className="operation-activity-timeline__time">End time</th>
                <th className="operation-activity-timeline__time">Duration</th>
                <th className="operation-activity-timeline__actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {events.map((ev) => {
                const { start, end, duration } = timelineRowSchedule(ev)
                const editPath = buildActivityLogEditPath(ev, { vesselId, basePath })
                const canDelete = activityLogRowCanDelete(ev)
                const busy = deletingId === ev.id
                return (
                  <tr key={ev.id}>
                    <td>{ev.phase || '—'}</td>
                    <td>{ev.title || '—'}</td>
                    <td className="operation-activity-timeline__detail">
                      {ev.source === 'operational_milestone_na' ? (
                        <span>N/A: {ev.reason || '—'}</span>
                      ) : ev.source === 'operational_activity' ? (
                        <span>
                          {[ev.subStepTitle, ev.cargoHandlingMethodName, ev.remark].filter(Boolean).join(' — ') || ev.remark || '—'}
                        </span>
                      ) : (
                        <span>
                          {[ev.status, ev.remark].filter(Boolean).join(' · ') || ev.remark || '—'}
                        </span>
                      )}
                    </td>
                    <td className="operation-activity-timeline__time">{start ? formatDateTimeDisplay(start) : '—'}</td>
                    <td className="operation-activity-timeline__time">{end ? formatDateTimeDisplay(end) : '—'}</td>
                    <td className="operation-activity-timeline__time">{duration}</td>
                    <td className="operation-activity-timeline__actions">
                      {editPath || canDelete ? (
                        <div className="operation-activity-timeline__action-btns">
                          {editPath ? (
                            <button
                              type="button"
                              className="btn btn--small btn--ghost"
                              onClick={() => handleEdit(ev)}
                              disabled={busy}
                            >
                              Edit
                            </button>
                          ) : null}
                          {canDelete ? (
                            <button
                              type="button"
                              className="btn btn--small btn--danger-soft"
                              onClick={() => handleDelete(ev)}
                              disabled={busy}
                            >
                              {busy ? '…' : 'Delete'}
                            </button>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-steel">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
