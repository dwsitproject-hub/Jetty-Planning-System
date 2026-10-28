import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchApiRequestActivity } from '../../api/integrationAdmin'
import ActivityFilterBar from './ActivityFilterBar.jsx'
import ActivityPanelBody from './ActivityPanelBody.jsx'
import ApiRequestActivityTable from './ApiRequestActivityTable.jsx'
import { SCOPE_PARTNER, buildApiParams } from './partnerActivityParams.js'
import usePagedActivity from './usePagedActivity.js'

const METHODS = ['GET', 'POST', 'PATCH']

export default function ApiRequestActivityPanel({
  scope,
  keyId,
  windowHours,
  onWindowChange,
  autoRefresh,
  onAutoRefresh,
}) {
  const { t, i18n } = useTranslation('pages')
  const [statusClass, setStatusClass] = useState('')
  const [method, setMethod] = useState('')
  const [route, setRoute] = useState('')
  const [q, setQ] = useState('')

  const params = useMemo(
    () => buildApiParams({ scope, keyId, statusClass, method, route, q }),
    [scope, keyId, statusClass, method, route, q]
  )
  const { items, nextCursor, extra, loading, loadingMore, error, updatedAt, reload, loadMore } = usePagedActivity(
    fetchApiRequestActivity,
    params,
    windowHours,
    autoRefresh
  )

  const routeOptions = useMemo(() => {
    const fromServer = Array.isArray(extra.routeOptions) ? extra.routeOptions : []
    const all = route && !fromServer.includes(route) ? [route, ...fromServer] : fromServer
    return [{ value: '', label: t('partnerActAll') }, ...all.map((r) => ({ value: r, label: r }))]
  }, [extra.routeOptions, route, t])

  const selects = [
    {
      id: 'method',
      label: t('partnerActMethodLabel'),
      value: method,
      onChange: setMethod,
      options: [{ value: '', label: t('partnerActAll') }, ...METHODS.map((m) => ({ value: m, label: m }))],
    },
    { id: 'route', label: t('partnerActRouteLabel'), value: route, onChange: setRoute, options: routeOptions },
  ]

  return (
    <>
      <ActivityFilterBar
        windowHours={windowHours}
        onWindowChange={onWindowChange}
        chipsLabel={t('partnerActColResult')}
        chips={[
          { value: '', label: t('partnerActAll') },
          { value: '2xx', label: '2xx' },
          { value: 'error', label: t('partnerActChipErrors') },
          { value: '4xx', label: '4xx' },
          { value: '5xx', label: '5xx' },
        ]}
        chipValue={statusClass}
        onChip={setStatusClass}
        selects={selects}
        search={q}
        onSearch={setQ}
        searchPlaceholder={t('partnerActSearchApi')}
        autoRefresh={autoRefresh}
        onAutoRefresh={onAutoRefresh}
        updatedLabel={updatedAt ? t('partnerActUpdated', { time: updatedAt.toLocaleTimeString(i18n.language) }) : ''}
      />
      <ActivityPanelBody
        loading={loading}
        error={error}
        onRetry={reload}
        isEmpty={items.length === 0}
        emptyNode={t('partnerActEmptyApi')}
        hasMore={Boolean(nextCursor)}
        loadingMore={loadingMore}
        onLoadMore={loadMore}
      >
        <ApiRequestActivityTable items={items} showPartner={scope !== SCOPE_PARTNER} />
      </ActivityPanelBody>
    </>
  )
}
