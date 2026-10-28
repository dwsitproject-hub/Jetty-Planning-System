import { useTranslation } from 'react-i18next'
import { MAX_SAMPLING_METRIC_CHARS } from '../../constants/inputLimits'

const METRIC_FIELDS = ['ffaAverage', 'moistureAverage', 'dobi', 'iodineValue']

/** Report summary figures plus the sampling time window and remark. */
export default function QcReportSummary({ sampling, errors = {}, computed, onChange }) {
  const { t } = useTranslation('qc')
  const canUseComputed = computed.avgFfa != null || computed.avgMoisture != null

  const useComputed = () => {
    if (computed.avgFfa != null) onChange('ffaAverage', computed.avgFfa)
    if (computed.avgMoisture != null) onChange('moistureAverage', computed.avgMoisture)
  }

  return (
    <>
      <section className="qc-card-block" aria-labelledby="qc-report-title">
        <h2 id="qc-report-title" className="qc-card-block__title">
          {t('entry.sectionReport')}
        </h2>
        <div className="qc-field-grid">
          {METRIC_FIELDS.map((name) => (
            <div key={name} className={`qc-field${errors[name] ? ' qc-field--error' : ''}`}>
              <label className="qc-field__label" htmlFor={`qc-report-${name}`}>
                {t(`report.${name}`)}
              </label>
              <input
                id={`qc-report-${name}`}
                className="qc-input"
                inputMode="decimal"
                maxLength={MAX_SAMPLING_METRIC_CHARS}
                value={sampling[name] ?? ''}
                aria-invalid={errors[name] ? 'true' : undefined}
                onChange={(e) => onChange(name, e.target.value)}
              />
              {errors[name] ? <span className="qc-field__error">{t(`report.error.${errors[name]}`)}</span> : null}
            </div>
          ))}
        </div>
        <button
          type="button"
          className="op-btn op-btn--soft op-btn--block"
          onClick={useComputed}
          disabled={!canUseComputed}
        >
          {t('report.useComputed')}
        </button>
        <p className="qc-muted">{t('report.computedHint')}</p>
      </section>

      <section className="qc-card-block" aria-labelledby="qc-time-title">
        <h2 id="qc-time-title" className="qc-card-block__title">
          {t('entry.sectionTime')}
        </h2>
        <div className="qc-field-grid">
          <div className="qc-field">
            <label className="qc-field__label" htmlFor="qc-start-time">
              {t('entry.startTime')}
            </label>
            <input
              id="qc-start-time"
              type="datetime-local"
              className="qc-input"
              value={sampling.startTime || ''}
              onChange={(e) => onChange('startTime', e.target.value)}
            />
          </div>
          <div className="qc-field">
            <label className="qc-field__label" htmlFor="qc-end-time">
              {t('entry.endTime')}
            </label>
            <input
              id="qc-end-time"
              type="datetime-local"
              className="qc-input"
              value={sampling.endTime || ''}
              onChange={(e) => onChange('endTime', e.target.value)}
            />
          </div>
        </div>
        <div className="qc-field">
          <label className="qc-field__label" htmlFor="qc-remark">
            {t('entry.remark')}
          </label>
          <textarea
            id="qc-remark"
            className="qc-input qc-input--area"
            rows={3}
            value={sampling.remark || ''}
            onChange={(e) => onChange('remark', e.target.value)}
          />
        </div>
      </section>
    </>
  )
}
