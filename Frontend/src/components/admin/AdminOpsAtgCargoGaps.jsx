import { useMemo, useRef, useState } from 'react'
import { reopenAtgCargoGaps } from '../../api/adminOps'
import AtgGapOperationCard from './AtgGapOperationCard.jsx'
import AtgGapResyncDialog from './AtgGapResyncDialog.jsx'
import AtgGapAckDialog from './AtgGapAckDialog.jsx'

const FILTERS = ['open', 'acknowledged', 'all']

function matchesFilter(op, filter) {
  if (filter === 'open') return op.openGapCount > 0
  if (filter === 'acknowledged') return op.openGapCount === 0
  return true
}

function Tile({ value, label, tone }) {
  return (
    <div className={`atg-gap-tile atg-gap-tile--${value ? tone : 'none'}`}>
      <span className="atg-gap-tile__value">{value}</span>
      <span className="atg-gap-tile__label">{label}</span>
    </div>
  )
}

/**
 * ATG cargo gap workspace on System Health: triage, preview + resync, acknowledge, audit history.
 */
export function AtgCargoGapsDetail({ details, t, canResync, onGapsChanged }) {
  const operations = useMemo(() => details?.operations ?? [], [details])
  const [filter, setFilter] = useState('open')
  const [query, setQuery] = useState('')
  const [dialog, setDialog] = useState(null)
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0)
  const [actionError, setActionError] = useState(null)
  const changedRef = useRef(false)

  const counts = useMemo(
    () => ({
      open: operations.filter((op) => matchesFilter(op, 'open')).length,
      acknowledged: operations.filter((op) => matchesFilter(op, 'acknowledged')).length,
      all: operations.length,
    }),
    [operations]
  )

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return operations.filter(
      (op) =>
        matchesFilter(op, filter) &&
        (!q || `${op.vesselName} ${op.planRef ?? ''} ${op.portName}`.toLowerCase().includes(q))
    )
  }, [operations, filter, query])

  function finishDialog(changed) {
    setDialog(null)
    if (changed || changedRef.current) {
      changedRef.current = false
      setHistoryRefreshKey((k) => k + 1)
      onGapsChanged?.()
    }
  }

  /** Reopen the dialog on a job that is still running on the server. */
  function viewJob(op) {
    const job = op.activeJob
    const chosen = op.gaps.filter((g) => job.gapKeys?.includes(g.gapKey))
    setDialog({ type: 'resync', op, gaps: chosen.length ? chosen : op.gaps.filter((g) => !g.acknowledgement), resumeJob: job })
  }

  async function reopen(op, gapKeys) {
    if (!window.confirm(t('atgGapReopenConfirm', { count: gapKeys.length }))) return
    setActionError(null)
    try {
      await reopenAtgCargoGaps(op.operationId, gapKeys)
      finishDialog(true)
    } catch (e) {
      setActionError(e?.message || t('atgGapReopenFailed'))
    }
  }

  if (!operations.length) {
    return <p className="text-steel admin-ops-detail__empty">{t('atgGapNone', { days: details?.lookbackDays ?? 30 })}</p>
  }

  const recentHours = Math.round((details?.recentWindowMinutes ?? 360) / 60)

  return (
    <div className="atg-gap-workspace">
      <div className="atg-gap-tiles">
        <Tile value={details?.liveWithRecentGap ?? 0} label={t('atgGapTileLiveRecent', { hours: recentHours })} tone="error" />
        <Tile value={details?.liveWithOlderGap ?? 0} label={t('atgGapTileLiveOlder')} tone="warning" />
        <Tile value={details?.completedWithGaps ?? 0} label={t('atgGapTileCompleted')} tone="warning" />
        <Tile value={counts.acknowledged} label={t('atgGapTileAcknowledged')} tone="neutral" />
      </div>
      <p className="text-steel atg-gap-workspace__rule">
        {t('atgGapRule', { hours: recentHours, min: details?.minGapMinutes ?? 30, days: details?.lookbackDays ?? 30 })}
      </p>

      <div className="atg-gap-toolbar">
        <div className="atg-gap-filters" role="tablist">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={filter === f}
              className={`atg-gap-filter${filter === f ? ' is-active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {t(`atgGapFilter_${f}`)} <span className="atg-gap-filter__count">{counts[f]}</span>
            </button>
          ))}
        </div>
        <input
          type="search"
          className="atg-gap-search"
          placeholder={t('atgGapSearch')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {actionError ? <p className="admin-ops-error">{actionError}</p> : null}
      {!visible.length ? <p className="text-steel">{t('atgGapNoneInFilter')}</p> : null}

      <div className="atg-gap-list">
        {visible.map((op, i) => (
          <AtgGapOperationCard
            key={op.operationId}
            op={op}
            canEdit={canResync}
            defaultOpen={i === 0 && op.openGapCount > 0}
            historyRefreshKey={historyRefreshKey}
            onResync={(o, gaps) => setDialog({ type: 'resync', op: o, gaps })}
            onAcknowledge={(o, gapKeys) => setDialog({ type: 'ack', op: o, gapKeys })}
            onReopen={reopen}
            onViewJob={viewJob}
            t={t}
          />
        ))}
      </div>
      {details?.truncated ? <p className="text-steel">{t('atgGapTruncated')}</p> : null}

      {dialog?.type === 'resync' ? (
        <AtgGapResyncDialog
          operation={dialog.op}
          gaps={dialog.gaps}
          resumeJob={dialog.resumeJob ?? null}
          onClose={finishDialog}
          onAcknowledgeRemaining={(gapKeys) => {
            changedRef.current = true
            setDialog({ type: 'ack', op: dialog.op, gapKeys })
          }}
          t={t}
        />
      ) : null}
      {dialog?.type === 'ack' ? (
        <AtgGapAckDialog operation={dialog.op} gapKeys={dialog.gapKeys} onClose={finishDialog} t={t} />
      ) : null}
    </div>
  )
}
