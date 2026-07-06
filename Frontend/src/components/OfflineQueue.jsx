import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useOfflineQueue } from '../hooks/useOfflineQueue'
import { formatDateTimeDisplay } from '../utils/formatDateTimeDisplay'

/**
 * Floating "pending sync" badge + queue viewer. Additive and native-only in
 * practice: the queue is always empty on the web, so this renders nothing there.
 */
export default function OfflineQueue() {
  const { t } = useTranslation()
  const { rows, pendingCount, conflictCount, syncing, online, discard, retry, syncNow } =
    useOfflineQueue()
  const [open, setOpen] = useState(false)

  if (rows.length === 0) return null

  const statusLabel = (s) =>
    ({
      pending: t('offlineQueuePending', { defaultValue: 'Pending' }),
      sending: t('offlineQueueSending', { defaultValue: 'Sending…' }),
      failed: t('offlineQueueFailed', { defaultValue: 'Failed' }),
      conflict: t('offlineQueueConflict', { defaultValue: 'Conflict' }),
    })[s] || s

  const badgeClass =
    conflictCount > 0
      ? ' offline-queue__badge--conflict'
      : pendingCount > 0
        ? ' offline-queue__badge--active'
        : ''

  return (
    <>
      <button
        type="button"
        className={`offline-queue__badge${badgeClass}`}
        onClick={() => setOpen((v) => !v)}
        aria-label={t('offlineQueueOpen', { defaultValue: 'Pending changes to sync' })}
      >
        {syncing ? '⟳ ' : ''}
        {t('offlineQueueBadge', { defaultValue: 'Pending' })}: {rows.length}
        {conflictCount > 0 ? ` · ${conflictCount}⚠` : ''}
      </button>

      {open ? (
        <div className="offline-queue__panel" role="dialog" aria-label="Pending changes">
          <div className="offline-queue__panel-head">
            <strong>{t('offlineQueueTitle', { defaultValue: 'Pending changes' })}</strong>
            <button type="button" className="offline-queue__close" onClick={() => setOpen(false)}>
              ✕
            </button>
          </div>
          <p className="offline-queue__hint">
            {online
              ? t('offlineQueueHintOnline', {
                  defaultValue: 'Syncing to the server. Items clear as they succeed.',
                })
              : t('offlineQueueHint', {
                  defaultValue: 'These will sync automatically when the connection returns.',
                })}
          </p>
          <button
            type="button"
            className="offline-queue__sync"
            onClick={syncNow}
            disabled={!online || syncing}
          >
            {syncing
              ? t('offlineQueueSyncing', { defaultValue: 'Syncing…' })
              : t('offlineQueueSyncNow', { defaultValue: 'Sync now' })}
          </button>

          <ul className="offline-queue__list">
            {rows.map((r) => {
              const isConflict = r.status === 'conflict'
              const isFailed = r.status === 'failed'
              return (
                <li key={r.id} className={`offline-queue__item offline-queue__item--${r.status}`}>
                  <div className="offline-queue__item-main">
                    <span className="offline-queue__entity">{r.entity || r.path}</span>
                    <span className="offline-queue__status">{statusLabel(r.status)}</span>
                  </div>
                  <div className="offline-queue__item-sub">
                    {r.method} {r.path} · {formatDateTimeDisplay(new Date(r.createdAt).toISOString())}
                  </div>
                  {r.lastError ? <div className="offline-queue__error">{r.lastError}</div> : null}
                  {isConflict ? (
                    <div className="offline-queue__actions">
                      <button type="button" className="offline-queue__retry" onClick={() => retry(r.id)} disabled={!online || syncing}>
                        {t('offlineQueueResendMine', { defaultValue: 'Resend mine' })}
                      </button>
                      <button type="button" className="offline-queue__discard" onClick={() => discard(r.id)}>
                        {t('offlineQueueKeepServer', { defaultValue: 'Keep server version' })}
                      </button>
                    </div>
                  ) : (
                    <div className="offline-queue__actions">
                      {isFailed ? (
                        <button type="button" className="offline-queue__retry" onClick={() => retry(r.id)} disabled={!online || syncing}>
                          {t('offlineQueueRetry', { defaultValue: 'Retry' })}
                        </button>
                      ) : null}
                      <button type="button" className="offline-queue__discard" onClick={() => discard(r.id)}>
                        {t('offlineQueueDiscard', { defaultValue: 'Discard' })}
                      </button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}
    </>
  )
}
