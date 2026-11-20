import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatDateTimeDisplay } from '../../utils/formatDateTimeDisplay.js'
import { formatStopDuration, reasonName } from '../../utils/noFlowDisplay.js'

const NUDGE_PICKS = 3

function useMinutesSince(iso) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30000)
    return () => window.clearInterval(id)
  }, [])
  return iso ? Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000)) : 0
}

/**
 * Top-of-screen banner in operator mode: the open stop with a running timer, or the ATG
 * nudge ("no flow since …") with one-tap reasons.
 */
export default function OperatorNoFlowBanner({ openStop, nudge, reasons, cargoActive, canEdit, busy, onResume, onChangeReason, onQuickPick, onMore }) {
  const { t, i18n } = useTranslation('operator')
  const minutes = useMinutesSince(openStop?.startedAt || nudge?.flatSince)

  if (openStop) {
    return (
      <section className="operator-noflow operator-noflow--open" role="status">
        <div className="operator-noflow__title">
          {t('noFlow.openTitle', { reason: reasonName(openStop, i18n.language) })}
        </div>
        <div className="operator-noflow__meta">
          {t('noFlow.since', { time: formatDateTimeDisplay(openStop.startedAt) })} ·{' '}
          <strong>{formatStopDuration(minutes)}</strong>
        </div>
        {canEdit ? (
          <div className="operator-noflow__actions">
            {cargoActive ? (
              <button type="button" className="op-btn op-btn--primary" disabled={busy} onClick={onResume}>
                {t('noFlow.flowResumed')}
              </button>
            ) : (
              <p className="operator-noflow__hint">{t('noFlow.closesOnStart')}</p>
            )}
            <button type="button" className="op-btn op-btn--soft" disabled={busy} onClick={onChangeReason}>
              {t('noFlow.changeReason')}
            </button>
          </div>
        ) : null}
      </section>
    )
  }

  if (!nudge) return null
  return (
    <section className="operator-noflow operator-noflow--nudge" role="alert">
      <div className="operator-noflow__title">{t('noFlow.nudgeTitle', { tanks: nudge.tankCodes || '—' })}</div>
      <div className="operator-noflow__meta">
        {t('noFlow.nudgeMeta', { time: formatDateTimeDisplay(nudge.flatSince), duration: formatStopDuration(minutes) })}
      </div>
      {canEdit ? (
        <div className="operator-stop-sheet__chips">
          {reasons.slice(0, NUDGE_PICKS).map((r) => (
            <button key={r.id} type="button" className="operator-stop-chip" disabled={busy} onClick={() => onQuickPick(r.id)}>
              {reasonName(r, i18n.language)}
            </button>
          ))}
          <button type="button" className="operator-stop-chip" disabled={busy} onClick={onMore}>
            {t('noFlow.more')}
          </button>
        </div>
      ) : null}
    </section>
  )
}
