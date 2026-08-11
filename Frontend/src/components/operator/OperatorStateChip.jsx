import { useTranslation } from 'react-i18next'

export default function OperatorStateChip({ state }) {
  const { t } = useTranslation('operator')
  const label =
    state === 'done'
      ? t('state.completed')
      : state === 'active'
        ? t('state.inProgress')
        : t('state.notStarted')
  const cls =
    state === 'done'
      ? 'operator-state--done'
      : state === 'active'
        ? 'operator-state--active'
        : 'operator-state--pending'
  return <span className={`operator-state ${cls}`}>{label}</span>
}
