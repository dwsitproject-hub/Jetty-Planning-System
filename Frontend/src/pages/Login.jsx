import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { fetchSsoStatus, getOidcStartUrl, login } from '../api/auth'
import { fetchMyPorts } from '../api/usersApi'
import { ApiError, getSelectedPortId } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useRbac } from '../context/RbacContext'
import GuestBrandedShell from '../components/GuestBrandedShell'
import { useTranslation } from 'react-i18next'
import { MAX_LOGIN_IDENTIFIER_CHARS, MAX_LOGIN_PASSWORD_CHARS } from '../constants/inputLimits'
import { firstAllowedNavPath } from '../utils/firstAllowedNavPath'

export default function Login() {
  const { t } = useTranslation('auth')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [ssoStatus, setSsoStatus] = useState(null)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { refreshMe } = useAuth()
  const { refresh: refreshRbac } = useRbac()

  useEffect(() => {
    const legacyError = (searchParams.get('sso_error') || '').trim()
    if (legacyError) {
      navigate(`/sso-error?code=${encodeURIComponent(legacyError)}`, { replace: true })
      return
    }
    let cancelled = false
    fetchSsoStatus()
      .then((data) => {
        if (!cancelled) setSsoStatus(data)
      })
      .catch(() => {
        if (!cancelled) setSsoStatus(null)
      })
    return () => {
      cancelled = true
    }
  }, [navigate, searchParams])

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
      // Session cookie is set; force fetch so landing path does not wait on React `me` state.
      const pagePerms = await refreshRbac({ force: true })
      const canViewPage = (pageKey) => pagePerms[pageKey]?.canView === true
      const landing = firstAllowedNavPath(canViewPage) || '/'
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
      navigate(goSelectPort ? '/select-port' : landing)
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

  const showOidcButton = ssoStatus?.oidcEnabled === true

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
          maxLength={MAX_LOGIN_IDENTIFIER_CHARS}
          autoComplete="username"
          disabled={busy}
        />
        <label className="guest-branded__label" htmlFor="login-password">
          {t('password')}
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
      {showOidcButton ? (
        <button
          type="button"
          className="btn guest-branded__submit"
          style={{ marginTop: 8 }}
          onClick={handleSsoClick}
          disabled={busy}
        >
          {t('signInViaDwsHub')}
        </button>
      ) : null}
    </GuestBrandedShell>
  )
}
