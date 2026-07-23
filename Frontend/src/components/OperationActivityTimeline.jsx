import { useEffect, useState, useCallback, useMemo, useRef, Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  fetchActivityTimeline,
  deleteOperationalEntry,
  deleteSubProcess,
  fetchSubProcessDocuments,
} from '../api/operations'
import { resolveUploadUrl } from '../api/client'
import FilePreviewLink from './FilePreviewLink'
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
    const start = ev.startAt ?? ev.occurredAt ?? null
    const end = ev.endAt ?? null
    return {
      start,
      end,
      duration: formatTimelineDuration(start, end),
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

function timelineStatusDisplay(ev) {
  if (ev.source === 'operational_milestone_na') return 'N/A'
  if (ev.source === 'sub_process') {
    const s = ev.status != null ? String(ev.status).trim() : ''
    return s || '—'
  }
  if (ev.source === 'operational_activity') {
    if (ev.endAt) return 'Done'
    if (ev.startAt) return 'In Progress'
    return '—'
  }
  return '—'
}

const REMARK_PREVIEW_MAX_CHARS = 120

function timelineCargoMetadataParts(ev, t) {
  if (ev.source !== 'operational_activity' || ev.milestoneKey !== 'cargo_operations') return []
  const parts = []
  const n = Number(ev.cargoLoadLineCount || 0)
  if (n > 0 && ev.cargoMovedQty != null && Number.isFinite(Number(ev.cargoMovedQty))) {
    parts.push(
      t('cargoOpsTimelineEntries', {
        n,
        qty: Number(ev.cargoMovedQty).toLocaleString(undefined, { maximumFractionDigits: 6 }),
      })
    )
    const lastEnd = ev.cargoLastLineEndedAt ?? ev.cargoLastAsOf
    if (lastEnd) {
      parts.push(
        t('cargoOpsTimelineLastLineEnd', {
          at: formatDateTimeDisplay(lastEnd),
        })
      )
    }
    if (ev.cargoRatePerHour != null && Number.isFinite(Number(ev.cargoRatePerHour))) {
      parts.push(
        t('cargoOpsTimelineRate', {
          rate: Number(ev.cargoRatePerHour).toLocaleString(undefined, { maximumFractionDigits: 6 }),
        })
      )
    }
  } else if (ev.cargoMovedQty != null && Number.isFinite(Number(ev.cargoMovedQty))) {
    parts.push(
      t('cargoOpsTimelineMoved', {
        qty: Number(ev.cargoMovedQty).toLocaleString(undefined, { maximumFractionDigits: 6 }),
      })
    )
    if (ev.cargoRatePerHour != null && Number.isFinite(Number(ev.cargoRatePerHour))) {
      parts.push(
        t('cargoOpsTimelineRate', {
          rate: Number(ev.cargoRatePerHour).toLocaleString(undefined, { maximumFractionDigits: 6 }),
        })
      )
    }
  }
  return parts
}

/** Short metadata shown in the table (excludes free-text remark). */
function timelineRemarkSummary(ev, t) {
  if (ev.source === 'operational_activity') {
    const parts = [ev.subStepTitle, ev.cargoHandlingMethodName]
      .filter((x) => x && String(x).trim())
      .map((x) => String(x).trim())
    parts.push(...timelineCargoMetadataParts(ev, t))
    return parts.length ? parts.join(' — ') : null
  }
  return null
}

/** Free-text remark / reason for modal or inline preview. */
function timelineRemarkNarrative(ev) {
  if (ev.source === 'operational_milestone_na') {
    return ev.reason != null && String(ev.reason).trim() ? String(ev.reason).trim() : null
  }
  if (ev.source === 'operational_activity') {
    return ev.remark != null && String(ev.remark).trim() ? String(ev.remark).trim() : null
  }
  if (ev.source === 'sub_process') {
    const parts = []
    if (ev.remark != null && String(ev.remark).trim()) parts.push(String(ev.remark).trim())
    if (ev.skipReason != null && String(ev.skipReason).trim()) parts.push(`Skip: ${String(ev.skipReason).trim()}`)
    return parts.length ? parts.join('\n') : null
  }
  if (ev.remark != null && String(ev.remark).trim()) return String(ev.remark).trim()
  return null
}

function needsRemarkModal(text) {
  if (!text) return false
  const s = String(text)
  return s.length > REMARK_PREVIEW_MAX_CHARS || s.includes('\n')
}

function truncateRemarkPreview(text, max = REMARK_PREVIEW_MAX_CHARS) {
  if (!text) return ''
  const firstLine = String(text).split('\n')[0].trim()
  if (firstLine.length <= max) return firstLine
  return `${firstLine.slice(0, max).trimEnd()}…`
}

function remarkViewerSubtitle(start, end) {
  const parts = []
  if (start) parts.push(formatDateTimeDisplay(start))
  if (end) parts.push(formatDateTimeDisplay(end))
  return parts.length ? parts.join(' → ') : null
}

function RemarkViewerModal({ viewer, onClose }) {
  if (!viewer) return null
  return (
    <div className="modal-overlay" onClick={onClose} aria-hidden="true">
      <div
        className="modal modal--wide operation-activity-timeline__remark-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="remark-viewer-title"
      >
        <header className="modal__header">
          <div>
            <h2 id="remark-viewer-title" className="modal__title">
              {viewer.title}
            </h2>
            {viewer.subtitle ? <p className="operation-activity-timeline__remark-modal-subtitle text-steel">{viewer.subtitle}</p> : null}
          </div>
          <button type="button" className="modal__close" onClick={onClose} aria-label="Close">
            Close
          </button>
        </header>
        <div className="operation-activity-timeline__remark-modal-body">
          {Array.isArray(viewer.sections) && viewer.sections.length > 0 ? (
            viewer.sections.map((sec, idx) => (
              <div key={sec.heading || idx} className="operation-activity-timeline__remark-modal-section">
                {sec.heading ? <h3 className="operation-activity-timeline__remark-modal-section-title">{sec.heading}</h3> : null}
                <pre className="operation-activity-timeline__remark-modal-text">{sec.text}</pre>
              </div>
            ))
          ) : (
            <pre className="operation-activity-timeline__remark-modal-text">{viewer.text}</pre>
          )}
        </div>
        <footer className="modal__footer">
          <button type="button" className="btn btn--small" onClick={onClose}>
            Close
          </button>
        </footer>
      </div>
    </div>
  )
}

function TimelineRemarkCell({ ev, t, onViewRemark }) {
  const summary = timelineRemarkSummary(ev, t)
  const narrative = timelineRemarkNarrative(ev)
  const showModal = narrative && needsRemarkModal(narrative)
  const inlineNarrative = narrative && !showModal ? narrative : null
  const preview = showModal ? truncateRemarkPreview(narrative) : null

  if (!summary && !inlineNarrative && !preview) {
    return <span className="text-steel">—</span>
  }

  const openViewer = () => {
    const { start, end } = timelineRowSchedule(ev)
    onViewRemark({
      title: `Remark — ${ev.title || ev.phase || 'Activity'}`,
      subtitle: remarkViewerSubtitle(start, end),
      text: narrative,
    })
  }

  return (
    <div className="operation-activity-timeline__remark-cell">
      {summary ? <div className="operation-activity-timeline__remark-summary">{summary}</div> : null}
      {inlineNarrative ? (
        <div className="operation-activity-timeline__remark-preview">{inlineNarrative}</div>
      ) : null}
      {preview ? <div className="operation-activity-timeline__remark-preview">{preview}</div> : null}
      {showModal ? (
        <button
          type="button"
          className="operation-activity-timeline__remark-view-link"
          onClick={openViewer}
        >
          View
        </button>
      ) : null}
    </div>
  )
}

function CargoGroupRemarkCell({ events, t, onViewRemark }) {
  const narratives = events
    .map((ev, i) => ({
      heading: events.length > 1 ? `Entry ${i + 1}` : null,
      text: timelineRemarkNarrative(ev),
      ev,
    }))
    .filter((x) => x.text)

  const count = events.length
  const latestText = narratives.length ? narratives[narratives.length - 1].text : null
  const anyLong = narratives.some((n) => needsRemarkModal(n.text))
  const showViewBtn = narratives.length > 0 && (anyLong || narratives.length > 1)
  const preview = latestText && (anyLong || narratives.length > 1) ? truncateRemarkPreview(latestText) : null
  const inlineLatest = latestText && !showViewBtn ? latestText : null

  if (!narratives.length) {
    return <span className="text-steel">—</span>
  }

  const openViewer = () => {
    const { start, end } = cargoGroupScheduleRange(events)
    onViewRemark({
      title: 'Remarks — CARGO OPERATIONS',
      subtitle: remarkViewerSubtitle(start, end),
      sections: narratives.map((n) => ({
        heading: n.heading,
        text: n.text,
      })),
    })
  }

  return (
    <div className="operation-activity-timeline__remark-cell">
      <div className="operation-activity-timeline__remark-summary">
        {t('executionsLogCargoGroupTitle', { count })}
      </div>
      {inlineLatest ? <div className="operation-activity-timeline__remark-preview">{inlineLatest}</div> : null}
      {preview ? <div className="operation-activity-timeline__remark-preview">{preview}</div> : null}
      {showViewBtn ? (
        <button
          type="button"
          className="operation-activity-timeline__remark-view-link"
          onClick={openViewer}
        >
          View
        </button>
      ) : null}
    </div>
  )
}

function timelineDocuments(ev) {
  const list = Array.isArray(ev.documents) ? ev.documents : []
  return list.filter((d) => d && (d.url || d.id))
}

function isCargoOperationsActivity(ev) {
  return ev?.source === 'operational_activity' && ev?.milestoneKey === 'cargo_operations'
}

/** Consecutive cargo_operations activities → one expandable group (including a single segment). */
function buildTimelineDisplayItems(events) {
  if (!Array.isArray(events) || events.length === 0) return []
  const items = []
  let i = 0
  while (i < events.length) {
    const ev = events[i]
    if (isCargoOperationsActivity(ev)) {
      let j = i + 1
      while (j < events.length && isCargoOperationsActivity(events[j])) j += 1
      const slice = events.slice(i, j)
      items.push({
        kind: 'cargo_operations_group',
        id: `cargo-ops-group-${slice[0].id}`,
        events: slice,
      })
      i = j
    } else {
      items.push({ kind: 'row', ev })
      i += 1
    }
  }
  return items
}

function aggregateCargoGroupStatus(groupEvents) {
  let anyInProgress = false
  let allDone = true
  for (const ev of groupEvents) {
    const s = timelineStatusDisplay(ev)
    if (s === 'In Progress') anyInProgress = true
    if (s !== 'Done') allDone = false
  }
  if (anyInProgress) return 'In Progress'
  if (allDone && groupEvents.length > 0) return 'Done'
  return '—'
}

function cargoGroupScheduleRange(groupEvents) {
  let minStart = null
  let maxEnd = null
  for (const ev of groupEvents) {
    const { start, end } = timelineRowSchedule(ev)
    if (start) {
      const t = new Date(start).getTime()
      if (!minStart || t < new Date(minStart).getTime()) minStart = start
    }
    if (end) {
      const t = new Date(end).getTime()
      if (!maxEnd || t > new Date(maxEnd).getTime()) maxEnd = end
    }
  }
  return {
    start: minStart,
    end: maxEnd,
    duration: formatTimelineDuration(minStart, maxEnd),
  }
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
  /** Total SI cargo qty (for Balance column in nested cargo-ops table). */
  cargoSiQty = null,
  /** Metric label to display next to Qty / Balance values (e.g. "MT"). */
  cargoSiMetricLabel = null,
  /** When set, only show events matching this phase (e.g. "Operational"). */
  phaseFilter = null,
  /** Override default card title. */
  title = null,
  /** Hide Phase column when filtered to a single phase. */
  hidePhaseColumn = false,
  /** Nested inside a parent section — omit outer berthing card chrome. */
  embedded = false,
  /** Parent-provided events (skips internal fetch when defined). */
  eventsOverride = undefined,
  loadingOverride = undefined,
  errorOverride = undefined,
}) {
  const navigate = useNavigate()
  const { t } = useTranslation('pages')
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [deletingId, setDeletingId] = useState(null)
  const [toast, setToast] = useState(null)
  const [remarkViewer, setRemarkViewer] = useState(null)

  const openRemarkViewer = useCallback((viewer) => {
    setRemarkViewer(viewer)
  }, [])

  const closeRemarkViewer = useCallback(() => {
    setRemarkViewer(null)
  }, [])

  useEffect(() => {
    if (!toast?.message) return undefined
    const t = window.setTimeout(() => setToast(null), 6500)
    return () => clearTimeout(t)
  }, [toast])

  const load = useCallback(() => {
    if (eventsOverride !== undefined) return
    if (!operationId) {
      setEvents([])
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    fetchActivityTimeline(operationId)
      .then(async (res) => {
        let list = Array.isArray(res?.events) ? res.events : []
        // Older API responses omitted `documents`; fill from the same source as Pre-Checking modals.
        const needDocFill = list.filter(
          (ev) => ev?.source === 'sub_process' && ev.subProcessKey && ev.phase && ev.documents === undefined
        )
        if (needDocFill.length > 0) {
          const filled = await Promise.all(
            needDocFill.map((ev) =>
              fetchSubProcessDocuments(operationId, ev.subProcessKey, ev.phase)
                .then((docs) => ({ id: ev.id, docs: Array.isArray(docs) ? docs : [] }))
                .catch(() => ({ id: ev.id, docs: [] }))
            )
          )
          const byEventId = new Map(filled.map((x) => [x.id, x.docs]))
          list = list.map((ev) => {
            if (!byEventId.has(ev.id)) return ev
            const docs = byEventId.get(ev.id)
            if (!docs.length) return { ...ev, documents: [] }
            return {
              ...ev,
              documents: docs.map((d) => ({
                id: d.id,
                name: d.name,
                url: d.url,
                mimeType: d.mimeType ?? null,
              })),
            }
          })
        }
        setEvents(list)
      })
      .catch((e) => {
        setEvents([])
        setError(e?.message || 'Failed to load activity timeline')
      })
      .finally(() => setLoading(false))
  }, [operationId, eventsOverride])

  useEffect(() => {
    if (eventsOverride !== undefined) return
    load()
  }, [load, refreshToken, eventsOverride])

  const sourceEvents = eventsOverride !== undefined ? eventsOverride : events
  const loadingState = loadingOverride !== undefined ? loadingOverride : loading
  const errorState = errorOverride !== undefined ? errorOverride : error

  const filteredEvents = useMemo(() => {
    if (!phaseFilter) return sourceEvents
    return sourceEvents.filter((ev) => String(ev?.phase || '') === phaseFilter)
  }, [sourceEvents, phaseFilter])

  const showPhaseColumn = !hidePhaseColumn
  const cardTitle = title || 'Detailed At-Berth Executions Log'
  const Wrapper = embedded ? 'div' : 'section'
  const wrapperClassName = embedded
    ? `operation-activity-timeline operation-activity-timeline--embedded ${className}`.trim()
    : `operation-activity-timeline berthing-modal__card ${className}`.trim()

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

  const [expandedCargoGroups, setExpandedCargoGroups] = useState(() => new Set())
  const cargoGroupsExpandedOnceRef = useRef(false)

  useEffect(() => {
    setExpandedCargoGroups(new Set())
    cargoGroupsExpandedOnceRef.current = false
  }, [operationId])

  useEffect(() => {
    if (!operationId || loadingState) return
    const items = buildTimelineDisplayItems(filteredEvents)
    const groupIds = items.filter((x) => x.kind === 'cargo_operations_group').map((x) => x.id)
    if (groupIds.length === 0) return
    if (!cargoGroupsExpandedOnceRef.current) {
      setExpandedCargoGroups(new Set(groupIds))
      cargoGroupsExpandedOnceRef.current = true
    }
  }, [operationId, loadingState, filteredEvents])

  const displayItems = useMemo(() => buildTimelineDisplayItems(filteredEvents), [filteredEvents])

  const toggleCargoGroup = useCallback((groupId) => {
    setExpandedCargoGroups((prev) => {
      const next = new Set(prev)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }, [])

  const renderDesktopEventRow = (ev, rowKey, nested) => {
    const { start, end, duration } = timelineRowSchedule(ev)
    const editPath = buildActivityLogEditPath(ev, { vesselId, basePath })
    const canDelete = activityLogRowCanDelete(ev)
    const busy = deletingId === ev.id
    const rowDocs = timelineDocuments(ev)
    return (
      <tr
        key={rowKey}
        className={nested ? 'operation-activity-timeline__row operation-activity-timeline__row--cargo-nested' : undefined}
      >
        {showPhaseColumn ? <td>{ev.phase || '—'}</td> : null}
        <td>{ev.title || '—'}</td>
        <td className="operation-activity-timeline__status">{timelineStatusDisplay(ev)}</td>
        <td className="operation-activity-timeline__remark">
          <TimelineRemarkCell ev={ev} t={t} onViewRemark={openRemarkViewer} />
        </td>
        <td className="operation-activity-timeline__documents">
          {rowDocs.length === 0 ? (
            <span className="text-steel">—</span>
          ) : (
            <ul className="operation-activity-timeline__doc-list">
              {rowDocs.map((d) => {
                const href = resolveUploadUrl(d.url)
                const mime = d.mimeType != null ? String(d.mimeType) : ''
                const isImage = mime.startsWith('image/')
                return (
                  <li key={d.id ?? `${ev.id}-${d.name}`}>
                    <FilePreviewLink
                      url={href}
                      name={d.name || `Document ${d.id}`}
                      mimeType={mime || null}
                      className="operation-activity-timeline__doc-link file-preview-link"
                      title={
                        isImage
                          ? 'Open image preview'
                          : 'Open document preview'
                      }
                    />
                  </li>
                )
              })}
            </ul>
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
  }

  const renderMobileEventCard = (ev, cardKey, nestedClass) => {
    const { start, end, duration } = timelineRowSchedule(ev)
    const editPath = buildActivityLogEditPath(ev, { vesselId, basePath })
    const canDelete = activityLogRowCanDelete(ev)
    const busy = deletingId === ev.id
    const rowDocs = timelineDocuments(ev)
    return (
      <article
        key={cardKey}
        className={`allocation-mobile-card${nestedClass ? ` ${nestedClass}` : ''}`}
      >
        <header className="allocation-mobile-card__header">
          <strong>{ev.title || '—'}</strong>
          {showPhaseColumn ? <span className="text-steel">{ev.phase || '—'}</span> : null}
        </header>
        <dl className="allocation-mobile-card__grid">
          <dt>Status</dt>
          <dd>{timelineStatusDisplay(ev)}</dd>
          <dt>Remark</dt>
          <dd className="operation-activity-timeline__remark">
            <TimelineRemarkCell ev={ev} t={t} onViewRemark={openRemarkViewer} />
          </dd>
          <dt>Documents</dt>
          <dd>
            {rowDocs.length === 0 ? (
              '—'
            ) : (
              <ul className="operation-activity-timeline__doc-list">
                {rowDocs.map((d) => {
                  const href = resolveUploadUrl(d.url)
                  const mime = d.mimeType != null ? String(d.mimeType) : ''
                  const isImage = mime.startsWith('image/')
                  return (
                    <li key={d.id ?? `${ev.id}-${d.name}`}>
                      <FilePreviewLink
                        url={href}
                        name={d.name || `Document ${d.id}`}
                        mimeType={mime || null}
                        className="operation-activity-timeline__doc-link file-preview-link"
                        title={
                          isImage
                            ? 'Open image preview'
                            : 'Open document preview'
                        }
                      />
                    </li>
                  )
                })}
              </ul>
            )}
          </dd>
          <dt>Start</dt>
          <dd>{start ? formatDateTimeDisplay(start) : '—'}</dd>
          <dt>End</dt>
          <dd>{end ? formatDateTimeDisplay(end) : '—'}</dd>
          <dt>Duration</dt>
          <dd>{duration}</dd>
        </dl>
        <div className="allocation-mobile-card__actions">
          {editPath ? (
            <button type="button" className="btn btn--small btn--ghost" onClick={() => handleEdit(ev)} disabled={busy}>
              Edit
            </button>
          ) : null}
          {canDelete ? (
            <button type="button" className="btn btn--small btn--danger-soft" onClick={() => handleDelete(ev)} disabled={busy}>
              {busy ? '…' : 'Delete'}
            </button>
          ) : null}
        </div>
      </article>
    )
  }

  if (!operationId) {
    return (
      <Wrapper className={wrapperClassName}>
        <h3 className="berthing-modal__card-title">{cardTitle}</h3>
        <p className="text-steel">Open an operation from At-Berth to see a saved timeline.</p>
      </Wrapper>
    )
  }

  return (
    <Wrapper className={wrapperClassName}>
      {!embedded ? <h3 className="berthing-modal__card-title">{cardTitle}</h3> : null}
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
      {loadingState && <p className="text-steel">Loading…</p>}
      {errorState && (
        <p className="text-steel" style={{ color: 'var(--danger-600, #c00)' }}>
          {errorState}
        </p>
      )}
      {!loadingState && !errorState && filteredEvents.length === 0 && (
        <p className="text-steel">No recorded activities yet for this operation.</p>
      )}
      {!loadingState && !errorState && filteredEvents.length > 0 && (
        <>
          <div className="operation-activity-timeline__table-wrap operation-activity-timeline__desktop">
            <table className="loading-detail-activity-table operation-activity-timeline__table">
              <thead>
                <tr>
                  {showPhaseColumn ? <th>Phase</th> : null}
                  <th>Title</th>
                  <th>Status</th>
                  <th>Remark</th>
                  <th>Documents</th>
                  <th className="operation-activity-timeline__time">Start time</th>
                  <th className="operation-activity-timeline__time">End time</th>
                  <th className="operation-activity-timeline__time">Duration</th>
                  <th className="operation-activity-timeline__actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {displayItems.map((item) => {
                  if (item.kind === 'row') {
                    return renderDesktopEventRow(item.ev, item.ev.id, false)
                  }
                  const expanded = expandedCargoGroups.has(item.id)
                  const { start, end, duration } = cargoGroupScheduleRange(item.events)
                  const groupStatus = aggregateCargoGroupStatus(item.events)
                  const phaseLabel = item.events[0]?.phase || '—'
                  return (
                    <Fragment key={item.id}>
                      <tr className="operation-activity-timeline__row operation-activity-timeline__row--cargo-group">
                        {showPhaseColumn ? <td>{phaseLabel}</td> : null}
                        <td>
                          <button
                            type="button"
                            className="operation-activity-timeline__group-toggle"
                            onClick={() => toggleCargoGroup(item.id)}
                            aria-expanded={expanded}
                            aria-controls={`${item.id}-cargo-children`}
                            id={`${item.id}-cargo-head`}
                            title={expanded ? t('executionsLogCargoGroupCollapse') : t('executionsLogCargoGroupExpand')}
                          >
                            <span className="operation-activity-timeline__group-chevron" aria-hidden>
                              {expanded ? '▼' : '▶'}
                            </span>
                            <span className="operation-activity-timeline__group-title-text">
                              {t('executionsLogCargoGroupTitle', { count: item.events.length })}
                            </span>
                          </button>
                        </td>
                        <td className="operation-activity-timeline__status">{groupStatus}</td>
                        <td className="operation-activity-timeline__remark">
                          <CargoGroupRemarkCell events={item.events} t={t} onViewRemark={openRemarkViewer} />
                        </td>
                        <td className="operation-activity-timeline__documents">
                          <span className="text-steel">—</span>
                        </td>
                        <td className="operation-activity-timeline__time">{start ? formatDateTimeDisplay(start) : '—'}</td>
                        <td className="operation-activity-timeline__time">{end ? formatDateTimeDisplay(end) : '—'}</td>
                        <td className="operation-activity-timeline__time">{duration}</td>
                        <td className="operation-activity-timeline__actions">
                          <div className="operation-activity-timeline__action-btns">
                            {item.events.map((ev) => {
                              const editPath = buildActivityLogEditPath(ev, { vesselId, basePath })
                              const canDelete = activityLogRowCanDelete(ev)
                              const busy = deletingId === ev.id
                              const entryNum = item.events.indexOf(ev) + 1
                              const label = item.events.length > 1 ? ` #${entryNum}` : ''
                              return (
                                <Fragment key={`hdr-act-${ev.id}`}>
                                  {editPath ? (
                                    <button
                                      type="button"
                                      className="btn btn--small btn--ghost"
                                      onClick={() => handleEdit(ev)}
                                      disabled={busy}
                                      title={`Edit entry${label}`}
                                    >
                                      {`Edit${label}`}
                                    </button>
                                  ) : null}
                                  {canDelete ? (
                                    <button
                                      type="button"
                                      className="btn btn--small btn--danger-soft"
                                      onClick={() => handleDelete(ev)}
                                      disabled={busy}
                                      title={`Delete entry${label}`}
                                    >
                                      {busy ? '…' : `Delete${label}`}
                                    </button>
                                  ) : null}
                                </Fragment>
                              )
                            })}
                          </div>
                        </td>
                      </tr>
                      {expanded ? (() => {
                        let cumQty = 0
                        let globalLineIdx = 0
                        const siQty = Number.isFinite(Number(cargoSiQty)) ? Number(cargoSiQty) : null
                        const metricSuffix = cargoSiMetricLabel ? ` ${cargoSiMetricLabel}` : ''
                        return (
                          <tr id={`${item.id}-cargo-children`} className="operation-activity-timeline__row operation-activity-timeline__row--cargo-children-wrap">
                            <td colSpan={showPhaseColumn ? 9 : 8} className="operation-activity-timeline__cargo-children-cell">
                              <div
                                className="operation-activity-timeline__cargo-children"
                                role="region"
                                aria-labelledby={`${item.id}-cargo-head`}
                              >
                                <table className="operation-activity-timeline__nested-table">
                                  <thead>
                                    <tr>
                                      <th>Entry</th>
                                      <th className="operation-activity-timeline__time">QTY Load</th>
                                      <th className="operation-activity-timeline__time">Start</th>
                                      <th className="operation-activity-timeline__time">End</th>
                                      <th className="operation-activity-timeline__time">Rate (/h)</th>
                                      <th className="operation-activity-timeline__time">Balance</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {item.events.flatMap((ev) => {
                                      const lines = Array.isArray(ev.cargoLoadLines) && ev.cargoLoadLines.length > 0
                                        ? ev.cargoLoadLines
                                        : [{ lineOrder: null, qty: Number.isFinite(Number(ev.cargoMovedQty)) ? Number(ev.cargoMovedQty) : null, startedAt: ev.startAt ?? null, endedAt: ev.endAt ?? ev.cargoLastLineEndedAt ?? null }]
                                      return lines.map((line, lineIdx) => {
                                        const qty = Number.isFinite(Number(line.qty)) ? Number(line.qty) : null
                                        cumQty += qty ?? 0
                                        const balance = siQty != null ? siQty - cumQty : null
                                        let rate = null
                                        if (qty != null && line.startedAt && line.endedAt) {
                                          const ms = new Date(line.endedAt).getTime() - new Date(line.startedAt).getTime()
                                          const hours = ms / 3600000
                                          if (hours > 1e-9) rate = qty / hours
                                        }
                                        const entryNum = ++globalLineIdx
                                        const rowKey = `${item.id}-nested-${ev.id}-line-${lineIdx}`
                                        return (
                                          <tr key={rowKey}>
                                            <td>Entry {entryNum}</td>
                                            <td className="operation-activity-timeline__time">
                                              {qty != null ? `${qty.toLocaleString(undefined, { maximumFractionDigits: 6 })}${metricSuffix}` : '—'}
                                            </td>
                                            <td className="operation-activity-timeline__time">{line.startedAt ? formatDateTimeDisplay(line.startedAt) : '—'}</td>
                                            <td className="operation-activity-timeline__time">{line.endedAt ? formatDateTimeDisplay(line.endedAt) : '—'}</td>
                                            <td className="operation-activity-timeline__time">
                                              {rate != null ? `${rate.toLocaleString(undefined, { maximumFractionDigits: 2 })}${metricSuffix}` : '—'}
                                            </td>
                                            <td className="operation-activity-timeline__time">
                                              {balance != null ? `${balance.toLocaleString(undefined, { maximumFractionDigits: 6 })}${metricSuffix}` : '—'}
                                            </td>
                                          </tr>
                                        )
                                      })
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        )
                      })() : null}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="allocation-mobile-cards operation-activity-timeline__mobile">
            {displayItems.map((item) => {
              if (item.kind === 'row') {
                return renderMobileEventCard(item.ev, `mobile-${item.ev.id}`, '')
              }
              const expanded = expandedCargoGroups.has(item.id)
              const { start, end, duration } = cargoGroupScheduleRange(item.events)
              const groupStatus = aggregateCargoGroupStatus(item.events)
              return (
                <article
                  key={`mobile-${item.id}`}
                  className="allocation-mobile-card operation-activity-timeline__mobile-card--cargo-group"
                >
                  <header className="allocation-mobile-card__header">
                    <button
                      type="button"
                      className="operation-activity-timeline__group-toggle operation-activity-timeline__group-toggle--mobile"
                      onClick={() => toggleCargoGroup(item.id)}
                      aria-expanded={expanded}
                      aria-controls={`${item.id}-mobile-cargo-children`}
                      id={`${item.id}-mobile-cargo-head`}
                      title={expanded ? t('executionsLogCargoGroupCollapse') : t('executionsLogCargoGroupExpand')}
                    >
                      <span className="operation-activity-timeline__group-chevron" aria-hidden>
                        {expanded ? '▼' : '▶'}
                      </span>
                      <strong>{t('executionsLogCargoGroupTitle', { count: item.events.length })}</strong>
                    </button>
                    {showPhaseColumn ? <span className="text-steel">{item.events[0]?.phase || '—'}</span> : null}
                  </header>
                  <dl className="allocation-mobile-card__grid">
                    <dt>Status</dt>
                    <dd>{groupStatus}</dd>
                    <dt>Remark</dt>
                    <dd className="operation-activity-timeline__remark">
                      <CargoGroupRemarkCell events={item.events} t={t} onViewRemark={openRemarkViewer} />
                    </dd>
                    <dt>Documents</dt>
                    <dd>—</dd>
                    <dt>Start</dt>
                    <dd>{start ? formatDateTimeDisplay(start) : '—'}</dd>
                    <dt>End</dt>
                    <dd>{end ? formatDateTimeDisplay(end) : '—'}</dd>
                    <dt>Duration</dt>
                    <dd>{duration}</dd>
                  </dl>
                  <div className="allocation-mobile-card__actions" />
                  {expanded ? (
                    <div
                      id={`${item.id}-mobile-cargo-children`}
                      className="operation-activity-timeline__mobile-cargo-children"
                      role="region"
                      aria-labelledby={`${item.id}-mobile-cargo-head`}
                    >
                      {item.events.map((ev) =>
                        renderMobileEventCard(
                          ev,
                          `mobile-${item.id}-${ev.id}`,
                          'operation-activity-timeline__mobile-card--nested'
                        )
                      )}
                    </div>
                  ) : null}
                </article>
              )
            })}
          </div>
        </>
      )}
      <RemarkViewerModal viewer={remarkViewer} onClose={closeRemarkViewer} />
    </Wrapper>
  )
}
