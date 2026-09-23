import { useTranslation } from 'react-i18next'
import LanguageSwitch from './LanguageSwitch'
import '../styles/guest-branded.css'

const HERO_PHOTO = '/aerial-vessel-bg.jpg'
const BRAND_MARK = '/kpn-mark.png'

/**
 * Full-viewport guest shell for /login, /select-port, and SSO error.
 * Hero photo on the right; brand copy + form card on the open water at left.
 */
export default function GuestBrandedShell({ cardTitle, cardDescription, children }) {
  const { t } = useTranslation('common')
  const year = new Date().getFullYear()

  return (
    <div className="guest-branded">
      <img
        className="guest-branded__photo"
        src={HERO_PHOTO}
        alt=""
        fetchPriority="high"
      />
      <div className="guest-branded__scrim" aria-hidden />

      <header className="guest-branded__top">
        <div className="guest-branded__corp">
          <img src={BRAND_MARK} alt="" className="guest-branded__mark" />
          <span className="guest-branded__corp-name">{t('corpName')}</span>
        </div>
      </header>

      <div className="guest-branded__stage">
        <div className="guest-branded__panel">
          <div className="guest-branded__hero">
            <h1 className="guest-branded__hero-title">{t('appName')}</h1>
            <span className="guest-branded__hero-accent" aria-hidden />
            <p className="guest-branded__hero-pitch">{t('loginPitch')}</p>
          </div>

          <div className="guest-branded__card">
            <div className="guest-branded__card-top">
              <div className="guest-branded__card-heading">
                {cardTitle ? <h2 className="guest-branded__card-title">{cardTitle}</h2> : null}
                {cardDescription ? (
                  <p className="guest-branded__card-desc">{cardDescription}</p>
                ) : null}
              </div>
              <LanguageSwitch className="guest-branded__lang" compact />
            </div>
            <div className="guest-branded__body">{children}</div>
          </div>
        </div>
      </div>

      <footer className="guest-branded__footer">
        {t('copyright', { year })}
      </footer>
    </div>
  )
}
