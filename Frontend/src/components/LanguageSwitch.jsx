import { useTranslation } from 'react-i18next'
import '../styles/language-switch.css'

/**
 * Segmented EN | ID control. Persists via i18n `languageChanged` → localStorage (`jps_locale`).
 */
export default function LanguageSwitch({ className = '', compact = false }) {
  const { i18n, t } = useTranslation('common')
  const lng = i18n.language?.startsWith('id') ? 'id' : 'en'

  const setLang = (next) => {
    if (next !== lng) void i18n.changeLanguage(next)
  }

  return (
    <div
      className={`language-switch ${compact ? 'language-switch--compact' : ''} ${className}`.trim()}
      role="group"
      aria-label={t('language.label')}
    >
      <button
        type="button"
        className={`language-switch__btn ${lng === 'en' ? 'language-switch__btn--active' : ''}`}
        onClick={() => setLang('en')}
        aria-pressed={lng === 'en'}
      >
        {t('language.enShort')}
      </button>
      <button
        type="button"
        className={`language-switch__btn ${lng === 'id' ? 'language-switch__btn--active' : ''}`}
        onClick={() => setLang('id')}
        aria-pressed={lng === 'id'}
      >
        {t('language.idShort')}
      </button>
    </div>
  )
}
