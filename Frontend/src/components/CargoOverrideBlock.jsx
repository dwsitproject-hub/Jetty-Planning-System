import { formatWhen } from '../utils/adminOpsDisplay'
import '../styles/tank-override.css'

/**
 * Per-tank manual override on a cargo entry: shown only when the entry's tank is on ATG and its
 * override is ON (or the entry was saved with one). The operator picks Manual or Use ATG, and
 * must leave a note when typing the quantity by hand.
 */
export default function CargoOverrideBlock({ row, tankMetaById, hasEnd, t, onChange }) {
  const tankId = row.tankIds?.[0]
  const meta = tankMetaById?.get(String(tankId))
  const override = meta?.manualOverride ?? null
  const active = override?.active === true
  const manual = Boolean(row.overrideManual)

  if (!meta?.hasAtg || (!active && !manual)) return null

  return (
    <div className="cargo-override">
      <div className="cargo-override__head">
        <span className="tank-override-pill tank-override-pill--on">{t('cargoOpsOverrideBadge')}</span>
        <span className="cargo-override__toggle" role="group" aria-label={t('cargoOpsOverrideBadge')}>
          <button
            type="button"
            className={`cargo-override__seg${manual ? ' is-active' : ''}`}
            aria-pressed={manual}
            disabled={!active && !manual}
            onClick={() => onChange({ overrideManual: true, qty: '', qtyTouched: true })}
          >
            {t('cargoOpsOverrideManual')}
          </button>
          <button
            type="button"
            className={`cargo-override__seg${manual ? '' : ' is-active'}`}
            aria-pressed={!manual}
            onClick={() => onChange({ overrideManual: false })}
          >
            {t('cargoOpsOverrideUseAtg')}
          </button>
        </span>
      </div>
      <p className="text-steel cargo-override__info">
        {active
          ? t('cargoOpsOverrideInfo', {
              code: meta.code,
              until: override.expiresAt ? formatWhen(override.expiresAt) : t('cargoOpsOverrideNoExpiry'),
              reason: override.reason || '—',
              by: override.setBy || '—',
            })
          : t('cargoOpsOverrideSavedInfo', { code: meta.code })}
      </p>
      {manual ? (
        hasEnd ? (
          <div className="berthing-modal__field">
            <label className="berthing-modal__label" htmlFor={`op-cargo-override-note-${row.key}`}>
              {t('cargoOpsOverrideNote')} <span className="required-star">*</span>
            </label>
            <textarea
              id={`op-cargo-override-note-${row.key}`}
              className="berthing-modal__input berthing-modal__textarea"
              rows={2}
              value={row.overrideNote ?? ''}
              placeholder={t('cargoOpsOverrideNotePlaceholder')}
              onChange={(e) => onChange({ overrideNote: e.target.value })}
            />
          </div>
        ) : (
          <p className="text-steel cargo-override__info">{t('cargoOpsOverrideAtEnd')}</p>
        )
      ) : null}
    </div>
  )
}
