import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { metricValue, paramFieldLabel, paramUnit, patchCardMetric, valueCodesOf } from '../../utils/qcSpec'
import { aggregateSampleMetric } from '../../utils/qcSampling'
import { MAX_SAMPLING_METRIC_CHARS } from '../../constants/inputLimits'

/** Cargo-level QC results for the report, kept visually separate from per-sample rows. */
export default function CommodityReportSummary({ card, params, readOnly, qc, inputClass, errors, onPatch }) {
  const { t: tQc, i18n } = useTranslation('qc')
  const [openCode, setOpenCode] = useState(null)
  const [emptyCode, setEmptyCode] = useState(null)
  if (!params.length) return null
  const headingId = `qc-report-${card.commodityId}`

  const apply = (code, mode) => {
    const value = aggregateSampleMetric(card.records, code, mode)
    setOpenCode(null)
    if (value == null) {
      setEmptyCode(code)
      return
    }
    setEmptyCode(null)
    onPatch?.(card.commodityId, patchCardMetric(card, code, value))
  }

  return (
    <section className="qc-report-summary" aria-labelledby={headingId}>
      <header className="qc-report-summary__head">
        <span className="qc-report-summary__badge">{tQc('report.levelLabel')}</span>
        <h5 id={headingId} className="qc-report-summary__title">{tQc('entry.sectionReport')}</h5>
      </header>
      <p className="qc-report-summary__hint">{tQc('report.cardHint')}</p>
      <div className={qc ? 'qc-field-grid' : 'sampling-entry-block__grid sampling-entry-block__grid--quality'}>
        {params.flatMap((param) =>
          valueCodesOf(param).map((code) => {
            const canCalculate = !readOnly && param.scope === 'both'
            const open = openCode === code
            return (
              <div key={code} className={qc ? 'qc-field' : 'berthing-modal__field'}>
                <label className={qc ? 'qc-field__label' : 'berthing-modal__label'}>
                  {paramFieldLabel(param, code, i18n.language)}
                </label>
                <div className="qc-field__value">
                  {readOnly ? (
                    <span>{metricValue(card, code) || '—'}</span>
                  ) : (
                    <input
                      className={inputClass}
                      value={metricValue(card, code) || ''}
                      maxLength={MAX_SAMPLING_METRIC_CHARS}
                      onChange={(e) => onPatch?.(card.commodityId, patchCardMetric(card, code, e.target.value))}
                    />
                  )}
                  {paramUnit(param) ? <span className="qc-field__unit">{paramUnit(param)}</span> : null}
                </div>
                {canCalculate ? (
                  <>
                    <button
                      type="button"
                      className="qc-auto-calc__toggle"
                      aria-expanded={open}
                      onClick={() => {
                        setEmptyCode(null)
                        setOpenCode(open ? null : code)
                      }}
                    >
                      {tQc('report.autoCalculate')}
                    </button>
                    {open ? (
                      <div className="qc-auto-calc" role="group" aria-label={tQc('report.autoCalculate')}>
                        <button type="button" className="qc-auto-calc__choice" onClick={() => apply(code, 'average')}>
                          {tQc('report.average')}
                        </button>
                        <button type="button" className="qc-auto-calc__choice" onClick={() => apply(code, 'sum')}>
                          {tQc('report.sum')}
                        </button>
                      </div>
                    ) : null}
                    {emptyCode === code ? <p className="qc-auto-calc__empty">{tQc('report.noSampleValues')}</p> : null}
                  </>
                ) : null}
                {errors[`${card.commodityId}.${code}`] ? (
                  <span className="qc-field__error">{tQc(`report.error.${errors[`${card.commodityId}.${code}`]}`)}</span>
                ) : null}
              </div>
            )
          })
        )}
      </div>
    </section>
  )
}
