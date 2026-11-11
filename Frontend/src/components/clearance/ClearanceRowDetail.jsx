import { useTranslation } from 'react-i18next'
import { formatDateTimeDisplay } from '../../utils/formatDateTimeDisplay'
import { commodityLabel } from '../qc/QcRowDetail'

/** Custom Clearance detail under one SI in the queue: commodity, clearance window, documents, last editor. */
export default function ClearanceRowDetail({ row }) {
  const { t } = useTranslation('customClearance')
  const c = row.clearance
  const parts = []
  if (c?.startAt) {
    const start = formatDateTimeDisplay(c.startAt)
    parts.push(c.endAt ? t('queue.window', { start, end: formatDateTimeDisplay(c.endAt) }) : t('queue.started', { start }))
  }
  if (c?.documentCount) parts.push(t('queue.documents', { count: c.documentCount }))
  const when = c?.updatedAt ? formatDateTimeDisplay(c.updatedAt) : null
  let updated = null
  if (when) {
    updated = c.updatedByName ? t('queue.updatedBy', { when, who: c.updatedByName }) : t('queue.updatedAt', { when })
  }
  return (
    <>
      <span className="qc-card__commodity">{commodityLabel(row)}</span>
      {parts.length || updated ? (
        <span className="qc-sample-line">
          {parts.length ? <span>{parts.join(' · ')}</span> : null}
          {updated ? <span className="qc-sample-line__updated">{updated}</span> : null}
        </span>
      ) : null}
    </>
  )
}
