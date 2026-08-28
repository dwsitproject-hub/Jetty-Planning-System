import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

function formatQty(n, unit = 'MT') {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  return `${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${unit}`
}

function formatRate(n, unit = 'MT') {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  return `${Number(n).toLocaleString('en-US', { maximumFractionDigits: 1 })} ${unit}/h`
}

function movementBadge(status, t) {
  if (status === 'flat_movement') {
    return (
      <span className="hourly-cargo-progress__badge hourly-cargo-progress__badge--flat">
        {t('cargoHourlyFlatMovement')}
      </span>
    )
  }
  if (status === 'incomplete') {
    return (
      <span className="hourly-cargo-progress__badge hourly-cargo-progress__badge--incomplete">
        {t('cargoHourlyIncomplete')}
      </span>
    )
  }
  return (
    <span className="hourly-cargo-progress__badge hourly-cargo-progress__badge--active">
      {t('cargoHourlyActive')}
    </span>
  )
}

function sourceBadge(source, t) {
  if (source === 'manual') {
    return (
      <span className="hourly-cargo-progress__source hourly-cargo-progress__source--manual">
        {t('cargoHourlySourceManual')}
      </span>
    )
  }
  if (source === 'hybrid') {
    return <span className="hourly-cargo-progress__source">{String(source).toUpperCase()}</span>
  }
  if (source === 'atg') {
    return <span className="hourly-cargo-progress__source">ATG</span>
  }
  return source ? <span className="hourly-cargo-progress__source">{String(source).toUpperCase()}</span> : null
}

/**
 * Clock-hour cargo transfer rate table (ATG / manual).
 */
export default function HourlyCargoProgressTable({
  hourlyBuckets = [],
  unit = 'MT',
  compact = false,
  currentHourLine = null,
  collapsible = false,
  collapsedRowLimit = 6,
  defaultExpanded = false,
  segmentStartLabel = null,
}) {
  const { t } = useTranslation('pages')
  const [expanded, setExpanded] = useState(defaultExpanded)

  const visibleBuckets = useMemo(() => {
    if (!Array.isArray(hourlyBuckets) || hourlyBuckets.length === 0) return []
    if (!collapsible || expanded || hourlyBuckets.length <= collapsedRowLimit) {
      return hourlyBuckets
    }
    return hourlyBuckets.slice(-collapsedRowLimit)
  }, [hourlyBuckets, collapsible, expanded, collapsedRowLimit])

  if (!hourlyBuckets?.length && !currentHourLine) return null

  const totalCount = hourlyBuckets?.length ?? 0
  const showToggle = collapsible && totalCount > collapsedRowLimit

  return (
    <div className={`hourly-cargo-progress${compact ? ' hourly-cargo-progress--compact' : ''}`}>
      {!compact ? (
        <h4 className="hourly-cargo-progress__title">{t('cargoHourlyTableTitle')}</h4>
      ) : null}
      {currentHourLine ? (
        <p className="hourly-cargo-progress__current-hour text-steel">{currentHourLine}</p>
      ) : null}
      {showToggle && !expanded ? (
        <p className="hourly-cargo-progress__range-hint text-steel">
          {t('cargoHourlyShowingRecent', {
            shown: collapsedRowLimit,
            total: totalCount,
            start: segmentStartLabel || '—',
          })}
        </p>
      ) : null}
      {visibleBuckets?.length ? (
        <>
          <div
            className={`hourly-cargo-progress__table-wrap${expanded && showToggle ? ' hourly-cargo-progress__table-wrap--scroll' : ''}`}
          >
            <table className="hourly-cargo-progress__table">
              <thead>
                <tr>
                  <th>{t('cargoHourlyColTime')}</th>
                  <th>{t('cargoHourlyColQty')}</th>
                  <th>{t('cargoHourlyColRate')}</th>
                  <th>{t('cargoHourlyColStatus')}</th>
                  {!compact ? <th>{t('cargoHourlyColSource')}</th> : null}
                </tr>
              </thead>
              <tbody>
                {visibleBuckets.map((row) => (
                  <tr
                    key={row.hourStart}
                    className={`hourly-cargo-progress__row hourly-cargo-progress__row--${row.movementStatus || 'active'}`}
                  >
                    <td>{row.hourLabelLocal || row.hourStart}</td>
                    <td>{formatQty(row.qtyMoved, unit)}</td>
                    <td>{formatRate(row.rateTph, unit)}</td>
                    <td>{movementBadge(row.movementStatus, t)}</td>
                    {!compact ? <td>{sourceBadge(row.source, t)}</td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {showToggle ? (
            <button
              type="button"
              className="btn btn--small btn--soft hourly-cargo-progress__toggle"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
            >
              {expanded ? t('cargoHourlyShowLess') : t('cargoHourlyShowAll', { count: totalCount })}
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
