import { useTranslation } from 'react-i18next'
import { MAX_SAMPLING_METRIC_CHARS, MAX_SAMPLING_PALKA_FIELD_CHARS } from '../../constants/inputLimits'

/**
 * The three palka inputs shared by Quick-add and the edit sheet.
 * `refs` lets the caller move focus (palka -> FFA -> moisture) on Enter.
 */
export default function SampleFields({ form, errors = {}, onChange, onEnter, refs = {}, idPrefix }) {
  const { t } = useTranslation('qc')
  const errorText = (code) => (code ? t(`quickAdd.error.${code}`) : null)

  const field = (name, labelKey, placeholderKey, extra = {}) => {
    const code = errors[name]
    return (
      <div className={`qc-field${code ? ' qc-field--error' : ''}`}>
        <label className="qc-field__label" htmlFor={`${idPrefix}-${name}`}>
          {t(labelKey)}
        </label>
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
        {code ? <span className="qc-field__error">{errorText(code)}</span> : null}
      </div>
    )
  }

  return (
    <>
      {field('noPalka', 'quickAdd.noPalka', 'quickAdd.placeholderPalka', {
        maxLength: MAX_SAMPLING_PALKA_FIELD_CHARS,
        autoCapitalize: 'characters',
        enterKeyHint: 'next',
      })}
      <div className="qc-field-row">
        {field('ffa', 'quickAdd.ffa', 'quickAdd.placeholderFfa', {
          inputMode: 'decimal',
          maxLength: MAX_SAMPLING_METRIC_CHARS,
          enterKeyHint: 'next',
        })}
        {field('moisture', 'quickAdd.moisture', 'quickAdd.placeholderMoisture', {
          inputMode: 'decimal',
          maxLength: MAX_SAMPLING_METRIC_CHARS,
          enterKeyHint: 'done',
        })}
      </div>
      {errors.metrics ? <span className="qc-field__error">{errorText(errors.metrics)}</span> : null}
    </>
  )
}
