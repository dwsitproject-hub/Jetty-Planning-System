import { useTranslation } from 'react-i18next'

/**
 * Compact “New plan” control for schematic / Gantt filter rows.
 * Rendered only when the parent passes onCreatePlan (RBAC + plan-centric).
 */
export default function CreatePlanToolbarButton({ onCreatePlan }) {
  const { t } = useTranslation('allocation')
  if (typeof onCreatePlan !== 'function') return null
  const full = t('createNewPlan', { defaultValue: 'New shipment plan' })
  return (
    <button
      type="button"
      className="btn btn--primary btn--small jetty-schedule-gantt__create-plan"
      onClick={onCreatePlan}
      title={full}
      aria-label={full}
    >
      {t('createNewPlanToolbar', { defaultValue: 'New plan' })}
    </button>
  )
}
