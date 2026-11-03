import { useTranslation } from 'react-i18next'
import { formatWhen, relativeTime, PENDING_STALE_MS } from './partnerActivityFormat.js'

function Stat({ label, tone, children }) {
  return (
    <div className={`partner-health__stat${tone ? ` partner-health__stat--${tone}` : ''}`}>
      <div className="partner-health__label">{label}</div>
      <div className="partner-health__value">{children}</div>
    </div>
  )
}

function When({ iso, prefix, never, locale }) {
  const rel = relativeTime(iso, locale)
  return (
    <div title={iso ? formatWhen(iso) : undefined}>
      {prefix} {rel ?? never}
    </div>
  )
}

/**
 * 24 h health numbers for the selected partner, plus a warning when it has no active webhook.
 * `summary` is one item from GET /integration-admin/activity/summary (or undefined while loading).
 */
export default function PartnerHealthStrip({ summary, loading, error, hours, keyActive, onRefresh }) {
  const { t, i18n } = useTranslation('pages')
  const locale = i18n.language
  const errors = summary ? summary.apiErrors4xx + summary.apiErrors5xx : 0
  const pendingStale =
    summary?.oldestPendingAt && Date.now() - new Date(summary.oldestPendingAt).getTime() > PENDING_STALE_MS
  const noWebhook = summary && keyActive && summary.activeWebhookEndpoints === 0
  const never = t('partnerActNever')

  return (
    <section className="card partner-health" aria-label={t('partnerActHealthTitle', { hours })}>
      <div className="card__header-row">
        <h2 className="card__title">{t('partnerActHealthTitle', { hours })}</h2>
        <button type="button" className="partner-link-action" onClick={onRefresh} disabled={loading}>
          {t('partnerActRefresh')}
        </button>
      </div>
      {error && <p className="partner-health__error">{error}</p>}
      {noWebhook && (
        <p className="partner-health__warning" role="alert">
          {t('partnerActNoWebhookWarning')}
        </p>
      )}
      <div className="partner-health__grid">
        <Stat label={t('partnerActApiCalls')}>{summary ? summary.apiCalls : '—'}</Stat>
        <Stat label={t('partnerActApiErrors')} tone={errors > 0 ? 'error' : null}>
          <div>{summary ? errors : '—'}</div>
          {summary && (
            <div className="partner-health__sub">
              {t('partnerActErrorSplit', { c4: summary.apiErrors4xx, c5: summary.apiErrors5xx })}
            </div>
          )}
        </Stat>
        <Stat label={t('partnerActWebhooks')} tone={summary?.webhooksFailed > 0 ? 'error' : null}>
          {summary ? (
            <>
              <div>{t('partnerActSent', { count: summary.webhooksSent })}</div>
              <div className={summary.webhooksFailed > 0 ? 'partner-health__bad' : ''}>
                {t('partnerActFailed', { count: summary.webhooksFailed })}
              </div>
              <div className={pendingStale ? 'partner-health__amber' : ''}>
                {t('partnerActPending', { count: summary.webhooksPending })}
              </div>
            </>
          ) : (
            '—'
          )}
        </Stat>
        <Stat label={t('partnerActLastActivity')}>
          {summary ? (
            <>
              <When iso={summary.lastApiCallAt} prefix={t('partnerActLastApi')} never={never} locale={locale} />
              <When iso={summary.lastWebhookSentAt} prefix={t('partnerActLastHook')} never={never} locale={locale} />
            </>
          ) : (
            '—'
          )}
        </Stat>
      </div>
    </section>
  )
}
