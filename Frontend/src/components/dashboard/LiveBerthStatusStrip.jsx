import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

export default function LiveBerthStatusStrip({ pipelineLive, loading }) {
  const { t } = useTranslation('dashboard')

  return (
    <section className="card v2-live-berth-status" aria-label={t('v2LiveBerthStatusTitle')}>
      <div className="v2-pipeline__header">
        <h2 className="card__title">
          {t('v2LiveBerthStatusTitle')}{' '}
          <span className="v2-basis-chip">{t('v2BasisLive')}</span>
        </h2>
      </div>
      <div className={`v2-live-berth-status__row${loading ? ' v2-live-berth-status__row--loading' : ''}`}>
        <Link to="/at-berth" className="v2-live-berth-status__chip v2-live-berth-status__chip--atberth">
          <span className="v2-live-berth-status__label">{t('pipelineAtBerth')}</span>
          <strong>{loading ? '—' : pipelineLive.atBerth}</strong>
        </Link>
        <Link to="/verification" className="v2-live-berth-status__chip v2-live-berth-status__chip--ready">
          <span className="v2-live-berth-status__label">{t('v2PipelineReadyToSail')}</span>
          <strong>{loading ? '—' : pipelineLive.readyToSail}</strong>
        </Link>
        <div className={`v2-live-berth-status__chip v2-live-berth-status__chip--pending${pipelineLive.signoffRequested > 0 ? ' is-active' : ''}`}>
          <span className="v2-live-berth-status__label">{t('clearancePendingSignOff')}</span>
          <strong>{loading ? '—' : pipelineLive.signoffRequested}</strong>
        </div>
      </div>
    </section>
  )
}
