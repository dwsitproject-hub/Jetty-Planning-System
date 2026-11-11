import { useTranslation } from 'react-i18next'

/** Loading, error (with retry) and empty lines under the queue toolbar. */
export default function QcQueueMessages({ queue }) {
  const { t } = useTranslation(queue.ns)
  const { loading, error, rows, visible, reload } = queue
  const emptyMessage = rows.length === 0 ? t('queue.noVessels') : t('queue.noMatches')

  return (
    <>
      {loading ? <p className="operator-queue__status">{t('queue.loading')}</p> : null}
      {error ? (
        <div className="operator-error-banner qc-error-row" role="alert">
          <span>{error}</span>
          <button type="button" className="op-btn op-btn--soft" onClick={reload}>
            {t('queue.retry')}
          </button>
        </div>
      ) : null}
      {!loading && !error && visible.length === 0 ? <p className="operator-queue__status">{emptyMessage}</p> : null}
    </>
  )
}
