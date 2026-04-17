import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { usePortScope } from '../context/PortScopeContext'
import { useTranslation } from 'react-i18next'
import GuestBrandedShell from '../components/GuestBrandedShell'

function safeReturnTo(raw) {
  if (raw == null || typeof raw !== 'string') return '/'
  const t = raw.trim()
  if (!t.startsWith('/') || t.startsWith('//')) return '/'
  return t
}

export default function SelectPort() {
  const { t } = useTranslation('auth')
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
      setLocalErr(t('selectPortError'))
      return
    }
    const allowed = assignedPorts.some((p) => Number(p.id) === id)
    if (!allowed) {
      setLocalErr(t('invalidPort'))
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
      <GuestBrandedShell cardTitle={t('portAccess')}>
        <p className="guest-branded__muted">{noPortMessage}</p>
        <div className="guest-branded__actions">
          <button type="button" className="btn btn--secondary guest-branded__submit" onClick={() => navigate('/login', { replace: true })}>
            {t('backToSignIn')}
          </button>
        </div>
      </GuestBrandedShell>
    )
  }

  if (assignedPorts.length <= 1) {
    return (
      <GuestBrandedShell cardTitle={t('choosePort')}>
        <p className="guest-branded__muted">{t('continuing')}</p>
      </GuestBrandedShell>
    )
  }

  return (
    <GuestBrandedShell
      cardTitle={t('choosePort')}
      cardDescription={t('choosePortDescription')}
    >
      <form onSubmit={handleContinue}>
        {localErr ? <p className="guest-branded__error">{localErr}</p> : null}
        <label className="guest-branded__label" htmlFor="select-port-id">
          {t('port')}
        </label>
        <select
          id="select-port-id"
          className="guest-branded__input"
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
          required
        >
          <option value="">{t('selectPortPlaceholder')}</option>
          {assignedPorts.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button type="submit" className="btn btn--primary guest-branded__submit">
          {t('continue')}
        </button>
      </form>
    </GuestBrandedShell>
  )
}
