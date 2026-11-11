import { useTranslation } from 'react-i18next'
import { paramFieldLabel, paramUnit, valueCodesOf } from '../../utils/qcSpec'
import { MAX_SAMPLING_PALKA_FIELD_CHARS, MAX_SAMPLING_RECORD_REMARK_CHARS } from '../../constants/inputLimits'
import SampleRefField from './SampleRefField'

/**
 * The add/update row of one commodity card: sample ref, one input per sample parameter, remark.
 * The QC variant keeps a visible label above every input (same pattern as the Report section)
 * so the field stays named while typing; the hub keeps its compact placeholder row.
 */
export default function SampleEntryRow({
  card,
  sampleParams,
  form,
  editing,
  qc,
  inputClass,
  buttonClass,
  sampleRefKind,
  tanks,
  onChange,
  onSubmit,
}) {
  const { t, i18n } = useTranslation('loading')
  const idPrefix = `sample-entry-${card.commodityId}`
  const tank = sampleRefKind === 'tank'
  const refId = `${idPrefix}-ref`
  const remarkId = `${idPrefix}-remark`

  const labeled = (id, label, control, { unit = null, required = false, wide = false } = {}) =>
    qc ? (
      <div key={id} className={`qc-field${wide ? ' qc-field--wide' : ''}`}>
        <label className="qc-field__label" htmlFor={id}>
          {label}
          {required ? <span className="qc-field__required" aria-hidden="true"> *</span> : null}
        </label>
        <div className="qc-field__value">
          {control}
          {unit ? <span className="qc-field__unit">{unit}</span> : null}
        </div>
      </div>
    ) : (
      control
    )

  return (
    <div
      className={
        qc
          ? 'qc-palka-row qc-palka-row--labeled'
          : `sampling-entry-block__grid sampling-entry-block__grid--palka${tank ? ' sampling-entry-block__grid--tank' : ''}`
      }
    >
      {labeled(
        refId,
        t(tank ? 'sampling.tank' : 'sampling.noPalka'),
        <SampleRefField
          id={refId}
          kind={sampleRefKind}
          tanks={tanks}
          tankId={editing ? form.tankId : ''}
          noPalka={editing ? form.noPalka : ''}
          inputClass={inputClass}
          placeholder={t(tank ? 'sampling.placeholderTank' : 'sampling.noPalka')}
          searchPlaceholder={t('sampling.searchTank')}
          maxLength={MAX_SAMPLING_PALKA_FIELD_CHARS}
          onChange={onChange}
        />,
        { required: true }
      )}
      {sampleParams.flatMap((param) =>
        valueCodesOf(param).map((code) => {
          const id = `${idPrefix}-${code}`
          const label = paramFieldLabel(param, code, i18n.language)
          const unit = paramUnit(param)
          return labeled(
            id,
            label,
            <input
              key={code}
              id={id}
              className={inputClass}
              value={editing ? form[code] || '' : ''}
              placeholder={qc ? undefined : label}
              aria-label={qc ? undefined : unit ? `${label} ${unit}` : label}
              maxLength={MAX_SAMPLING_PALKA_FIELD_CHARS}
              onChange={(e) => onChange({ [code]: e.target.value })}
            />,
            { unit }
          )
        })
      )}
      {labeled(
        remarkId,
        t('sampling.remark'),
        <input
          id={remarkId}
          className={`${inputClass} qc-sample-remark`}
          value={editing ? form.remark || '' : ''}
          placeholder={qc ? t('sampling.remarkPlaceholder') : t('sampling.remark')}
          maxLength={MAX_SAMPLING_RECORD_REMARK_CHARS}
          onChange={(e) => onChange({ remark: e.target.value })}
        />,
        { wide: true }
      )}
      <button type="button" className={buttonClass} onClick={onSubmit}>
        {form.id && editing ? t('sampling.update') : t('sampling.add')}
      </button>
    </div>
  )
}
