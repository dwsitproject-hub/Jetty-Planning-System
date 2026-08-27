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
}) {
  const { t } = useTranslation('pages')

  if (!hourlyBuckets?.length && !currentHourLine) return null

  return (
    <div className={`hourly-cargo-progress${compact ? ' hourly-cargo-progress--compact' : ''}`}>
      {!compact ? (
        <h4 className="hourly-cargo-progress__title">{t('cargoHourlyTableTitle')}</h4>
      ) : null}
      {currentHourLine ? (
        <p className="hourly-cargo-progress__current-hour text-steel">{currentHourLine}</p>
      ) : null}
      {hourlyBuckets?.length ? (
        <div className="hourly-cargo-progress__table-wrap">
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
              {hourlyBuckets.map((row) => (
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
      ) : null}
    </div>
  )
}
