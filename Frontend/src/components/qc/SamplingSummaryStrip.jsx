import { useTranslation } from 'react-i18next'

/** Sticky strip under the header: sample count and live averages. */
export default function SamplingSummaryStrip({ count, avgFfa, avgMoisture }) {
  const { t } = useTranslation('qc')
  const none = t('summary.none')
  return (
    <div className="qc-strip" role="status" aria-live="polite">
      <div className="qc-strip__item">
        <span className="qc-strip__value">{count}</span>
        <span className="qc-strip__label">{t('summary.count')}</span>
      </div>
      <div className="qc-strip__item">
        <span className="qc-strip__value">{avgFfa ?? none}</span>
        <span className="qc-strip__label">{t('summary.avgFfa')}</span>
      </div>
      <div className="qc-strip__item">
        <span className="qc-strip__value">{avgMoisture ?? none}</span>
        <span className="qc-strip__label">{t('summary.avgMoisture')}</span>
      </div>
    </div>
  )
}
