import { useTranslation } from 'react-i18next'

/** Shared loading / error / empty / load-more shell for the Activity card panels. */
export default function ActivityPanelBody({
  loading,
  error,
  onRetry,
  isEmpty,
  emptyNode,
  hasMore,
  loadingMore,
  onLoadMore,
  children,
}) {
  const { t } = useTranslation('pages')

  if (loading) return <p className="text-steel">{t('adminPartnerApiLoading')}</p>

  if (error) {
    return (
      <p className="partner-health__error" role="alert">
        {t('partnerActLoadError')} <span className="text-steel">{error}</span>{' '}
        <button type="button" className="partner-link-action" onClick={onRetry}>
          {t('adminPartnerApiRetry')}
        </button>
      </p>
    )
  }

  if (isEmpty) return <div className="partner-integrations-empty">{emptyNode}</div>

  return (
    <>
      {children}
      {hasMore && (
        <div className="partner-activity-more">
          <button type="button" className="btn btn--secondary btn--small" onClick={onLoadMore} disabled={loadingMore}>
            {loadingMore ? t('adminPartnerApiLoading') : t('partnerActLoadMore')}
          </button>
        </div>
      )}
    </>
  )
}
