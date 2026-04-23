import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import '../styles/allocation.css'

const REPORTS = [
  {
    path: '/reporting/daily-activities',
    titleKey: 'reportingDailyTitle',
    descKey: 'reportingDailyDesc',
  },
  {
    path: '/reporting/vessel',
    titleKey: 'reportingVesselTitle',
    descKey: 'reportingVesselDesc',
  },
]

export default function Reporting() {
  const { t } = useTranslation('pages')

  return (
    <div className="allocation-page">
      <h1 className="page-title">{t('reporting')}</h1>
      <p className="allocation-page__intro">{t('reportingIntro')}</p>

      <section className="reporting-list" aria-label={t('reporting')}>
        <div className="reporting-list__grid">
          {REPORTS.map((report) => (
            <Link
              key={report.path}
              to={report.path}
              className="reporting-list__card card"
            >
              <h2 className="reporting-list__card-title">{t(report.titleKey)}</h2>
              <p className="reporting-list__card-desc">{t(report.descKey)}</p>
              <span className="reporting-list__card-link">{t('reportingViewReport')}</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}
