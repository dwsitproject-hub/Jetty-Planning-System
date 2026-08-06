import { useTranslation } from 'react-i18next'
import { berthingDisabledReason } from '../utils/berthingEligibility'
import { shouldShowPlanPreBerthEditLink } from '../utils/siPreBerthEdit'

/**
 * Berthing CTA in allocation queue — visually distinct when blocked (late SI / SI not approved).
 */
export default function BerthingActionButton({ row, isPlanCentric, label, onBerthing, onEditPlan }) {
  const { t } = useTranslation('allocation')
  const berthBlock = berthingDisabledReason(row, { planCentric: isPlanCentric })
  const blocked = Boolean(berthBlock)
  const gateHint = blocked ? berthBlock : undefined
  const showPlanEdit = onEditPlan && shouldShowPlanPreBerthEditLink(row, berthBlock)
  return (
    <div className="allocation-berthing-action">
      <button
        type="button"
        className={`btn btn--small ${blocked ? 'btn--berthing-disabled' : 'btn--success'}`}
        disabled={blocked}
        title={gateHint}
        aria-label={blocked ? `${label}: ${gateHint}` : label}
        onClick={(e) => onBerthing(row, e)}
      >
        {label}
      </button>
      {showPlanEdit ? (
        <button
          type="button"
          className="btn btn--secondary btn--small allocation-berthing-action__plan-edit"
          onClick={(e) => {
            e.stopPropagation()
            onEditPlan(row)
          }}
        >
          {t('updateShipmentPlan')}
        </button>
      ) : null}
    </div>
  )
}
