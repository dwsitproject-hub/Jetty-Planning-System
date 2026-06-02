import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getOidcStartUrl, login } from '../api/auth'
import { fetchMyPorts } from '../api/usersApi'
import { getSelectedPortId } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useRbac } from '../context/RbacContext'
import { ApiError } from '../api/client'
import GuestBrandedShell from '../components/GuestBrandedShell'
import { useTranslation } from 'react-i18next'
import { MAX_LOGIN_PASSWORD_CHARS, MAX_LOGIN_USERNAME_CHARS } from '../constants/inputLimits'

export default function Login() {
  const { t } = useTranslation('auth')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  const { refreshMe } = useAuth()
  const { refresh: refreshRbac } = useRbac()

  const handleSsoClick = () => {
    const url = getOidcStartUrl()
    try {
      window.top.location.assign(url)
    } catch {
      window.location.assign(url)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await login(username.trim(), password)
      await refreshMe()
      await refreshRbac()
      let goSelectPort = false
      try {
        const portsData = await fetchMyPorts()
        const ports = Array.isArray(portsData?.assignedPorts) ? portsData.assignedPorts : []
        const stored = getSelectedPortId()
        const storedValid =
          stored != null && ports.some((p) => Number(p.id) === Number(stored))
        goSelectPort = ports.length > 1 && !storedValid
      } catch {
        goSelectPort = false
      }
      navigate(goSelectPort ? '/select-port' : '/')
    } catch (err) {
      const msg =
        err instanceof ApiError && err.status === 401
          ? err.message || t('invalidCredentials')
          : err?.message || t('loginFailed')
      setError(msg)
    } finally {
      setBusy(false)
    }
  }

  return (
    <GuestBrandedShell>
      <form onSubmit={handleSubmit}>
        {error ? <p className="guest-branded__error">{error}</p> : null}
        <label className="guest-branded__label" htmlFor="login-username">
          {t('username')}
        </label>
        <input
          id="login-username"
          className="guest-branded__input"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          maxLength={MAX_LOGIN_USERNAME_CHARS}
          autoComplete="username"
          disabled={busy}
        />
        <label className="guest-branded__label" htmlFor="login-password">
          Password
        </label>
        <input
          id="login-password"
          className="guest-branded__input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          maxLength={MAX_LOGIN_PASSWORD_CHARS}
          autoComplete="current-password"
          disabled={busy}
        />
        <button type="submit" className="btn btn--primary guest-branded__submit" disabled={busy}>
          {busy ? t('signingIn') : t('signIn')}
        </button>
      </form>
      <button
        type="button"
        className="btn guest-branded__submit"
        style={{ marginTop: 8 }}
        onClick={handleSsoClick}
        disabled={busy}
      >
        Sign in with SSO
      </button>
    </GuestBrandedShell>
  )
}
