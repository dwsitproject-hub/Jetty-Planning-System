import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { login } from '../api/auth'
import { useAuth } from '../context/AuthContext'
import { useRbac } from '../context/RbacContext'
import { ApiError } from '../api/client'
import '../styles/allocation.css'

export default function Login() {
  const [username, setUsername] = useState('admin')
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
      navigate('/')
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
    <div className="allocation-page" style={{ maxWidth: '24rem', margin: '2rem auto' }}>
      <h1 className="page-title">Sign in</h1>
      <form onSubmit={handleSubmit} className="card" style={{ padding: '1.25rem' }}>
        {error && <p style={{ color: '#c00' }}>{error}</p>}
        <label className="modal__label">Username</label>
        <input className="modal__input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
        <label className="modal__label" style={{ marginTop: '0.75rem' }}>Password</label>
        <input
          className="modal__input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
        <button type="submit" className="btn btn--primary" style={{ marginTop: '1rem', width: '100%' }} disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <p className="text-steel" style={{ marginTop: '1rem' }}>
        <Link to="/">Home</Link>
      </p>
    </div>
  )
}
