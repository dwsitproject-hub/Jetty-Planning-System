import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { usePortScope } from '../context/PortScopeContext'
import GuestBrandedShell from '../components/GuestBrandedShell'

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
      <GuestBrandedShell cardTitle="Choose port">
        <p className="guest-branded__muted">Loading…</p>
      </GuestBrandedShell>
    )
  }

  if (!me) {
    return null
  }

  if (noPortAssigned) {
    return (
      <GuestBrandedShell cardTitle="Port access">
        <p className="guest-branded__muted">{noPortMessage}</p>
        <div className="guest-branded__actions">
          <button type="button" className="btn btn--secondary guest-branded__submit" onClick={() => navigate('/login', { replace: true })}>
            Back to sign in
          </button>
        </div>
      </GuestBrandedShell>
    )
  }

  if (assignedPorts.length <= 1) {
    return (
      <GuestBrandedShell cardTitle="Choose port">
        <p className="guest-branded__muted">Continuing…</p>
      </GuestBrandedShell>
    )
  }

  return (
    <GuestBrandedShell
      cardTitle="Choose port"
      cardDescription="You are assigned to multiple ports. Select one to continue."
    >
      <form onSubmit={handleContinue}>
        {localErr ? <p className="guest-branded__error">{localErr}</p> : null}
        <label className="guest-branded__label" htmlFor="select-port-id">
          Port
        </label>
        <select
          id="select-port-id"
          className="guest-branded__input"
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
        <button type="submit" className="btn btn--primary guest-branded__submit">
          Continue
        </button>
      </form>
    </GuestBrandedShell>
  )
}
