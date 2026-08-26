import { useTranslation } from 'react-i18next'

export default function OperatorPhaseTabs({ phase, onChange }) {
  const { t } = useTranslation('operator')

  return (
    <div className="operator-phase-tabs" role="tablist">
      <button
        type="button"
        role="tab"
        aria-selected={phase === 'operational'}
        className={`operator-phase-tabs__btn${phase === 'operational' ? ' is-active' : ''}`}
        onClick={() => onChange('operational')}
      >
        {t('phase.operational')}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={phase === 'post'}
        className={`operator-phase-tabs__btn${phase === 'post' ? ' is-active' : ''}`}
        onClick={() => onChange('post')}
      >
        {t('phase.postChecking')}
      </button>
    </div>
  )
}
