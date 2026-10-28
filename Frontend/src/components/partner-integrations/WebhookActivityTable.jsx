import { Fragment, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  copyText,
  formatDuration,
  formatWhen,
  httpStatusBadgeClass,
  isPendingStale,
  webhookStatusBadgeClass,
} from './partnerActivityFormat.js'

function ExpandedRow({ item, colSpan }) {
  const { t } = useTranslation('pages')
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    setCopied(await copyText(item.deliveryId))
  }

  return (
    <tr className="partner-activity-detail">
      <td colSpan={colSpan}>
        <div className="partner-activity-detail__meta">
          <span className="text-steel">{t('partnerActDeliveryId')}</span>
          <code>{item.deliveryId}</code>
          <button type="button" className="partner-link-action" onClick={handleCopy}>
            {copied ? t('adminPartnerApiCopied') : t('adminPartnerApiCopy')}
          </button>
        </div>
        <div className="partner-activity-detail__meta">
          <span className="text-steel">{t('partnerActEndpointLabel')}</span>
          <code>{item.endpointUrl}</code>
        </div>
        <div className="text-steel partner-activity-detail__label">{t('partnerActPayload')}</div>
        <pre className="partner-deliveries-payload">{JSON.stringify(item.payload, null, 2)}</pre>
      </td>
    </tr>
  )
}

export default function WebhookActivityTable({ items, showPartner, onRetry }) {
  const { t } = useTranslation('pages')
  const [expandedId, setExpandedId] = useState(null)
  const colSpan = showPartner ? 9 : 8

  return (
    <div className="table-wrap">
      <table className="data-table allocation-table partner-activity-table">
        <thead>
          <tr>
            <th aria-label={t('partnerActToggleRow')} />
            <th>{t('partnerActColTime')}</th>
            {showPartner && <th>{t('adminPartnerApiColPartner')}</th>}
            <th>{t('partnerActColEvent')}</th>
            <th>{t('partnerActColReference')}</th>
            <th>{t('partnerActEndpointLabel')}</th>
            <th>{t('adminPartnerApiColStatus')}</th>
            <th>{t('partnerActColHttp')}</th>
            <th>{t('partnerActColTries')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const open = expandedId === item.id
            const stale = isPendingStale(item)
            return (
              <Fragment key={item.id}>
                <tr className={stale ? 'partner-activity-row--stale' : undefined}>
                  <td>
                    <button
                      type="button"
                      className="partner-activity-toggle"
                      aria-expanded={open}
                      aria-label={t('partnerActToggleRow')}
                      onClick={() => setExpandedId(open ? null : item.id)}
                    >
                      {open ? '▾' : '▸'}
                    </button>
                  </td>
                  <td className="partner-activity-nowrap" title={item.createdAt ?? undefined}>
                    {formatWhen(item.sentAt || item.createdAt)}
                  </td>
                  {showPartner && <td>{item.partnerName}</td>}
                  <td>{item.eventType}</td>
                  <td className="partner-activity-ref">{item.externalReference}</td>
                  <td className="partner-activity-host">{item.endpointHost}</td>
                  <td>
                    <span className={webhookStatusBadgeClass(item.status)}>{item.status}</span>
                    {stale && <div className="partner-deliveries-error">{t('partnerActPendingStale')}</div>}
                    {item.lastError && <div className="partner-deliveries-error">{item.lastError}</div>}
                    {item.status === 'failed' && (
                      <button type="button" className="partner-link-action" onClick={() => onRetry(item.deliveryId)}>
                        {t('adminPartnerApiRetry')}
                      </button>
                    )}
                  </td>
                  <td className="partner-activity-nowrap">
                    {item.httpStatus != null ? (
                      <span className={httpStatusBadgeClass(item.httpStatus)}>{item.httpStatus}</span>
                    ) : (
                      '—'
                    )}
                    <span className="text-steel"> {formatDuration(item.durationMs)}</span>
                  </td>
                  <td>{item.attemptCount}</td>
                </tr>
                {open && <ExpandedRow item={item} colSpan={colSpan} />}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
