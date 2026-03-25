/**
 * End-to-end API flow: SI → Operation → Dock → Loading → (exception path) Signoff → Depart
 */
import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { fetchJetties } from '../api/jetties'
import { fetchShippingInstructions, createShippingInstruction } from '../api/shippingInstructions'
import { fetchSiLookups } from '../api/siLookups'
import {
  fetchOperations,
  createOperation,
  startDocking,
  requestException,
  approveException,
  signoff,
  depart,
} from '../api/operations'
import { getToken } from '../api/auth'
import '../styles/allocation.css'

export default function E2EConsole() {
  const [log, setLog] = useState([])
  const push = (msg) => setLog((l) => [...l, `${new Date().toLocaleTimeString()} ${msg}`])
  const [jetties, setJetties] = useState([])
  const [sis, setSis] = useState([])
  const [ops, setOps] = useState([])
  const [siJetty, setSiJetty] = useState({ siId: '', jettyId: '' })
  const [opId, setOpId] = useState('')
  const [approverId, setApproverId] = useState('1')
  const [justification, setJustification] = useState('E2E exception test')
  const [hose, setHose] = useState('')
  const [cast, setCast] = useState('')
  const [newSi, setNewSi] = useState({
    vesselName: 'E2E Vessel',
    purpose: 'Loading',
    referenceNumber: '',
  })
  const [e2eLookups, setE2eLookups] = useState(null)
  const token = getToken()

  const refresh = useCallback(async () => {
    try {
      const [j, s, o] = await Promise.all([
        fetchJetties(),
        fetchShippingInstructions(),
        fetchOperations(),
      ])
      setJetties(j || [])
      setSis(s || [])
      setOps(o || [])
      push('Lists refreshed')
    } catch (e) {
      push(`Error: ${e?.message}`)
    }
  }, [])

  useEffect(() => {
    refresh()
    fetchSiLookups().then(setE2eLookups).catch(() => setE2eLookups(null))
    const t = new Date()
    setHose(t.toISOString())
    setCast(new Date(t.getTime() + 15 * 60 * 1000).toISOString())
  }, [refresh])

  const stepCreateSi = async () => {
    const cpo = e2eLookups?.commodities?.find((x) => x.name === 'CPO') || e2eLookups?.commodities?.[0]
    const mt = e2eLookups?.metrics?.find((x) => x.code === 'MT') || e2eLookups?.metrics?.[0]
    const purposeId = e2eLookups?.purposes?.find((p) => p.code === newSi.purpose)?.id
    if (!cpo || !mt || !purposeId) {
      push('Need si-lookups (commodity, metric MT, purpose). Run migration 009+008 and refresh.')
      return
    }
    try {
      const row = await createShippingInstruction({
        vesselName: newSi.vesselName,
        purpose: newSi.purpose,
        purposeId,
        referenceNumber: newSi.referenceNumber || null,
        status: 'Approved',
        breakdown: [
          {
            commodityId: cpo.id,
            metricId: mt.id,
            qty: 1000,
            contractNo: null,
            poNo: null,
            remarks: 'E2E',
            shipperText: null,
          },
        ],
      })
      push(`SI created id=${row.id}`)
      await refresh()
    } catch (e) {
      push(`SI fail: ${e?.message}`)
    }
  }

  const stepCreateOp = async () => {
    const si = parseInt(siJetty.siId, 10)
    const j = parseInt(siJetty.jettyId, 10)
    if (Number.isNaN(si) || Number.isNaN(j)) {
      push('Pick SI id and Jetty id')
      return
    }
    try {
      const row = await createOperation(si, j)
      setOpId(String(row.id))
      push(`Operation ${row.id} created`)
      await refresh()
    } catch (e) {
      push(`Op fail: ${e?.message}`)
    }
  }

  const stepDock = async () => {
    const id = parseInt(opId, 10)
    if (Number.isNaN(id)) return
    try {
      await startDocking(id)
      push(`Operation ${id} DOCKED`)
      await refresh()
    } catch (e) {
      push(`Dock fail: ${e?.message}`)
    }
  }

  const stepException = async () => {
    const id = parseInt(opId, 10)
    if (Number.isNaN(id)) return
    try {
      await requestException(id, justification)
      push(`Exception requested`)
      const aid = parseInt(approverId, 10)
      await approveException(id, Number.isNaN(aid) ? null : aid)
      push(`Exception approved`)
      await refresh()
    } catch (e) {
      push(`Exception fail: ${e?.message}`)
    }
  }

  const stepSignoff = async () => {
    const id = parseInt(opId, 10)
    if (Number.isNaN(id)) return
    try {
      await signoff(id)
      push(`Signoff OK`)
      await refresh()
    } catch (e) {
      push(`Signoff fail: ${e?.message} (use Loading op page for QC/qty or exception path)`)
    }
  }

  const stepDepart = async () => {
    const id = parseInt(opId, 10)
    if (Number.isNaN(id)) return
    try {
      await depart(id, hose, cast, null, null)
      push(`SAILED`)
      await refresh()
    } catch (e) {
      push(`Depart fail: ${e?.message}`)
    }
  }

  return (
    <div className="allocation-page">
      <h1 className="page-title">E2E API console</h1>
      <p className="text-steel">
        Token: {token ? '✓ logged in' : '—'} · <Link to="/login">Login</Link> ·{' '}
        <Link to="/">Dashboard</Link>
      </p>
      <button type="button" className="btn btn--secondary btn--small" onClick={refresh}>Refresh lists</button>

      <section className="card" style={{ margin: '1rem 0' }}>
        <h2 className="card__title">1. Create SI (Approved)</h2>
        <input placeholder="Vessel" value={newSi.vesselName} onChange={(e) => setNewSi({ ...newSi, vesselName: e.target.value })} />
        <select value={newSi.purpose} onChange={(e) => setNewSi({ ...newSi, purpose: e.target.value })}>
          <option value="Loading">Loading</option>
          <option value="Unloading">Unloading</option>
        </select>
        <input placeholder="Ref #" value={newSi.referenceNumber} onChange={(e) => setNewSi({ ...newSi, referenceNumber: e.target.value })} />
        <button type="button" className="btn btn--primary btn--small" onClick={stepCreateSi}>Create SI</button>
      </section>

      <section className="card" style={{ margin: '1rem 0' }}>
        <h2 className="card__title">2. Create operation</h2>
        <p className="text-steel">SI ids: {sis.map((s) => s.id).join(', ') || '—'}</p>
        <p className="text-steel">Jetty ids: {jetties.map((j) => j.id).join(', ') || '—'}</p>
        <input placeholder="SI id" value={siJetty.siId} onChange={(e) => setSiJetty({ ...siJetty, siId: e.target.value })} />
        <input placeholder="Jetty id" value={siJetty.jettyId} onChange={(e) => setSiJetty({ ...siJetty, jettyId: e.target.value })} />
        <button type="button" className="btn btn--primary btn--small" onClick={stepCreateOp}>Create operation</button>
        <p>Current op id: <input value={opId} onChange={(e) => setOpId(e.target.value)} style={{ width: '6rem' }} /></p>
      </section>

      <section className="card" style={{ margin: '1rem 0' }}>
        <h2 className="card__title">3. Start docking</h2>
        <button type="button" className="btn btn--primary btn--small" onClick={stepDock}>Start docking</button>
        {opId && (
          <p>
            <Link to={`/loading/operation/${opId}`} className="link">Open Loading (materials / QC / qty)</Link>
          </p>
        )}
      </section>

      <section className="card" style={{ margin: '1rem 0' }}>
        <h2 className="card__title">4. Clearance paths</h2>
        <p><strong>A) Exception</strong> (then signoff without full QC)</p>
        <input value={justification} onChange={(e) => setJustification(e.target.value)} style={{ width: '100%', maxWidth: '24rem' }} />
        <input placeholder="approver user id" value={approverId} onChange={(e) => setApproverId(e.target.value)} style={{ width: '6rem' }} />
        <button type="button" className="btn btn--secondary btn--small" onClick={stepException}>Request + approve exception</button>
        <p><strong>B) Signoff</strong> (100% + QC + qty OR approved exception)</p>
        <button type="button" className="btn btn--primary btn--small" onClick={stepSignoff}>Signoff</button>
        <p><strong>C) Depart</strong> (after COMPLETED)</p>
        <label className="text-steel">hose_off_at (ISO)</label>
        <input value={hose} onChange={(e) => setHose(e.target.value)} style={{ width: '100%', maxWidth: '28rem' }} />
        <label className="text-steel">cast_off_at (ISO)</label>
        <input value={cast} onChange={(e) => setCast(e.target.value)} style={{ width: '100%', maxWidth: '28rem' }} />
        <button type="button" className="btn btn--primary btn--small" onClick={stepDepart}>Depart (SAILED)</button>
      </section>

      <section className="card">
        <h2 className="card__title">Log</h2>
        <pre style={{ fontSize: '12px', maxHeight: '240px', overflow: 'auto' }}>{log.slice(-30).join('\n')}</pre>
      </section>

      <section className="card">
        <h2 className="card__title">Operations snapshot</h2>
        <ul style={{ fontSize: '13px' }}>
          {ops.slice(0, 15).map((o) => (
            <li key={o.id}>
              #{o.id} {o.vesselName} — {o.status} — jetty {o.jettyId}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
