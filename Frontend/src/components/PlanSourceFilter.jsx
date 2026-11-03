import { useTranslation } from 'react-i18next'
import '../styles/plan-source.css'

/**
 * Single-select source chips (All, Internal, one per partner) with counts.
 * Renders nothing when there are no chips, i.e. no partner plans exist.
 */
export default function PlanSourceFilter({ chips, selected, onChange }) {
  const { t } = useTranslation('shipmentPlan')
  if (!chips.length) return null

  const chipLabel = (chip) => {
    if (chip.kind === 'all') return t('filterAll')
    if (chip.kind === 'internal') return t('sourceInternal')
    return chip.name
  }

  return (
    <div className="plan-source-filter" role="group" aria-label={t('filterSourceGroup')}>
      <span className="plan-source-filter__label" aria-hidden="true">{t('colSource')}</span>
      <div className="plan-source-filter__chips">
        {chips.map((chip) => {
          const label = chipLabel(chip)
          const active = chip.key === selected
          return (
            <button
              key={chip.key}
              type="button"
              className={`plan-source-chip${active ? ' plan-source-chip--active' : ''}`}
              aria-pressed={active}
              aria-label={t('sourceChipAria', { label, count: chip.count })}
              title={chip.kind === 'partner' ? chip.name : undefined}
              onClick={() => onChange(chip.key)}
            >
              <span className="plan-source-chip__name">{label}</span>
              <span className="plan-source-chip__count" aria-hidden="true">{chip.count}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
