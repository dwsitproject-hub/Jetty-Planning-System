import { useTranslation } from 'react-i18next'
import { MAX_SAMPLING_METRIC_CHARS, MAX_SAMPLING_PALKA_FIELD_CHARS, MAX_SAMPLING_RECORD_REMARK_CHARS } from '../../constants/inputLimits'
import SampleRefField from '../sampling/SampleRefField'

/**
 * The three sample-ref + metric inputs shared by Quick-add and the edit sheet.
 * `refs` lets the caller move focus (palka -> FFA -> moisture) on Enter.
 */
export default function SampleFields({
  form,
  errors = {},
  onChange,
  onEnter,
  refs = {},
  idPrefix,
  sampleRefKind = 'palka',
  tanks = [],
}) {
  const { t } = useTranslation('qc')
  const errorText = (code) => (code ? t(`quickAdd.error.${code}`) : null)
  const tank = sampleRefKind === 'tank'

  const field = (name, labelKey, placeholderKey, extra = {}) => {
    const code = errors[name]
    return (
      <div className={`qc-field${code ? ' qc-field--error' : ''}`}>
        <label className="qc-field__label" htmlFor={`${idPrefix}-${name}`}>
          {t(labelKey)}
        </label>
        <div className="qc-field__value">
          <input
            id={`${idPrefix}-${name}`}
            ref={refs[name]}
            className="qc-input"
            value={form[name]}
            placeholder={t(placeholderKey)}
            aria-invalid={code ? 'true' : undefined}
            onChange={(e) => onChange({ ...form, [name]: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                onEnter?.(name)
              }
            }}
            {...extra}
          />
          <span className="qc-field__unit">{t('quickAdd.unitPercent')}</span>
        </div>
        {code ? <span className="qc-field__error">{errorText(code)}</span> : null}
      </div>
    )
  }

  return (
    <>
      <div className={`qc-field${errors.noPalka ? ' qc-field--error' : ''}`}>
        <label className="qc-field__label" htmlFor={`${idPrefix}-noPalka`}>
          {t(tank ? 'quickAdd.tank' : 'quickAdd.noPalka')}
        </label>
        <SampleRefField
          id={`${idPrefix}-noPalka`}
          kind={sampleRefKind}
          tanks={tanks}
          tankId={form.tankId}
          noPalka={form.noPalka}
          inputClass="qc-input"
          inputRef={refs.noPalka}
          placeholder={t(tank ? 'quickAdd.placeholderTank' : 'quickAdd.placeholderPalka')}
          searchPlaceholder={t('quickAdd.searchTank')}
          maxLength={MAX_SAMPLING_PALKA_FIELD_CHARS}
          autoCapitalize="characters"
          enterKeyHint="next"
          onEnter={() => onEnter?.('noPalka')}
          onChange={(next) => onChange({ ...form, ...next })}
        />
        {errors.noPalka ? <span className="qc-field__error">{errorText(errors.noPalka)}</span> : null}
      </div>
      <div className="qc-field-row">
        {field('ffa', 'quickAdd.ffa', 'quickAdd.placeholderFfa', {
          inputMode: 'decimal',
          maxLength: MAX_SAMPLING_METRIC_CHARS,
          enterKeyHint: 'next',
        })}
        {field('moisture', 'quickAdd.moisture', 'quickAdd.placeholderMoisture', {
          inputMode: 'decimal',
          maxLength: MAX_SAMPLING_METRIC_CHARS,
          enterKeyHint: 'next',
        })}
      </div>
      <div className="qc-field">
        <label className="qc-field__label" htmlFor={`${idPrefix}-remark`}>
          {t('quickAdd.remark')}
        </label>
        <input
          id={`${idPrefix}-remark`}
          ref={refs.remark}
          className="qc-input"
          value={form.remark || ''}
          placeholder={t('quickAdd.placeholderRemark')}
          maxLength={MAX_SAMPLING_RECORD_REMARK_CHARS}
          enterKeyHint="done"
          onChange={(e) => onChange({ ...form, remark: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              onEnter?.('remark')
            }
          }}
        />
      </div>
      {errors.metrics ? <span className="qc-field__error">{errorText(errors.metrics)}</span> : null}
    </>
  )
}
