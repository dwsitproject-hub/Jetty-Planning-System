import { useTranslation } from 'react-i18next'
import { formatDateTimeDisplay, getAppLocaleTag } from '../utils/formatDateTimeDisplay.js'
import { describeKurasStart } from '../utils/kurasStart.js'

/**
 * Kuras start point of one cargo entry: Auto (from hourly ATG), a time the operator sets,
 * or "No kuras". Shown only while the net-rate feature is on.
 */
export default function CargoKurasStartField({ id, draft, disabled, onChange }) {
  const { t } = useTranslation('pages')
  const mode = draft?.kurasStartMode || 'auto'
  const text = describeKurasStart(t, draft, { formatAt: formatDateTimeDisplay, locale: getAppLocaleTag() })
  const change = (patch) => onChange({ ...patch, kurasStartTouched: true })

  return (
    <div className="cargo-movement-type">
      <div className="cargo-movement-type__head">
        <label className="modal__label" htmlFor={id}>{t('kurasStartLabel')}</label>
      </div>
      <div className="cargo-kuras-start__row">
        <select
          id={id}
          className="modal__input"
          value={mode}
          disabled={disabled}
          onChange={(e) => change({ kurasStartMode: e.target.value })}
        >
          <option value="auto">{t('kurasStartModeAuto')}</option>
          <option value="manual">{t('kurasStartModeManual')}</option>
          <option value="none">{t('kurasStartModeNone')}</option>
        </select>
        {mode === 'manual' ? (
          <input
            type="datetime-local"
            className="modal__input"
            aria-label={t('kurasStartTimeAria')}
            value={draft?.kurasStartInput || ''}
            disabled={disabled}
            onChange={(e) => change({ kurasStartInput: e.target.value })}
          />
        ) : null}
      </div>
      <p className="cargo-movement-type__reason">{text}</p>
    </div>
  )
}
