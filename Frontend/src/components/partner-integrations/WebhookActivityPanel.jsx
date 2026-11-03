import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchWebhookActivity, retryWebhookActivity } from '../../api/integrationAdmin'
import ActivityFilterBar from './ActivityFilterBar.jsx'
import ActivityPanelBody from './ActivityPanelBody.jsx'
import WebhookActivityTable from './WebhookActivityTable.jsx'
import { SCOPE_PARTNER, buildWebhookParams } from './partnerActivityParams.js'
import usePagedActivity from './usePagedActivity.js'

const EVENT_TYPES = ['status.changed', 'schedule.updated']

function endpointHostLabel(url) {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

export default function WebhookActivityPanel({
  scope,
  keyId,
  endpointId,
  onEndpointChange,
  endpoints,
  hasActiveWebhook,
  windowHours,
  onWindowChange,
  autoRefresh,
  onAutoRefresh,
  onNotify,
  onChanged,
  onAddWebhook,
}) {
  const { t, i18n } = useTranslation('pages')
  const [status, setStatus] = useState('')
  const [eventType, setEventType] = useState('')
  const [q, setQ] = useState('')

  const params = useMemo(
    () => buildWebhookParams({ scope, keyId, endpointId, status, eventType, q }),
    [scope, keyId, endpointId, status, eventType, q]
  )
  const { items, nextCursor, loading, loadingMore, error, updatedAt, reload, loadMore } = usePagedActivity(
    fetchWebhookActivity,
    params,
    windowHours,
    autoRefresh
  )

  const handleRetry = useCallback(
    async (deliveryId) => {
      try {
        await retryWebhookActivity(deliveryId)
        onNotify({ kind: 'success', text: t('adminPartnerApiDeliveryRetryToast') })
        reload()
        onChanged()
      } catch (e) {
        onNotify({ kind: 'error', text: e?.message || 'Retry failed' })
      }
    },
    [onNotify, onChanged, reload, t]
  )

  const inPartner = scope === SCOPE_PARTNER
  const selects = [
    {
      id: 'event',
      label: t('partnerActColEvent'),
      value: eventType,
      onChange: setEventType,
      options: [{ value: '', label: t('partnerActAllEvents') }, ...EVENT_TYPES.map((e) => ({ value: e, label: e }))],
    },
  ]
  if (inPartner && endpoints.length > 0) {
    selects.push({
      id: 'endpoint',
      label: t('partnerActEndpointLabel'),
      value: endpointId ? String(endpointId) : '',
      onChange: (v) => onEndpointChange(v ? Number(v) : null),
      options: [
        { value: '', label: t('partnerActAllEndpoints') },
        ...endpoints.map((ep) => ({ value: String(ep.id), label: endpointHostLabel(ep.url) })),
      ],
    })
  }

  const noWebhook = inPartner && !hasActiveWebhook
  const emptyNode = noWebhook ? (
    <>
      <p>{t('partnerActEmptyNoWebhook')}</p>
      {onAddWebhook && (
        <button type="button" className="btn btn--secondary btn--small" onClick={onAddWebhook}>
          {t('adminPartnerApiAddWebhook')}
        </button>
      )}
    </>
  ) : (
    t('partnerActEmptyWebhooks')
  )

  return (
    <>
      <ActivityFilterBar
        windowHours={windowHours}
        onWindowChange={onWindowChange}
        chipsLabel={t('adminPartnerApiColStatus')}
        chips={[
          { value: '', label: t('partnerActAll') },
          { value: 'failed', label: t('partnerActChipFailed') },
          { value: 'pending', label: t('partnerActChipPending') },
          { value: 'sent', label: t('partnerActChipSent') },
        ]}
        chipValue={status}
        onChip={setStatus}
        selects={selects}
        search={q}
        onSearch={setQ}
        searchPlaceholder={t('partnerActSearchWebhook')}
        autoRefresh={autoRefresh}
        onAutoRefresh={onAutoRefresh}
        updatedLabel={updatedAt ? t('partnerActUpdated', { time: updatedAt.toLocaleTimeString(i18n.language) }) : ''}
      />
      <ActivityPanelBody
        loading={loading}
        error={error}
        onRetry={reload}
        isEmpty={items.length === 0}
        emptyNode={emptyNode}
        hasMore={Boolean(nextCursor)}
        loadingMore={loadingMore}
        onLoadMore={loadMore}
      >
        <WebhookActivityTable items={items} showPartner={!inPartner} onRetry={handleRetry} />
      </ActivityPanelBody>
    </>
  )
}
