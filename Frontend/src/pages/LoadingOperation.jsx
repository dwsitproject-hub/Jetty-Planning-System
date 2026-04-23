/**
 * Operation-centric loading workflow (API) — use after start-docking.
 * Route: /loading/operation/:operationId
 */
import { useState, useEffect, useCallback } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  fetchOperation,
  fetchMaterials,
  addMaterial,
  deleteMaterial,
  updateOperation,
  fetchQcSurveys,
  createQcSurvey,
  updateQcSurvey,
  fetchQuantityChecks,
  createQuantityCheck,
  updateQuantityCheck,
} from '../api/operations'
import '../styles/allocation.css'

export default function LoadingOperation() {
  const { operationId } = useParams()
  const id = parseInt(operationId, 10)
  const [op, setOp] = useState(null)
  const [materials, setMaterials] = useState([])
  const [qc, setQc] = useState([])
  const [qty, setQty] = useState([])
  const [err, setErr] = useState(null)
  const [loading, setLoading] = useState(true)
  const [matKey, setMatKey] = useState('CPO')
  const [matVol, setMatVol] = useState('1000')
  const [pct, setPct] = useState('0')

  const reload = useCallback(async () => {
    if (Number.isNaN(id)) return
    setErr(null)
    setLoading(true)
    try {
      const [o, m, q, t] = await Promise.all([
        fetchOperation(id),
        fetchMaterials(id),
        fetchQcSurveys(id),
        fetchQuantityChecks(id),
      ])
      setOp(o)
      setMaterials(m || [])
      setQc(q || [])
      setQty(t || [])
      setPct(String(o?.completionPercent ?? 0))
    } catch (e) {
      setErr(e?.message || 'Load failed')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    reload()
  }, [reload])

  const addMat = async () => {
    try {
      await addMaterial(id, matKey.trim(), Number(matVol) || 0)
      reload()
    } catch (e) {
      setErr(e?.message)
    }
  }

  const removeMat = async (rowId) => {
    try {
      await deleteMaterial(id, rowId)
      reload()
    } catch (e) {
      setErr(e?.message)
    }
  }

  const savePct = async () => {
    try {
      await updateOperation(id, { completionPercent: parseInt(pct, 10) || 0 })
      reload()
    } catch (e) {
      setErr(e?.message)
    }
  }

  const seedQcMinimal = async () => {
    try {
      await createQcSurvey(id, { phase: 'Pre-Checking', stepKey: 'Survey', status: 'Done' })
      await createQcSurvey(id, { phase: 'Post-Checking', stepKey: 'Final QC', status: 'Done' })
      reload()
    } catch (e) {
      setErr(e?.message)
    }
  }

  const seedQtyOperational = async () => {
    try {
      await createQuantityCheck(id, {
        phase: 'Operational',
        checkKey: 'sounding',
        occurredAt: new Date().toISOString(),
      })
      reload()
    } catch (e) {
      setErr(e?.message)
    }
  }

  const markQcDone = async (surveyId) => {
    try {
      await updateQcSurvey(surveyId, { status: 'Done', occurredAt: new Date().toISOString() })
      reload()
    } catch (e) {
      setErr(e?.message)
    }
  }

  const markQtyOccurred = async (checkId) => {
    try {
      await updateQuantityCheck(checkId, { occurredAt: new Date().toISOString() })
      reload()
    } catch (e) {
      setErr(e?.message)
    }
  }

  if (Number.isNaN(id)) {
    return <p className="allocation-page">Invalid operation id.</p>
  }

  return (
    <div className="allocation-page">
      <h1 className="page-title">Loading (operation #{id})</h1>
      <p className="text-steel">
        <Link to="/verification" className="link">Clearance</Link>
      </p>
      {err && <p style={{ color: '#c00' }}>{err}</p>}
      {loading && !op ? (
        <p>Loading…</p>
      ) : op ? (
        <>
          <section className="card" style={{ marginBottom: '1rem' }}>
            <h2 className="card__title">{op.vesselName || 'Vessel'} — {op.jettyName} / {op.portName}</h2>
            <p>Status: <strong>{op.status}</strong> · Purpose: {op.purpose}</p>
            <p>Completion: {op.completionPercent}%</p>
            <label>
              Set % <input value={pct} onChange={(e) => setPct(e.target.value)} type="number" min={0} max={100} style={{ width: '4rem' }} />
              <button type="button" className="btn btn--small btn--primary" onClick={savePct}>Save</button>
            </label>
          </section>

          <section className="card" style={{ marginBottom: '1rem' }}>
            <h3 className="card__title">Materials (SLA)</h3>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
              <input value={matKey} onChange={(e) => setMatKey(e.target.value)} placeholder="material_key" />
              <input value={matVol} onChange={(e) => setMatVol(e.target.value)} type="number" placeholder="volume" />
              <button type="button" className="btn btn--primary btn--small" onClick={addMat}>Add</button>
            </div>
            <ul>
              {materials.map((m) => (
                <li key={m.id}>
                  {m.materialKey}: {m.volume}{' '}
                  <button type="button" className="btn btn--small" onClick={() => removeMat(m.id)}>Remove</button>
                </li>
              ))}
            </ul>
          </section>

          <section className="card" style={{ marginBottom: '1rem' }}>
            <h3 className="card__title">QC surveys</h3>
            <button type="button" className="btn btn--secondary btn--small" onClick={seedQcMinimal}>
              Add minimal Pre + Post (Done)
            </button>
            <ul>
              {qc.map((s) => (
                <li key={s.id}>
                  {s.phase} / {s.stepKey}: {s.status}{' '}
                  {s.status !== 'Done' && (
                    <button type="button" className="btn btn--small" onClick={() => markQcDone(s.id)}>Mark Done</button>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section className="card">
            <h3 className="card__title">Quantity checks</h3>
            <button type="button" className="btn btn--secondary btn--small" onClick={seedQtyOperational}>
              Add Operational check + time
            </button>
            <ul>
              {qty.map((q) => (
                <li key={q.id}>
                  {q.phase} / {q.checkKey} — occurred: {q.occurredAt ? 'yes' : 'no'}{' '}
                  {!q.occurredAt && q.phase === 'Operational' && (
                    <button type="button" className="btn btn--small" onClick={() => markQtyOccurred(q.id)}>Set time</button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : (
        <p>Operation not found.</p>
      )}
    </div>
  )
}
