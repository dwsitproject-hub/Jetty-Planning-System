import { formatWhen } from '../../utils/adminOpsDisplay'
import { overrideState } from '../../utils/tankManualOverride'

/** Status pill, plus the explicit "Manual override…" button for users who can edit. */
export default function TankOverrideCell({ tank, canEdit, onOpen, t }) {
  const state = overrideState(tank)
  const o = tank.manualOverride
  const label =
    state === 'on'
      ? o.expiresAt
        ? t('tankOverrideOnUntil', { date: formatWhen(o.expiresAt) })
        : t('tankOverrideOnNoExpiry')
      : state === 'expired'
        ? t('tankOverrideExpired', { date: formatWhen(o.expiresAt) })
        : t('tankOverrideOff')

  return (
    <div className="tank-override-cell">
      <div className="tank-override-cell__top">
        <span className={`tank-override-pill tank-override-pill--${state}`}>{label}</span>
        {canEdit ? (
          <button type="button" className="btn btn--secondary btn--small tank-override-btn" onClick={() => onOpen(tank)}>
            {t('tankOverrideButton')}
          </button>
        ) : null}
      </div>
      {state === 'on' && o.reason ? (
        <div className="text-steel tank-override-cell__reason" title={o.reason}>
          {o.reason}
          {o.setBy ? ` · ${o.setBy}` : ''}
        </div>
      ) : null}
    </div>
  )
}
