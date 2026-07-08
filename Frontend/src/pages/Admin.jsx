import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import '../styles/allocation.css'

const ADMIN_ITEMS = [
  { path: '/admin/users', titleKey: 'adminHubUsersTitle', descKey: 'adminHubUsersDesc' },
  { path: '/admin/roles', titleKey: 'adminHubRolesTitle', descKey: 'adminHubRolesDesc' },
  { path: '/admin/partner-api', titleKey: 'adminHubPartnerApiTitle', descKey: 'adminHubPartnerApiDesc' },
]

export default function Admin() {
  const { t } = useTranslation('pages')

  return (
    <div className="allocation-page">
      <h1 className="page-title">{t('admin')}</h1>
      <p className="allocation-page__intro">{t('adminIntro')}</p>

      <section className="reporting-list" aria-label={t('admin')}>
        <div className="reporting-list__grid">
          {ADMIN_ITEMS.map((item) => (
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
