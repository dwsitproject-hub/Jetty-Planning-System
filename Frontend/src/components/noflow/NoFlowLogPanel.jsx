import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatDateTimeDisplay } from '../../utils/formatDateTimeDisplay.js'
import { getScheduleEntryTimeZone } from '../../utils/scheduleDateTime.js'
import { buildStripSegments, formatStopDuration, mergeStops, reasonName } from '../../utils/noFlowDisplay.js'
import NoFlowReasonModal from './NoFlowReasonModal.jsx'
import NoFlowStopCards from './NoFlowStopCards.jsx'
import { useNoFlowLog } from './useNoFlowLog.js'
import '../../styles/no-flow.css'

/** Self-loading no-flow log for desktop pages (table layout). */
export default function NoFlowLogPanel({ operationId, scheduleTimezone, readOnly = false }) {
  const log = useNoFlowLog(operationId, { readOnly })
  return <NoFlowLogView operationId={operationId} log={log} scheduleTimezone={scheduleTimezone} />
}

function StopTable({ stops, readOnly, onEdit, onRemove, onClose }) {
  const { t, i18n } = useTranslation('pages')
  return (
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
              <td>{formatDateTimeDisplay(s.startedAt)} – {s.endedAt ? formatDateTimeDisplay(s.endedAt) : <span className="no-flow__pill no-flow__pill--live">{t('noFlowInProgress')}</span>}</td>
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
                      {s.isOpen ? (
                        <button type="button" className="btn btn--small btn--primary" onClick={() => onClose(s)}>{t('noFlowFlowResumed')}</button>
                      ) : null}
                      <button type="button" className="btn btn--small btn--secondary" onClick={() => onEdit(s)}>{t('noFlowEdit')}</button>
                      <button type="button" className="btn btn--small btn--secondary" onClick={() => onRemove(s)}>{t('noFlowDelete')}</button>
                    </>
                  ) : (
                    <button type="button" className="btn btn--small btn--primary" onClick={() => onEdit(s)}>{t('noFlowAddReason')}</button>
                  )}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * No-flow log view: flow strip, stop list and the add / edit form.
 * `layout="cards"` renders the phone layout used in operator mode.
 */
export function NoFlowLogView({ operationId, log, scheduleTimezone, layout = 'table' }) {
  const { t } = useTranslation('pages')
  const tz = scheduleTimezone || getScheduleEntryTimeZone()
  const [editing, setEditing] = useState(null)
  const { summary, reasons, error, load, remove, close, readOnly } = log

  if (error) return <p className="no-flow__error">{error}</p>
  if (!summary) return <p className="text-steel">{t('noFlowLoading')}</p>
  const stops = mergeStops(summary)
  const { unexplainedCount, unexplainedMinutes } = summary.totals
  const List = layout === 'cards' ? NoFlowStopCards : StopTable

  return (
    <section className={`no-flow no-flow--${layout}`}>
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
          <button type="button" className="btn btn--secondary btn--small no-flow__add" onClick={() => setEditing({ kind: 'manual', source: 'manual' })}>
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

      {stops.length > 0 ? <List stops={stops} readOnly={readOnly} onEdit={setEditing} onRemove={remove} onClose={close} /> : null}
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
