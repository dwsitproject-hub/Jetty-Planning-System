import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { splitVacantArrivalQueue } from '../utils/jettyScheduleOccupancy'
import { formatDateTimeCompact, formatDateTimeDisplay } from '../utils/formatDateTimeDisplay'

function shownTime(value, format) {
  if (value == null || value === '') return null
  const text = format(value)
  return text && text !== '—' ? text : null
}

function ArrivalHero({ entry }) {
  const eta = shownTime(entry.etaDateTime, formatDateTimeDisplay)
  const etb = shownTime(entry.etbDateTime, formatDateTimeDisplay)
  const cargo = [entry.commodity, entry.qty].filter(Boolean).join(' ')
  return (
    <span className="jetty-incoming__block">
      <strong className="jetty-incoming__name">{entry.name}</strong>
      {eta ? <span className="jetty-incoming__meta">ETA {eta}</span> : null}
      {etb ? <span className="jetty-incoming__meta">ETB {etb}</span> : null}
      {cargo ? <span className="jetty-incoming__meta">{cargo}</span> : null}
    </span>
  )
}

function ArrivalLine({ entry }) {
  const when = shownTime(entry.etaDateTime, formatDateTimeCompact)
  return (
    <span className="jetty-incoming__line">
      <span className="jetty-incoming__line-name">{entry.name}</span>
      {when ? <span className="jetty-incoming__line-when">{when}</span> : null}
    </span>
  )
}

/**
 * Vacant-lane queue: "Vacant" stays above this list. The next vessel is shown in
 * full, one more as a line, and the remainder behind a toggle.
 */
export default function JettyVacantArrivals({ entries }) {
  const { t } = useTranslation('allocation')
  const [open, setOpen] = useState(false)
  const { visible, rest } = splitVacantArrivalQueue(entries)
  if (!visible.length) return null
  const [hero, second] = visible
  const lines = open ? [...(second ? [second] : []), ...rest] : second ? [second] : []

  return (
    <span className="jetty-incoming-queue">
      <ArrivalHero entry={hero} />
      {lines.map((entry) => (
        <ArrivalLine key={entry.key} entry={entry} />
      ))}
      {rest.length > 0 ? (
        <button
          type="button"
          className="jetty-incoming__more"
          aria-expanded={open}
          onClick={(e) => {
            e.stopPropagation()
            setOpen((value) => !value)
          }}
        >
          {open ? t('vacantShowLess') : t('vacantMore', { count: rest.length })}
        </button>
      ) : null}
    </span>
  )
}
