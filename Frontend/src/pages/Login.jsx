import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { login } from '../api/auth'
import { fetchMyPorts } from '../api/usersApi'
import { getSelectedPortId } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useRbac } from '../context/RbacContext'
import { ApiError } from '../api/client'
import GuestBrandedShell from '../components/GuestBrandedShell'

export default function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  const { refreshMe } = useAuth()
  const { refresh: refreshRbac } = useRbac()

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
          ? err.message || 'Invalid username or password'
          : err?.message || 'Login failed'
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
          Username
        </label>
        <input
          id="login-username"
          className="guest-branded__input"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
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
          autoComplete="current-password"
          disabled={busy}
        />
        <button type="submit" className="btn btn--primary guest-branded__submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign In'}
        </button>
      </form>
    </GuestBrandedShell>
  )
}
