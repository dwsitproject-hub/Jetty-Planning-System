import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../context/AuthContext'
import LanguageSwitch from '../LanguageSwitch'

export default function OperatorMobileShell({ children }) {
  const navigate = useNavigate()
  const { logout } = useAuth()
  const { t } = useTranslation('operator')

  const handleLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="operator-mobile">
      <header className="operator-mobile__shell-bar">
        <div className="operator-mobile__brand">{t('shell.brand')}</div>
        <div className="operator-mobile__shell-actions">
          <LanguageSwitch compact />
          <button type="button" className="op-btn op-btn--soft" onClick={() => navigate('/')}>
            {t('shell.exit')}
          </button>
          <button type="button" className="op-btn op-btn--soft" onClick={handleLogout}>
            {t('shell.logout')}
          </button>
        </div>
      </header>
      <div className="operator-mobile__content">{children}</div>
    </div>
  )
}
