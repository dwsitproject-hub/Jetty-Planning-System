import { useTranslation } from 'react-i18next'
import { berthingDisabledReason } from '../utils/berthingEligibility'

/**
 * Berthing CTA in allocation queue — visually distinct when blocked (late SI / SI not approved).
 */
export default function BerthingActionButton({ row, isPlanCentric, label, onBerthing }) {
  const { t } = useTranslation('allocation')
  const berthBlock = berthingDisabledReason(row, { planCentric: isPlanCentric })
  const blocked = Boolean(berthBlock)
  const gateHint = blocked ? berthBlock : undefined
  return (
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
  )
}
