import { useTranslation } from 'react-i18next'
import LanguageSwitch from './LanguageSwitch'
import '../styles/guest-branded.css'

/**
 * Full-viewport login / choose-port shell: harbor background, centered card, shared header.
 */
export default function GuestBrandedShell({ cardTitle, cardDescription, children }) {
  const { t } = useTranslation('common')
  const loginBgUrl = '/kpn-header.png'
  const brandLogoUrl = '/kpn-header.png'
  return (
    <div className="guest-branded" style={{ '--guest-branded-bg': `url(${loginBgUrl})` }}>
      <div className="guest-branded__bg" aria-hidden />
      <div className="guest-branded__inner">
        <div className="guest-branded__card">
          <div className="guest-branded__card-top">
            <header className="guest-branded__brand">
              <img src={brandLogoUrl} alt="" className="guest-branded__logo" />
              <div className="guest-branded__brand-text">
                <h1 className="guest-branded__product">{t('appName')}</h1>
                <p className="guest-branded__tagline">{t('tagline')}</p>
              </div>
            </header>
            <LanguageSwitch className="guest-branded__lang" compact />
          </div>
          <hr className="guest-branded__rule" />
          {cardTitle ? <h2 className="guest-branded__card-title">{cardTitle}</h2> : null}
          {cardDescription ? <p className="guest-branded__card-desc">{cardDescription}</p> : null}
          <div className="guest-branded__body">{children}</div>
        </div>
      </div>
    </div>
  )
}
