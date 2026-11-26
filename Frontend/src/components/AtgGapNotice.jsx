import { formatDateTimeCompact } from '../utils/formatDateTimeDisplay'

const MAX_RANGES_SHOWN = 2

function formatRange(range) {
  return `${formatDateTimeCompact(range.startAt)} – ${formatDateTimeCompact(range.endAt)}`
}

function describeSource(source, t) {
  const shown = source.gaps.slice(0, MAX_RANGES_SHOWN).map(formatRange).join('; ')
  const extra = source.gaps.length - MAX_RANGES_SHOWN
  return t('cargoOpsAtgGapSource', {
    source: source.label || source.baseUrl || '—',
    tanks: source.tankCodes.join(', '),
    ranges: extra > 0 ? `${shown} ${t('cargoOpsAtgGapMore', { count: extra })}` : shown,
  })
}

/**
 * Explains why ATG could not give a quantity for a cargo line: which source lost readings and when.
 * @param {{ atgRef: { gapSources?: Array<object>, endpointQty?: number|null }, unit?: string, t: Function }} props
 */
export default function AtgGapNotice({ atgRef, unit, t }) {
  const gapSources = atgRef?.gapSources ?? []
  const endpointQty = atgRef?.endpointQty
  return (
    <div className="cargo-line-card__gap-notice" role="status">
      <div className="cargo-line-card__gap-notice-title">{t('cargoOpsAtgGapTitle')}</div>
      {gapSources.length ? (
        gapSources.map((source) => (
          <div key={source.baseUrl || source.label}>{describeSource(source, t)}</div>
        ))
      ) : (
        <div>{t('cargoOpsAtgGapGeneric')}</div>
      )}
      {endpointQty != null ? (
        <div>
          {t('cargoOpsAtgGapEndpoint', {
            qty: Number(endpointQty).toLocaleString(undefined, { maximumFractionDigits: 3 }),
            unit: unit || '',
          })}
        </div>
      ) : null}
    </div>
  )
}
