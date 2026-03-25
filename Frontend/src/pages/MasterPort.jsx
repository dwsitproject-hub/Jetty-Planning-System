import { useState, useCallback, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ping, getHealth, getApiOrigin } from '../api/client'
import { fetchPorts, createPort, updatePortApi } from '../api/ports'
import { useActivityLog } from '../context/ActivityLogContext'
import '../styles/allocation.css'
import '../styles/modal.css'

export default function MasterPort() {
  const { logActivity } = useActivityLog()
  const [ports, setPorts] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [slice0Status, setSlice0Status] = useState({ health: null, ping: null, message: '' })

  const loadPorts = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      const list = await fetchPorts()
      setPorts(Array.isArray(list) ? list : [])
    } catch (e) {
      setPorts([])
      setError(e?.message || 'Failed to load ports')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await getHealth()
        if (cancelled) return
        setSlice0Status((s) => ({ ...s, health: 'ok' }))
      } catch {
        if (!cancelled) setSlice0Status((s) => ({ ...s, health: 'fail' }))
      }
      try {
        await ping()
        if (cancelled) return
        setSlice0Status((s) => ({ ...s, ping: 'ok', message: 'API reachable' }))
      } catch {
        if (!cancelled) {
          setSlice0Status((s) => ({
            ...s,
            ping: 'fail',
            message: `Check Backend + CORS (${getApiOrigin()})`,
          }))
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    loadPorts()
  }, [loadPorts])

  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [formName, setFormName] = useState('')
  const [formDescription, setFormDescription] = useState('')

  const openAdd = useCallback(() => {
    setEditingId(null)
    setFormName('')
    setFormDescription('')
    setModalOpen(true)
  }, [])

  const openEdit = useCallback((port) => {
    setEditingId(port.id)
    setFormName(port.name || '')
    setFormDescription(port.description ?? '')
    setModalOpen(true)
  }, [])

  const closeModal = useCallback(() => {
    setModalOpen(false)
    setEditingId(null)
    setFormName('')
    setFormDescription('')
  }, [])

  const handleSubmit = useCallback(async () => {
    const name = (formName || '').trim()
    if (!name) return
    setSaving(true)
    setError(null)
    try {
      if (editingId != null) {
        await updatePortApi(editingId, {
          name,
          description: (formDescription || '').trim() || null,
        })
        logActivity({ pageKey: 'master-port', action: 'update', entityType: 'Port', entityLabel: name })
      } else {
        await createPort({
          name,
          description: (formDescription || '').trim() || null,
        })
        logActivity({ pageKey: 'master-port', action: 'add', entityType: 'Port', entityLabel: name })
      }
      await loadPorts()
      closeModal()
    } catch (e) {
      setError(e?.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }, [editingId, formName, formDescription, closeModal, logActivity, loadPorts])

  const apiLine =
    slice0Status.health === 'ok' && slice0Status.ping === 'ok'
      ? 'API: health + /ping OK'
      : `API: health ${slice0Status.health || '…'} · /ping ${slice0Status.ping || '…'}${slice0Status.message ? ` — ${slice0Status.message}` : ''}`

  return (
    <div className="allocation-page">
      <h1 className="page-title">Master – Port</h1>
      <p className="allocation-page__intro">
        Add and manage master port / site data (live API).
      </p>
      <p className="text-steel" style={{ fontSize: 'var(--font-size-small)' }}>
        {apiLine}
      </p>
      <p className="text-steel">
        <Link to="/master" className="link">← Back to Master Menu</Link>
      </p>

      {error && (
        <p className="allocation-page__intro" style={{ color: 'var(--color-danger, #c00)' }} role="alert">
          {error}
        </p>
      )}

      <section className="card at-berth-list-section">
        <div className="card__header-row">
          <h2 className="card__title">Ports</h2>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button
              type="button"
              className="btn btn--secondary btn--small"
              onClick={() => loadPorts()}
              disabled={loading}
            >
              Refresh
            </button>
            <button type="button" className="btn btn--primary" onClick={openAdd}>
              Add Port
            </button>
          </div>
        </div>
        {loading ? (
          <p className="text-steel">Loading ports…</p>
        ) : ports.length === 0 ? (
          <p className="text-steel">No ports. Click Add Port to add one.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table allocation-table">
              <thead>
                <tr>
                  <th className="allocation-table__th">Port Name</th>
                  <th className="allocation-table__th">Description</th>
                  <th className="allocation-table__action-col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {ports.map((p) => (
                  <tr key={p.id} className="allocation-table__row">
                    <td><strong>{p.name || '—'}</strong></td>
                    <td>
                      {p.description
                        ? p.description.length > 60
                          ? `${p.description.slice(0, 60)}…`
                          : p.description
                        : '—'}
                    </td>
                    <td className="allocation-table__action-col">
                      <button type="button" className="btn btn--small btn--secondary" onClick={() => openEdit(p)}>
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {modalOpen && (
        <div className="modal-overlay" onClick={closeModal} aria-hidden="true">
          <div
            className="modal modal--wide"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-labelledby="port-modal-title"
            aria-modal="true"
          >
            <h2 id="port-modal-title" className="modal__title">
              {editingId != null ? 'Edit Port' : 'Add Port'}
            </h2>
            <div className="modal__section">
              <label htmlFor="port-name" className="modal__label">Port Name</label>
              <input
                id="port-name"
                type="text"
                className="modal__input"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g. Bontang"
              />
            </div>
            <div className="modal__section">
              <label htmlFor="port-description" className="modal__label">Description</label>
              <textarea
                id="port-description"
                className="modal__input modal__textarea"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="Optional description"
                rows={4}
              />
            </div>
            <div className="modal__footer">
              <button type="button" className="btn btn--secondary" onClick={closeModal} disabled={saving}>
                Cancel
              </button>
              <button type="button" className="btn btn--primary" onClick={handleSubmit} disabled={saving}>
                {saving ? 'Saving…' : editingId != null ? 'Save' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
