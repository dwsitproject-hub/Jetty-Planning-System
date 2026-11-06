import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { formatRelativeTime, formatWhen } from '../../utils/adminOpsDisplay'
import { formatGapDuration, isGapOpen, resyncOutcomeVariant } from '../../utils/atgGapDisplay'
import AtgGapHistory from './AtgGapHistory.jsx'

function LastResync({ last, t }) {
  if (!last) return <span className="text-steel">{t('atgGapNeverResynced')}</span>
  return (
    <span>
      <span className={`atg-gap-pill atg-gap-pill--${resyncOutcomeVariant(last.outcome)}`}>
        {t(`atgGapOutcome_${last.outcome}`, last.outcome ?? '')}
      </span>{' '}
      <span className="text-steel">
        {t('atgGapLastResync', {
          samples: last.samplesInserted,
          before: last.gapsBefore,
          after: last.gapsAfter,
          by: last.by ?? '—',
          when: formatRelativeTime(last.at),
        })}
      </span>
    </span>
  )
}

function GapStatus({ gap, t }) {
  const ack = gap.acknowledgement
  if (!ack) return <span className="atg-gap-pill atg-gap-pill--error">{t('atgGapStatusOpen')}</span>
  return (
    <span title={`${ack.acknowledgedBy ?? '—'} · ${formatWhen(ack.acknowledgedAt)}`}>
      <span className="atg-gap-pill atg-gap-pill--neutral">{t('atgGapStatusAcknowledged')}</span>
      <div className="text-steel atg-gap-dialog__sub">{ack.reason}</div>
    </span>
  )
}

export default function AtgGapOperationCard({ op, canEdit, defaultOpen, historyRefreshKey, onResync, onAcknowledge, onReopen, onViewJob, t }) {
  const [open, setOpen] = useState(defaultOpen)
  const [showHistory, setShowHistory] = useState(false)
  const openGapKeys = useMemo(() => op.gaps.filter(isGapOpen).map((g) => g.gapKey), [op.gaps])
  const [selected, setSelected] = useState(() => new Set(openGapKeys))

  useEffect(() => setSelected(new Set(openGapKeys)), [openGapKeys])

  const selectedGaps = op.gaps.filter((g) => selected.has(g.gapKey))
  const selectedOpen = selectedGaps.filter(isGapOpen)
  const selectedAcked = selectedGaps.filter((g) => !isGapOpen(g))
  const allSelected = op.gaps.length > 0 && selected.size === op.gaps.length

  function toggle(key) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <article className={`atg-gap-op ${op.openGapCount ? 'atg-gap-op--open' : 'atg-gap-op--closed'}`}>
      <button type="button" className="atg-gap-op__header" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="atg-gap-op__chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
        <span className="atg-gap-op__title">
          <strong>{op.vesselName}</strong>
          <span className="text-steel"> · {op.planRef ?? '—'} · {op.portName}</span>
        </span>
        <span className="atg-gap-op__badges">
          <span className={`atg-gap-pill atg-gap-pill--${op.atBerth ? 'info' : 'neutral'}`}>
            {op.atBerth ? t('atgGapAtBerth') : t('atgGapCompleted')}
          </span>
          {op.activeJob ? (
            <span className="atg-gap-pill atg-gap-pill--info">
              {t('atgGapJobRunning', { kind: t(`atgGapJobKind_${op.activeJob.kind}`) })}
            </span>
          ) : null}
          {op.openGapCount ? (
            <span className="atg-gap-pill atg-gap-pill--error">{t('atgGapOpenCount', { count: op.openGapCount })}</span>
          ) : null}
          {op.acknowledgedGapCount ? (
            <span className="atg-gap-pill atg-gap-pill--neutral">{t('atgGapAckCount', { count: op.acknowledgedGapCount })}</span>
          ) : null}
          <span className="text-steel">{t('atgGapLongest', { duration: formatGapDuration(op.longestGapMinutes) })}</span>
        </span>
      </button>
      <div className="atg-gap-op__last">
        <LastResync last={op.lastResync} t={t} />
      </div>

      {open ? (
        <div className="atg-gap-op__body">
          <div className="admin-ops-detail-table-wrap">
            <table className="data-table atg-gap-op__table">
              <thead>
                <tr>
                  <th className="atg-gap-op__check">
                    <input
                      type="checkbox"
                      aria-label={t('atgGapSelectAll')}
                      checked={allSelected}
                      onChange={() => setSelected(allSelected ? new Set() : new Set(op.gaps.map((g) => g.gapKey)))}
                    />
                  </th>
                  <th>{t('atgGapColWindow')}</th>
                  <th>{t('atgGapColDuration')}</th>
                  <th>{t('atgGapColCommodity')}</th>
                  <th>{t('atgGapColTanks')}</th>
                  <th>{t('atgGapColStatus')}</th>
                </tr>
              </thead>
              <tbody>
                {op.gaps.map((g) => (
                  <tr key={g.gapKey} className={isGapOpen(g) ? '' : 'atg-gap-op__row--acked'}>
                    <td className="atg-gap-op__check">
                      <input type="checkbox" checked={selected.has(g.gapKey)} onChange={() => toggle(g.gapKey)} />
                    </td>
                    <td>{formatWhen(g.startAt)} → {formatWhen(g.endAt)}</td>
                    <td>{formatGapDuration(g.durationMinutes)}</td>
                    <td>{g.commodity ?? '—'}</td>
                    <td>{(g.tankCodes ?? []).join(', ') || '—'}</td>
                    <td><GapStatus gap={g} t={t} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="atg-gap-op__actions">
            {op.activeJob ? (
              <button type="button" className="btn btn--primary btn--sm" onClick={() => onViewJob(op)}>
                {t('atgGapViewProgress')}
              </button>
            ) : null}
            {canEdit && !op.activeJob ? (
              <>
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  disabled={!selectedOpen.length}
                  onClick={() => onResync(op, selectedOpen)}
                >
                  {t('atgGapActionResync', { count: selectedOpen.length })}
                </button>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  disabled={!selectedOpen.length}
                  onClick={() => onAcknowledge(op, selectedOpen.map((g) => g.gapKey))}
                >
                  {t('atgGapActionAck', { count: selectedOpen.length })}
                </button>
                {selectedAcked.length ? (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => onReopen(op, selectedAcked.map((g) => g.gapKey))}
                  >
                    {t('atgGapActionReopen', { count: selectedAcked.length })}
                  </button>
                ) : null}
              </>
            ) : op.activeJob ? null : (
              <span className="admin-ops-card__guidance">{t('atgGapNeedEdit')}</span>
            )}
            <Link to={`/loading/operation/${op.operationId}`} className="link">
              {t('atgGapOpenOperation')}
            </Link>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowHistory((v) => !v)}>
              {showHistory ? t('atgGapHideHistory') : t('atgGapShowHistory')}
            </button>
          </div>

          {showHistory ? <AtgGapHistory operationId={op.operationId} refreshKey={historyRefreshKey} t={t} /> : null}
        </div>
      ) : null}
    </article>
  )
}
