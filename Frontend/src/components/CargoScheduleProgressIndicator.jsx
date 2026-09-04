import { useTranslation } from 'react-i18next'

/**
 * Normalize schedule comparison from API shapes (flat cargo-progress or nested block).
 * @param {object|null|undefined} source
 */
export function normalizeScheduleComparison(source) {
  if (!source) return null
  if (source.scheduleComparison) return source.scheduleComparison
  if (source.evaluable != null || source.isBehindSchedule != null) {
    return {
      evaluable: Boolean(source.evaluable),
      plannedPercent: source.plannedPercent ?? null,
      actualPercent: source.actualPercent ?? null,
      isBehindSchedule: Boolean(source.isBehindSchedule),
      scheduleGapPercent: source.scheduleGapPercent ?? null,
      scheduleStartAt: source.scheduleStartAt ?? null,
      etcAt: source.etcAt ?? null,
    }
  }
  return null
}

function formatTooltip(t, comparison) {
  const actual = comparison.actualPercent ?? '—'
  const planned = comparison.plannedPercent ?? '—'
  const gap = comparison.scheduleGapPercent ?? 0
  return t('cargoScheduleTooltip', { actual, planned, gap })
}

/**
 * @param {{
 *   comparison?: object|null,
 *   mode?: 'compact'|'full',
 *   movedQty?: number|null,
 *   siQty?: number|null,
 *   siMetric?: string|null,
 *   sourceLabel?: string|null,
 *   className?: string,
 *   compactLabel?: boolean,
 * }} props
 */
export default function CargoScheduleProgressIndicator({
  comparison: comparisonProp = null,
  mode = 'compact',
  movedQty = null,
  siQty = null,
  siMetric = 'MT',
  sourceLabel = null,
  className = '',
  compactLabel = false,
}) {
  const { t } = useTranslation('pages')
  const comparison = normalizeScheduleComparison(comparisonProp)

  if (!comparison?.evaluable) return null

  if (mode === 'compact') {
    if (!comparison.isBehindSchedule) return null
    const gap = comparison.scheduleGapPercent ?? 0
    const tooltip = formatTooltip(t, comparison)
    return (
      <span
        className={`cargo-schedule-badge ${className}`.trim()}
        role="status"
        title={tooltip}
        aria-label={t('cargoScheduleBehindAria', {
          actual: comparison.actualPercent,
          planned: comparison.plannedPercent,
          gap,
        })}
      >
        {compactLabel
          ? t('cargoScheduleBehindBadgeShort', { gap })
          : t('cargoScheduleBehindBadge', { gap })}
      </span>
    )
  }

  const planned = comparison.plannedPercent ?? 0
  const actual = comparison.actualPercent ?? 0
  const behind = comparison.isBehindSchedule
  const gap = comparison.scheduleGapPercent ?? 0

  const movedDisplay =
    movedQty != null && Number.isFinite(Number(movedQty))
      ? Math.round(Number(movedQty)).toLocaleString('en-US')
      : null
  const totalDisplay =
    siQty != null && Number(siQty) > 0
      ? Math.round(Number(siQty)).toLocaleString('en-US')
      : null
  const qtyLine =
    movedDisplay && totalDisplay
      ? `${movedDisplay} / ${totalDisplay} ${siMetric || 'MT'}`
      : movedDisplay
        ? `${movedDisplay} ${siMetric || 'MT'}`
        : null

  return (
    <div
      className={`cargo-schedule-progress ${behind ? 'cargo-schedule-progress--behind' : ''} ${className}`.trim()}
    >
      <div className="cargo-schedule-progress__header">
        <h4 className="cargo-schedule-progress__title">{t('cargoScheduleSectionTitle')}</h4>
        {behind ? (
          <span className="cargo-schedule-progress__status cargo-schedule-progress__status--behind">
            {t('cargoScheduleBehindBanner', {
              actual,
              planned,
              gap,
            })}
          </span>
        ) : (
          <span className="cargo-schedule-progress__status cargo-schedule-progress__status--ok">
            {t('cargoScheduleOnTrack')}
          </span>
        )}
      </div>

      <div className="cargo-schedule-progress__labels">
        <span>{t('cargoScheduleActualLabel', { value: actual })}</span>
        <span>{t('cargoSchedulePlannedLabel', { value: planned })}</span>
      </div>

      <div className="cargo-schedule-progress__bar-track" aria-hidden>
        <span
          className="cargo-schedule-progress__bar-fill"
          style={{ width: `${Math.min(100, Math.max(0, actual))}%` }}
        />
        <span
          className="cargo-schedule-progress__bar-planned"
          style={{ left: `${Math.min(100, Math.max(0, planned))}%` }}
        />
      </div>

      <p className="cargo-schedule-progress__legend">{t('cargoScheduleLegend')}</p>

      {qtyLine || sourceLabel ? (
        <p className="cargo-schedule-progress__meta">
          {[qtyLine, sourceLabel].filter(Boolean).join(' · ')}
        </p>
      ) : null}
    </div>
  )
}

/**
 * @param {object|null|undefined} comparison
 * @returns {boolean}
 */
export function isCargoBehindSchedule(comparison) {
  return Boolean(normalizeScheduleComparison(comparison)?.isBehindSchedule)
}
