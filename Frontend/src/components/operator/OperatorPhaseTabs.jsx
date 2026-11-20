import { useTranslation } from 'react-i18next'

const TABS = [
  { key: 'operational', labelKey: 'phase.operational' },
  { key: 'post', labelKey: 'phase.postChecking' },
  { key: 'stops', labelKey: 'phase.stops' },
]

/** Operator execution tabs; `stopsBadge` = stops that still need a reason. */
export default function OperatorPhaseTabs({ phase, onChange, stopsBadge = 0 }) {
  const { t } = useTranslation('operator')

  return (
    <div className="operator-phase-tabs" role="tablist">
      {TABS.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={phase === tab.key}
          className={`operator-phase-tabs__btn${phase === tab.key ? ' is-active' : ''}`}
          onClick={() => onChange(tab.key)}
        >
          {t(tab.labelKey)}
          {tab.key === 'stops' && stopsBadge > 0 ? (
            <span className="operator-phase-tabs__badge" aria-label={t('phase.stopsBadgeAria', { count: stopsBadge })}>
              {stopsBadge}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  )
}
