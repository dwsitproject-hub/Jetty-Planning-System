import { Fragment, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { copyText, formatDuration, formatWhen, httpStatusBadgeClass } from './partnerActivityFormat.js'

function ExpandedRow({ item, colSpan }) {
  const { t } = useTranslation('pages')
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    setCopied(await copyText(item.requestId))
  }

  return (
    <tr className="partner-activity-detail">
      <td colSpan={colSpan}>
        {item.requestId && (
          <div className="partner-activity-detail__meta">
            <span className="text-steel">{t('partnerActRequestId')}</span>
            <code>{item.requestId}</code>
            <button type="button" className="partner-link-action" onClick={handleCopy}>
              {copied ? t('adminPartnerApiCopied') : t('adminPartnerApiCopy')}
            </button>
          </div>
        )}
        <div className="partner-activity-detail__meta">
          <span className="text-steel">{t('partnerActPath')}</span>
          <code>{`/api/v1/integrations${item.path}`}</code>
        </div>
        <div className="partner-activity-detail__meta">
          <span className="text-steel">{t('partnerActClientIp')}</span>
          <code>{item.clientIp ?? '—'}</code>
        </div>
        <div className="partner-activity-detail__meta">
          <span className="text-steel">{t('adminPartnerApiColKey')}</span>
          <code>{item.keyPrefix ? `${item.keyPrefix}…` : '—'}</code>
        </div>
        <p className="text-steel partner-activity-detail__note">{t('partnerActNoBodies')}</p>
      </td>
    </tr>
  )
}

export default function ApiRequestActivityTable({ items, showPartner }) {
  const { t } = useTranslation('pages')
  const [expandedId, setExpandedId] = useState(null)
  const colSpan = showPartner ? 8 : 7

  return (
    <div className="table-wrap">
      <table className="data-table allocation-table partner-activity-table">
        <thead>
          <tr>
            <th aria-label={t('partnerActToggleRow')} />
            <th>{t('partnerActColTime')}</th>
            {showPartner && <th>{t('adminPartnerApiColPartner')}</th>}
            <th>{t('partnerActMethodLabel')}</th>
            <th>{t('partnerActRouteLabel')}</th>
            <th>{t('partnerActColResult')}</th>
            <th>{t('partnerActColErrorCode')}</th>
            <th>{t('partnerActColReference')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const open = expandedId === item.id
            return (
              <Fragment key={item.id}>
                <tr>
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
                  <td className="partner-activity-nowrap">{formatWhen(item.createdAt)}</td>
                  {showPartner && (
                    <td>
                      {item.partnerName ?? t('partnerActUnknownKey', { prefix: item.keyPrefix ?? '—' })}
                    </td>
                  )}
                  <td>{item.method}</td>
                  <td className="partner-activity-ref">{item.route}</td>
                  <td className="partner-activity-nowrap">
                    <span className={httpStatusBadgeClass(item.statusCode)}>{item.statusCode}</span>
                    <span className="text-steel"> {formatDuration(item.durationMs)}</span>
                  </td>
                  <td>{item.errorCode ?? '—'}</td>
                  <td className="partner-activity-ref">{item.externalReference ?? '—'}</td>
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
