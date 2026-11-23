import { useTranslation } from 'react-i18next'
import { formatDateTimeDisplay } from '../utils/formatDateTimeDisplay'
import { buildStopMarks, stopMarkTitle } from '../utils/ganttStopMarks'

/**
 * Red striped marks for the recorded stops of a voyage, drawn inside its actual Gantt bar.
 * Hover shows the reason; clicks fall through to the bar (opens the vessel).
 */
export default function GanttStopOverlay({ stops, barStartMs, barEndMs, nowMs }) {
  const { i18n } = useTranslation()
  const marks = buildStopMarks(stops, barStartMs, barEndMs, nowMs)
  if (!marks.length) return null
  return (
    <span className="jetty-schedule-gantt__stops" aria-hidden>
      {marks.map((m) => (
        <span
          key={m.key}
          className={`jetty-schedule-gantt__stop${m.stop.isOpen ? ' jetty-schedule-gantt__stop--open' : ''}`}
          style={{ left: `${m.leftPct}%`, width: `${m.widthPct}%` }}
          title={stopMarkTitle(m, i18n.language, formatDateTimeDisplay)}
        />
      ))}
    </span>
  )
}
