import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import '../styles/allocation.css'

const MASTER_ITEMS = [
  { path: '/master/port', titleKey: 'masterHubPortTitle', descKey: 'masterHubPortDesc' },
  { path: '/master/jetty', titleKey: 'masterHubJettyTitle', descKey: 'masterHubJettyDesc' },
  { path: '/master/jetty-layout', titleKey: 'masterHubJettyLayoutTitle', descKey: 'masterHubJettyLayoutDesc' },
  { path: '/master/si-term', titleKey: 'masterHubSiTermTitle', descKey: 'masterHubSiTermDesc' },
  { path: '/master/si-shipper', titleKey: 'masterHubSiShipperTitle', descKey: 'masterHubSiShipperDesc' },
  { path: '/master/si-loading-port', titleKey: 'masterHubSiLoadingPortTitle', descKey: 'masterHubSiLoadingPortDesc' },
  { path: '/master/si-surveyor', titleKey: 'masterHubSiSurveyorTitle', descKey: 'masterHubSiSurveyorDesc' },
  { path: '/master/si-agent', titleKey: 'masterHubSiAgentTitle', descKey: 'masterHubSiAgentDesc' },
  { path: '/master/si-commodity', titleKey: 'masterHubSiCommodityTitle', descKey: 'masterHubSiCommodityDesc' },
  { path: '/master/freight-terms', titleKey: 'masterHubFreightTermsTitle', descKey: 'masterHubFreightTermsDesc' },
]

export default function Master() {
  const { t } = useTranslation('pages')

  return (
    <div className="allocation-page">
      <h1 className="page-title">{t('masterMenu')}</h1>
      <p className="allocation-page__intro">{t('masterIntro')}</p>

      <section className="reporting-list" aria-label={t('masterMenu')}>
        <div className="reporting-list__grid">
          {MASTER_ITEMS.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className="reporting-list__card card"
            >
              <h2 className="reporting-list__card-title">{t(item.titleKey)}</h2>
              <p className="reporting-list__card-desc">{t(item.descKey)}</p>
              <span className="reporting-list__card-link">{t('hubOpenCard')}</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}
