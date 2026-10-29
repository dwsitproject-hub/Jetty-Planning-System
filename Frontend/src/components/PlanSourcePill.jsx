import { useTranslation } from 'react-i18next'
import { planSourceOf } from '../utils/planSource'
import '../styles/plan-source.css'

/** Origin of a shipment plan: the partner name, or "Internal" when no partner submitted it. */
export default function PlanSourcePill({ row }) {
  const { t } = useTranslation('shipmentPlan')
  const source = planSourceOf(row)

  if (source.kind === 'partner') {
    return (
      <span
        className="plan-source-pill plan-source-pill--partner"
        title={source.name}
        aria-label={t('sourcePillAria', { name: source.name })}
      >
        {source.name}
      </span>
    )
  }
  return <span className="plan-source-pill plan-source-pill--internal">{t('sourceInternal')}</span>
}
