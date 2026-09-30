import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import MasterSourceBadge from '../components/MasterSourceBadge.jsx'
import '../styles/allocation.css'

const SOURCE_LEGEND = [
  { kind: 'datahub', shortKey: 'masterSourceDataHubShort' },
  { kind: 'local', shortKey: 'masterSourceLocalShort' },
  { kind: 'tankvision', shortKey: 'masterSourceTankvisionShort' },
]

const MASTER_SECTIONS = [
  {
    id: 'site',
    titleKey: 'masterSectionSiteTitle',
    hintKey: 'masterSectionSiteHint',
    items: [
      { path: '/master/port', titleKey: 'masterHubPortTitle', descKey: 'masterHubPortDesc', badgeKey: 'masterBadgeSite', badgeKind: 'site', sourceKind: 'local' },
    ],
  },
  {
    id: 'this-port',
    titleKey: 'masterSectionThisPortTitle',
    hintKey: 'masterSectionThisPortHint',
    items: [
      { path: '/master/jetty', titleKey: 'masterHubJettyTitle', descKey: 'masterHubJettyDesc', badgeKey: 'masterBadgePerPort', badgeKind: 'per-port', sourceKind: 'local' },
      { path: '/master/jetty-layout', titleKey: 'masterHubJettyLayoutTitle', descKey: 'masterHubJettyLayoutDesc', badgeKey: 'masterBadgePerPort', badgeKind: 'per-port', sourceKind: 'local' },
      { path: '/master/tanks', titleKey: 'masterHubTanksTitle', descKey: 'masterHubTanksDesc', badgeKey: 'masterBadgePerPort', badgeKind: 'per-port', sourceKind: 'local' },
      { path: '/tank-farm', titleKey: 'tankFarmTitle', descKey: 'tankFarmDesc', badgeKey: 'masterBadgePerPort', badgeKind: 'per-port', sourceKind: 'tankvision' },
    ],
  },
  {
    id: 'all-ports',
    titleKey: 'masterSectionAllPortsTitle',
    hintKey: 'masterSectionAllPortsHint',
    items: [
      { path: '/master/vessel', titleKey: 'masterHubVesselTitle', descKey: 'masterHubVesselDesc', badgeKey: 'masterBadgeShared', badgeKind: 'shared', sourceKind: 'datahub' },
      { path: '/master/si-term', titleKey: 'masterHubSiTermTitle', descKey: 'masterHubSiTermDesc', badgeKey: 'masterBadgeShared', badgeKind: 'shared', sourceKind: 'datahub' },
      { path: '/master/si-shipper', titleKey: 'masterHubSiShipperTitle', descKey: 'masterHubSiShipperDesc', badgeKey: 'masterBadgeShared', badgeKind: 'shared', sourceKind: 'local' },
      { path: '/master/si-loading-port', titleKey: 'masterHubSiLoadingPortTitle', descKey: 'masterHubSiLoadingPortDesc', badgeKey: 'masterBadgeShared', badgeKind: 'shared', sourceKind: 'local' },
      { path: '/master/si-surveyor', titleKey: 'masterHubSiSurveyorTitle', descKey: 'masterHubSiSurveyorDesc', badgeKey: 'masterBadgeShared', badgeKind: 'shared', sourceKind: 'local' },
      { path: '/master/si-agent', titleKey: 'masterHubSiAgentTitle', descKey: 'masterHubSiAgentDesc', badgeKey: 'masterBadgeShared', badgeKind: 'shared', sourceKind: 'local' },
      {
        path: '/master/si-commodity',
        titleKey: 'masterHubSiCommodityTitle',
        descKey: 'masterHubSiCommodityDesc',
        noteKey: 'masterHubSiCommodityNote',
        badgeKey: 'masterBadgeShared',
        badgeKind: 'shared',
        sourceKind: 'datahub',
      },
      { path: '/master/freight-terms', titleKey: 'masterHubFreightTermsTitle', descKey: 'masterHubFreightTermsDesc', badgeKey: 'masterBadgeShared', badgeKind: 'shared', sourceKind: 'local' },
    ],
  },
]

export default function Master() {
  const { t } = useTranslation('pages')

  return (
    <div className="allocation-page">
      <h1 className="page-title">{t('masterMenu')}</h1>
      <p className="allocation-page__intro">{t('masterIntro')}</p>
      <p className="master-source-legend">
        <span className="master-source-legend__label">{t('masterSourceLegendLabel')}</span>
        {SOURCE_LEGEND.map((item) => (
          <span key={item.kind} className="master-source-legend__item">
            <MasterSourceBadge kind={item.kind} />
            <span>{t(item.shortKey)}</span>
          </span>
        ))}
      </p>

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
                <span className="master-hub-card__badges">
                  <span className={`master-hub-badge master-hub-badge--${item.badgeKind}`}>
                    {t(item.badgeKey)}
                  </span>
                  <MasterSourceBadge kind={item.sourceKind} />
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
