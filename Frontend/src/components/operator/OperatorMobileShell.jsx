import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'

export default function OperatorMobileShell({ children }) {
  const navigate = useNavigate()
  const { logout } = useAuth()

  const handleLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="operator-mobile">
      <header className="operator-mobile__shell-bar">
        <div className="operator-mobile__brand">Operator Mode</div>
        <div className="operator-mobile__shell-actions">
          <button type="button" className="op-btn op-btn--soft" onClick={() => navigate('/')}>
            Exit
          </button>
          <button type="button" className="op-btn op-btn--soft" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </header>
      <div className="operator-mobile__content">{children}</div>
    </div>
  )
}
