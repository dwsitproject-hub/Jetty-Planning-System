import { useTranslation } from 'react-i18next'
import { formatDateTimeDisplay, getAppLocaleTag } from '../utils/formatDateTimeDisplay.js'
import { describeEntryMovement, movementTypeLabel } from '../utils/kurasMovementReason.js'

/** Movement type (Auto / Normal / Kuras) for one cargo entry, with its badge and the reason. */
export default function CargoMovementTypeField({ id, draft, disabled, onChange, allowMixed = false }) {
  const { t } = useTranslation('pages')
  const { badge, text } = describeEntryMovement(t, draft, {
    locale: getAppLocaleTag(),
    formatAt: formatDateTimeDisplay,
  })
  const badgeKey = badge?.source === 'manual' ? 'cargoOpsMovementBadgeManual' : 'cargoOpsMovementBadgeAuto'

  return (
    <div className="cargo-movement-type">
      <div className="cargo-movement-type__head">
        <label className="modal__label" htmlFor={id}>{t('cargoOpsMovementType')}</label>
        {badge ? (
          <span className={`cargo-movement-type__badge cargo-movement-type__badge--${badge.type}`}>
            {t(badgeKey, { type: movementTypeLabel(t, badge.type) })}
          </span>
        ) : null}
      </div>
      <select
        id={id}
        className="modal__input"
        value={draft?.movementType || 'auto'}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="auto">{t('cargoOpsMovementAuto')}</option>
        <option value="normal">{t('cargoOpsMovementNormal')}</option>
        <option value="kuras">{t('cargoOpsMovementKuras')}</option>
        {allowMixed ? <option value="mixed">{t('cargoOpsMovementMixed')}</option> : null}
      </select>
      <p className="cargo-movement-type__reason">{text}</p>
    </div>
  )
}
