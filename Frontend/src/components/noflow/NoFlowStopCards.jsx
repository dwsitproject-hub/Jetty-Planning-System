import { useTranslation } from 'react-i18next'
import { formatDateTimeDisplay } from '../../utils/formatDateTimeDisplay.js'
import { formatStopDuration, reasonName } from '../../utils/noFlowDisplay.js'
import StopPhasePill from './StopPhasePill.jsx'

/** Phone layout of the stop list: one card per stop with a full-width action. */
export default function NoFlowStopCards({ stops, readOnly, onEdit, onRemove, onClose }) {
  const { t, i18n } = useTranslation('pages')
  return (
    <ul className="no-flow-cards">
      {stops.map((s) => {
        const needsReason = s.kind !== 'event'
        return (
          <li key={s.key} className={`no-flow-card${needsReason ? ' no-flow-card--warn' : ''}`}>
            <div className="no-flow-card__top">
              <span>
                <strong>{formatStopDuration(s.minutes)}</strong>
                <StopPhasePill phase={s.phase} />
              </span>
              <span className="no-flow__pill">{t(`noFlowSourceShort_${s.source}`)}</span>
            </div>
            <div className="no-flow-card__time">
              {formatDateTimeDisplay(s.startedAt)} – {s.endedAt ? formatDateTimeDisplay(s.endedAt) : t('noFlowInProgress')}
            </div>
            <div className="no-flow-card__reason">
              {needsReason ? (
                <span className="no-flow__pill no-flow__pill--warn">{t('noFlowNeedsReason')}</span>
              ) : (
                <>
                  {reasonName(s, i18n.language)}
                  {s.note ? <div className="text-steel no-flow__note">{s.note}</div> : null}
                </>
              )}
            </div>
            {!readOnly ? (
              <div className="no-flow-card__actions">
                {needsReason ? (
                  <button type="button" className="btn btn--primary no-flow-card__btn" onClick={() => onEdit(s)}>
                    {t('noFlowAddReason')}
                  </button>
                ) : (
                  <>
                    {s.isOpen ? (
                      <button type="button" className="btn btn--primary no-flow-card__btn" onClick={() => onClose(s)}>
                        {t('noFlowFlowResumed')}
                      </button>
                    ) : null}
                    <button type="button" className="btn btn--secondary no-flow-card__btn" onClick={() => onEdit(s)}>
                      {t('noFlowEdit')}
                    </button>
                    <button type="button" className="btn btn--secondary no-flow-card__btn" onClick={() => onRemove(s)}>
                      {t('noFlowDelete')}
                    </button>
                  </>
                )}
              </div>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
