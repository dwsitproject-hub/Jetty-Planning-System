import { useTranslation } from 'react-i18next'
import { usePortScope } from '../context/PortScopeContext'

export default function MasterWorkingPortBar({ meta = null }) {
  const { t } = useTranslation('pages')
  const {
    assignedPorts,
    selectedPortId,
    setSelectedPortId,
    noPortAssigned,
    noPortMessage,
    requiresSelection,
  } = usePortScope()

  if (noPortAssigned) {
    return (
      <p className="allocation-page__intro" style={{ color: 'var(--color-danger, #c00)' }} role="alert">
        {noPortMessage}
      </p>
    )
  }

  const selectId = 'master-working-port'

  return (
    <div className="master-working-port-bar">
      <label className="master-working-port-bar__label" htmlFor={selectId}>
        {t('masterWorkingPortLabel')}
      </label>
      <select
        id={selectId}
        className="master-working-port-bar__select"
        value={selectedPortId != null ? String(selectedPortId) : ''}
        onChange={(e) => {
          const v = e.target.value
          setSelectedPortId(v === '' ? null : Number(v))
        }}
        disabled={assignedPorts.length <= 1}
      >
        {(requiresSelection || selectedPortId == null) && (
          <option value="">{t('masterWorkingPortSelect')}</option>
        )}
        {assignedPorts.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <span className="master-hub-badge master-hub-badge--per-port">{t('masterBadgePerPort')}</span>
      {meta ? <span className="master-working-port-bar__meta">{meta}</span> : null}
      <p className="master-working-port-bar__hint">{t('masterWorkingPortHint')}</p>
    </div>
  )
}
