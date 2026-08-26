import { useTranslation } from 'react-i18next'

export default function OperatorCargoProgress({
  shortName,
  qtyLine,
  done = 0,
  total = 0,
  purpose = 'Loading',
  className = '',
}) {
  const { t } = useTranslation('operator')
  const moved = Number(done) || 0
  const cap = Number(total) || 0
  const pct = cap > 0 ? Math.min(100, Math.round((moved / cap) * 100)) : 0
  const ariaLabel =
    purpose === 'Unloading' ? t('progress.unloading') : t('progress.loading')

  if (!shortName && !qtyLine) return null

  return (
    <div className={`operator-cargo-progress${className ? ` ${className}` : ''}`}>
      <div className="operator-cargo-progress__head">
        {shortName ? (
          <span className="operator-cargo-progress__name">{shortName}</span>
        ) : null}
        {qtyLine ? <span className="operator-cargo-progress__qty">{qtyLine}</span> : null}
      </div>
      {qtyLine && cap > 0 ? (
        <div
          className="operator-cargo-progress__bar-track"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={ariaLabel}
        >
          <div className="operator-cargo-progress__bar-fill" style={{ width: `${pct}%` }} />
        </div>
      ) : null}
    </div>
  )
}
