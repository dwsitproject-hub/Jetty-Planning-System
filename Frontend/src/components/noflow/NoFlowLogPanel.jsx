import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { deleteNoFlowEvent, fetchNoFlow, fetchNoFlowReasonOptions } from '../../api/noFlow'
import { formatDateTimeDisplay } from '../../utils/formatDateTimeDisplay.js'
import { getScheduleEntryTimeZone } from '../../utils/scheduleDateTime.js'
import { buildStripSegments, formatStopDuration, mergeStops, reasonName } from '../../utils/noFlowDisplay.js'
import NoFlowReasonModal from './NoFlowReasonModal.jsx'
import '../../styles/no-flow.css'

/**
 * No-flow log of one voyage: flow strip, stop list (recorded + needs reason) and the
 * add / edit form. `readOnly` hides the actions (e.g. sailed voyages).
 */
export default function NoFlowLogPanel({ operationId, scheduleTimezone, readOnly = false }) {
  const { t, i18n } = useTranslation('pages')
  const tz = scheduleTimezone || getScheduleEntryTimeZone()
  const [summary, setSummary] = useState(null)
  const [reasons, setReasons] = useState([])
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null)

  const load = useCallback(async () => {
    try {
      setError('')
      setSummary(await fetchNoFlow(operationId))
    } catch (e) {
      setError(e?.message || t('noFlowLoadFailed'))
    }
  }, [operationId, t])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (readOnly) return
    fetchNoFlowReasonOptions().then(setReasons).catch(() => setReasons([]))
  }, [readOnly])

  const remove = async (stop) => {
    if (!window.confirm(t('noFlowDeleteConfirm'))) return
    try {
      await deleteNoFlowEvent(operationId, stop.id)
      load()
    } catch (e) {
      setError(e?.message || t('noFlowSaveFailed'))
    }
  }

  if (error) return <p className="no-flow__error">{error}</p>
  if (!summary) return <p className="text-steel">{t('noFlowLoading')}</p>
  const stops = mergeStops(summary)
  const { unexplainedCount, unexplainedMinutes } = summary.totals

  return (
    <section className="no-flow">
      <div className="no-flow__head">
        <h4 className="no-flow__title">{t('noFlowTitle')}</h4>
        {unexplainedCount > 0 ? (
          <span className="no-flow__pill no-flow__pill--warn">
            {t('noFlowNeedsReasonCount', { count: unexplainedCount, duration: formatStopDuration(unexplainedMinutes) })}
          </span>
        ) : (
          <span className="no-flow__pill no-flow__pill--ok">{t('noFlowAllExplained')}</span>
        )}
        {!readOnly ? (
          <button type="button" className="btn btn--secondary btn--small" onClick={() => setEditing({ kind: 'manual', source: 'manual' })}>
            {t('noFlowAddManual')}
          </button>
        ) : null}
      </div>

      {summary.window ? (
        <>
          <div className="no-flow__strip" role="img" aria-label={t('noFlowStripAria')}>
            {buildStripSegments(summary).map((s, i) => (
              <span
                key={i}
                className={`no-flow__seg no-flow__seg--${s.kind}`}
                style={{ left: `${s.leftPct}%`, width: `${s.widthPct}%` }}
                title={s.stop ? `${formatDateTimeDisplay(s.stop.startedAt)} – ${formatDateTimeDisplay(s.stop.endedAt)}` : t('noFlowLegendFlow')}
              />
            ))}
          </div>
          <div className="no-flow__axis">
            <span>{formatDateTimeDisplay(summary.window.startedAt)}</span>
            <span>{summary.window.isOpen ? t('noFlowNow') : formatDateTimeDisplay(summary.window.endedAt)}</span>
          </div>
          <div className="no-flow__legend">
            <span><i className="no-flow__dot no-flow__dot--flow" />{t('noFlowLegendFlow')}</span>
            <span><i className="no-flow__dot no-flow__dot--unexplained" />{t('noFlowLegendNeedsReason')}</span>
            <span><i className="no-flow__dot no-flow__dot--event" />{t('noFlowLegendExplained')}</span>
          </div>
        </>
      ) : (
        <p className="text-steel">{t('noFlowNoEntries')}</p>
      )}

      {stops.length > 0 ? (
        <div className="table-wrap">
          <table className="data-table no-flow__table">
            <thead>
              <tr>
                <th>{t('noFlowColTime')}</th>
                <th>{t('noFlowColDuration')}</th>
                <th>{t('noFlowColFoundBy')}</th>
                <th>{t('noFlowColReason')}</th>
                {!readOnly ? <th aria-label={t('noFlowColActions')} /> : null}
              </tr>
            </thead>
            <tbody>
              {stops.map((s) => (
                <tr key={s.key}>
                  <td>{formatDateTimeDisplay(s.startedAt)} – {formatDateTimeDisplay(s.endedAt)}</td>
                  <td>{formatStopDuration(s.minutes)}</td>
                  <td><span className="no-flow__pill">{t(`noFlowSourceShort_${s.source}`)}</span></td>
                  <td>
                    {s.kind === 'event' ? (
                      <>
                        {reasonName(s, i18n.language)}
                        {s.note ? <div className="text-steel no-flow__note">{s.note}</div> : null}
                      </>
                    ) : (
                      <span className="no-flow__pill no-flow__pill--warn">{t('noFlowNeedsReason')}</span>
                    )}
                  </td>
                  {!readOnly ? (
                    <td className="no-flow__actions">
                      {s.kind === 'event' ? (
                        <>
                          <button type="button" className="btn btn--small btn--secondary" onClick={() => setEditing(s)}>{t('noFlowEdit')}</button>
                          <button type="button" className="btn btn--small btn--secondary" onClick={() => remove(s)}>{t('noFlowDelete')}</button>
                        </>
                      ) : (
                        <button type="button" className="btn btn--small btn--primary" onClick={() => setEditing(s)}>{t('noFlowAddReason')}</button>
                      )}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <p className="text-steel no-flow__hint">{t('noFlowMinHint', { minutes: summary.minMinutes })}</p>

      {editing ? (
        <NoFlowReasonModal
          operationId={operationId}
          stop={editing}
          reasons={reasons}
          tz={tz}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            load()
          }}
        />
      ) : null}
    </section>
  )
}
