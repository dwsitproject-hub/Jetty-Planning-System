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
  const [showPassword, setShowPassword] = useState(false)
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
    <GuestBrandedShell cardTitle={t('welcomeBack')} cardDescription={t('signInContinue')}>
      <form onSubmit={handleSubmit}>
        {error ? <p className="guest-branded__error">{error}</p> : null}
        <div className="guest-branded__field-group">
          <label className="guest-branded__label" htmlFor="login-username">
            {t('username')}
          </label>
          <div className="guest-branded__field">
            <span className="guest-branded__field-icon" aria-hidden>
              <UserIcon />
            </span>
            <input
              id="login-username"
              className="guest-branded__input guest-branded__input--with-icon"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              maxLength={MAX_LOGIN_IDENTIFIER_CHARS}
              autoComplete="username"
              placeholder={t('usernamePlaceholder')}
              spellCheck={false}
              disabled={busy}
            />
          </div>
        </div>
        <div className="guest-branded__field-group">
          <label className="guest-branded__label" htmlFor="login-password">
            {t('password')}
          </label>
          <div className="guest-branded__field">
            <span className="guest-branded__field-icon" aria-hidden>
              <LockIcon />
            </span>
            <input
              id="login-password"
              className="guest-branded__input guest-branded__input--with-icon guest-branded__input--with-toggle"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              maxLength={MAX_LOGIN_PASSWORD_CHARS}
              autoComplete="current-password"
              placeholder={t('passwordPlaceholder')}
              disabled={busy}
            />
            <button
              type="button"
              className="guest-branded__field-toggle"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? t('hidePassword') : t('showPassword')}
              aria-pressed={showPassword}
            >
              {showPassword ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </div>
        </div>
        <button type="submit" className="btn btn--primary guest-branded__submit" disabled={busy}>
          {busy ? t('signingIn') : t('signIn')}
        </button>
      </form>
      {showOidcButton ? (
        <button
          type="button"
          className="btn btn--secondary guest-branded__submit"
          onClick={handleSsoClick}
          disabled={busy}
        >
          {t('signInViaDwsHub')}
        </button>
      ) : null}
    </GuestBrandedShell>
  )
}

function UserIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}

function EyeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function EyeOffIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a21.77 21.77 0 0 1 5.06-6.94" />
      <path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a21.83 21.83 0 0 1-2.16 3.19" />
      <path d="M14.12 14.12a3 3 0 0 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  )
}
