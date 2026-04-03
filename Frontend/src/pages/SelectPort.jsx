import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { usePortScope } from '../context/PortScopeContext'
import '../styles/allocation.css'

function safeReturnTo(raw) {
  if (raw == null || typeof raw !== 'string') return '/'
  const t = raw.trim()
  if (!t.startsWith('/') || t.startsWith('//')) return '/'
  return t
}

export default function SelectPort() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const returnTo = useMemo(() => safeReturnTo(searchParams.get('returnTo')), [searchParams])
  const { me, loading: authLoading } = useAuth()
  const {
    loading: portLoading,
    assignedPorts,
    noPortAssigned,
    noPortMessage,
    setSelectedPortId,
    selectedPortId,
  } = usePortScope()
  const [choice, setChoice] = useState('')
  const [localErr, setLocalErr] = useState(null)

  useEffect(() => {
    if (!authLoading && !me) navigate('/login', { replace: true })
  }, [authLoading, me, navigate])

  useEffect(() => {
    if (!me || portLoading) return
    if (assignedPorts.length === 0) return
    if (assignedPorts.length === 1) {
      navigate(returnTo, { replace: true })
    }
  }, [me, portLoading, assignedPorts.length, navigate, returnTo])

  useEffect(() => {
    if (selectedPortId != null) {
      setChoice(String(selectedPortId))
    }
  }, [selectedPortId])

  const busy = authLoading || portLoading

  const handleContinue = (e) => {
    e.preventDefault()
    setLocalErr(null)
    const id = choice ? Number(choice) : NaN
    if (!Number.isFinite(id) || id <= 0) {
      setLocalErr('Please select a port.')
      return
    }
    const allowed = assignedPorts.some((p) => Number(p.id) === id)
    if (!allowed) {
      setLocalErr('Invalid port selection.')
      return
    }
    setSelectedPortId(id)
    navigate(returnTo, { replace: true })
  }

  if (busy) {
    return (
      <div className="allocation-page" style={{ maxWidth: '28rem', margin: '2rem auto' }}>
        <p className="text-steel">Loading…</p>
      </div>
    )
  }

  if (!me) {
    return null
  }

  if (noPortAssigned) {
    return (
      <div className="allocation-page" style={{ maxWidth: '28rem', margin: '2rem auto' }}>
        <h1 className="page-title">Port access</h1>
        <div className="card" style={{ padding: '1.25rem' }}>
          <p className="text-steel">{noPortMessage}</p>
          <button type="button" className="btn btn--secondary" style={{ marginTop: '1rem' }} onClick={() => navigate('/login', { replace: true })}>
            Back to sign in
          </button>
        </div>
      </div>
    )
  }

  if (assignedPorts.length <= 1) {
    return (
      <div className="allocation-page" style={{ maxWidth: '28rem', margin: '2rem auto' }}>
        <p className="text-steel">Continuing…</p>
      </div>
    )
  }

  return (
    <div className="allocation-page" style={{ maxWidth: '28rem', margin: '2rem auto' }}>
      <h1 className="page-title">Choose port</h1>
      <p className="text-steel" style={{ marginBottom: '1rem' }}>
        You are assigned to multiple ports. Select one to continue.
      </p>
      <form onSubmit={handleContinue} className="card" style={{ padding: '1.25rem' }}>
        {localErr && <p style={{ color: '#c00', marginTop: 0 }}>{localErr}</p>}
        <label className="modal__label" htmlFor="select-port-id">
          Port
        </label>
        <select
          id="select-port-id"
          className="modal__input"
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
          required
        >
          <option value="">Select port…</option>
          {assignedPorts.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button type="submit" className="btn btn--primary" style={{ marginTop: '1rem', width: '100%' }}>
          Continue
        </button>
      </form>
    </div>
  )
}
