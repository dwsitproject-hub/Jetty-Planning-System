import { forwardRef, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ApiRequestActivityPanel from './ApiRequestActivityPanel.jsx'
import WebhookActivityPanel from './WebhookActivityPanel.jsx'
import { DEFAULT_WINDOW_HOURS } from './partnerActivityFormat.js'
import { SCOPE_ALL, SCOPE_PARTNER } from './partnerActivityParams.js'

export const TAB_WEBHOOKS = 'webhooks'
export const TAB_API = 'api'
const TABS = [TAB_WEBHOOKS, TAB_API]

/**
 * Activity card: webhook deliveries and inbound API requests for the selected partner (or all partners).
 * `focus` ({ tab, endpointId, nonce }) lets the Webhooks table deep-link into a filtered view.
 */
const PartnerActivityCard = forwardRef(function PartnerActivityCard(
  { keyId, endpoints, hasActiveWebhook, focus, onNotify, onChanged, onAddWebhook },
  ref
) {
  const { t } = useTranslation('pages')
  const [tab, setTab] = useState(TAB_WEBHOOKS)
  const [scope, setScope] = useState(SCOPE_PARTNER)
  const [windowHours, setWindowHours] = useState(DEFAULT_WINDOW_HOURS)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [endpointId, setEndpointId] = useState(null)

  useEffect(() => {
    if (!focus) return
    setTab(focus.tab)
    setScope(SCOPE_PARTNER)
    setEndpointId(focus.endpointId ?? null)
  }, [focus])

  const handleTabKey = useCallback((e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    setTab((prev) => TABS[(TABS.indexOf(prev) + 1) % TABS.length])
  }, [])

  const common = { scope, keyId, windowHours, onWindowChange: setWindowHours, autoRefresh, onAutoRefresh: setAutoRefresh }

  return (
    <section className="card partner-activity" ref={ref} aria-label={t('partnerActTitle')}>
      <div className="card__header-row">
        <h2 className="card__title">{t('partnerActTitle')}</h2>
        <div className="partner-activity__scope" role="group" aria-label={t('partnerActScopeLabel')}>
          {[SCOPE_PARTNER, SCOPE_ALL].map((s) => (
            <button
              key={s}
              type="button"
              className={`partner-chip${scope === s ? ' is-active' : ''}`}
              aria-pressed={scope === s}
              onClick={() => setScope(s)}
            >
              {s === SCOPE_PARTNER ? t('partnerActScopeThis') : t('partnerActScopeAll')}
            </button>
          ))}
        </div>
      </div>

      <div className="partner-tabs" role="tablist" aria-label={t('partnerActTitle')} onKeyDown={handleTabKey}>
        {TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`partner-activity-tab-${id}`}
            aria-selected={tab === id}
            aria-controls="partner-activity-panel"
            tabIndex={tab === id ? 0 : -1}
            className={`partner-tabs__tab${tab === id ? ' is-active' : ''}`}
            onClick={() => setTab(id)}
          >
            {id === TAB_WEBHOOKS ? t('partnerActTabWebhooks') : t('partnerActTabApi')}
          </button>
        ))}
      </div>

      <div id="partner-activity-panel" role="tabpanel" aria-labelledby={`partner-activity-tab-${tab}`}>
        {tab === TAB_WEBHOOKS ? (
          <WebhookActivityPanel
            {...common}
            endpointId={endpointId}
            onEndpointChange={setEndpointId}
            endpoints={endpoints}
            hasActiveWebhook={hasActiveWebhook}
            onNotify={onNotify}
            onChanged={onChanged}
            onAddWebhook={onAddWebhook}
          />
        ) : (
          <ApiRequestActivityPanel {...common} />
        )}
      </div>
    </section>
  )
})

export default PartnerActivityCard
