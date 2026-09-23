import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import '../styles/allocation.css'

const MASTER_SECTIONS = [
  {
    id: 'site',
    titleKey: 'masterSectionSiteTitle',
    hintKey: 'masterSectionSiteHint',
    items: [
      { path: '/master/port', titleKey: 'masterHubPortTitle', descKey: 'masterHubPortDesc', badgeKey: 'masterBadgeSite', badgeKind: 'site' },
    ],
  },
  {
    id: 'this-port',
    titleKey: 'masterSectionThisPortTitle',
    hintKey: 'masterSectionThisPortHint',
    items: [
      { path: '/master/jetty', titleKey: 'masterHubJettyTitle', descKey: 'masterHubJettyDesc', badgeKey: 'masterBadgePerPort', badgeKind: 'per-port' },
      { path: '/master/jetty-layout', titleKey: 'masterHubJettyLayoutTitle', descKey: 'masterHubJettyLayoutDesc', badgeKey: 'masterBadgePerPort', badgeKind: 'per-port' },
      { path: '/master/tanks', titleKey: 'masterHubTanksTitle', descKey: 'masterHubTanksDesc', badgeKey: 'masterBadgePerPort', badgeKind: 'per-port' },
      { path: '/tank-farm', titleKey: 'tankFarmTitle', descKey: 'tankFarmDesc', badgeKey: 'masterBadgePerPort', badgeKind: 'per-port' },
    ],
  },
  {
    id: 'all-ports',
    titleKey: 'masterSectionAllPortsTitle',
    hintKey: 'masterSectionAllPortsHint',
    items: [
      { path: '/master/si-term', titleKey: 'masterHubSiTermTitle', descKey: 'masterHubSiTermDesc', badgeKey: 'masterBadgeShared', badgeKind: 'shared' },
      { path: '/master/si-shipper', titleKey: 'masterHubSiShipperTitle', descKey: 'masterHubSiShipperDesc', badgeKey: 'masterBadgeShared', badgeKind: 'shared' },
      { path: '/master/si-loading-port', titleKey: 'masterHubSiLoadingPortTitle', descKey: 'masterHubSiLoadingPortDesc', badgeKey: 'masterBadgeShared', badgeKind: 'shared' },
      { path: '/master/si-surveyor', titleKey: 'masterHubSiSurveyorTitle', descKey: 'masterHubSiSurveyorDesc', badgeKey: 'masterBadgeShared', badgeKind: 'shared' },
      { path: '/master/si-agent', titleKey: 'masterHubSiAgentTitle', descKey: 'masterHubSiAgentDesc', badgeKey: 'masterBadgeShared', badgeKind: 'shared' },
      {
        path: '/master/si-commodity',
        titleKey: 'masterHubSiCommodityTitle',
        descKey: 'masterHubSiCommodityDesc',
        noteKey: 'masterHubSiCommodityNote',
        badgeKey: 'masterBadgeShared',
        badgeKind: 'shared',
      },
      { path: '/master/freight-terms', titleKey: 'masterHubFreightTermsTitle', descKey: 'masterHubFreightTermsDesc', badgeKey: 'masterBadgeShared', badgeKind: 'shared' },
    ],
  },
]

export default function Master() {
  const { t } = useTranslation('pages')

  return (
    <div className="allocation-page">
      <h1 className="page-title">{t('masterMenu')}</h1>
      <p className="allocation-page__intro">{t('masterIntro')}</p>

      {MASTER_SECTIONS.map((section) => (
        <section key={section.id} className="master-hub-section" aria-labelledby={`master-section-${section.id}`}>
          <h2 id={`master-section-${section.id}`} className="master-hub-section__title">
            {t(section.titleKey)}
          </h2>
          <p className="master-hub-section__hint">{t(section.hintKey)}</p>
          <div className="reporting-list__grid">
            {section.items.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className="reporting-list__card card"
              >
                <span className={`master-hub-badge master-hub-badge--${item.badgeKind}`}>
                  {t(item.badgeKey)}
                </span>
                <h3 className="reporting-list__card-title">{t(item.titleKey)}</h3>
                <p className="reporting-list__card-desc">{t(item.descKey)}</p>
                {item.noteKey ? (
                  <p className="master-hub-card__note">{t(item.noteKey)}</p>
                ) : null}
                <span className="reporting-list__card-link">{t('hubOpenCard')}</span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
