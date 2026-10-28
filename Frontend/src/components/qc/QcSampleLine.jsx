import { useTranslation } from 'react-i18next'
import { formatDateTimeDisplay } from '../../utils/formatDateTimeDisplay'

/** "6 palka · FFA 4.9 · Moist 0.25" plus who last touched the record (Loading hub or QC). */
export default function QcSampleLine({ sampling }) {
  const { t } = useTranslation('qc')
  if (!sampling || sampling.status === 'not_started') return null
  const parts = [t('queue.samplesLine', { count: sampling.recordCount })]
  if (sampling.avgFfa) parts.push(t('queue.avgFfa', { value: sampling.avgFfa }))
  if (sampling.avgMoisture) parts.push(t('queue.avgMoisture', { value: sampling.avgMoisture }))
  const when = sampling.updatedAt ? formatDateTimeDisplay(sampling.updatedAt) : null
  let updated = null
  if (when) {
    updated = sampling.updatedByName
      ? t('queue.updatedBy', { when, who: sampling.updatedByName })
      : t('queue.updatedAt', { when })
  }
  return (
    <div className="qc-sample-line">
      <span>{parts.join(' · ')}</span>
      {updated ? <span className="qc-sample-line__updated">{updated}</span> : null}
    </div>
  )
}
