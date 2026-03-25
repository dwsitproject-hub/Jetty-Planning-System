import { useState, useCallback, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { fetchPorts } from '../api/ports'
import { fetchJetties, createJetty, updateJettyApi } from '../api/jetties'
import { useActivityLog } from '../context/ActivityLogContext'
import '../styles/allocation.css'
import '../styles/modal.css'

export default function MasterJetty() {
  const { logActivity } = useActivityLog()
  const [ports, setPorts] = useState([])
  const [jetties, setJetties] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [formPortId, setFormPortId] = useState('')
  const [formOrderNo, setFormOrderNo] = useState('')
  const [formJettyName, setFormJettyName] = useState('')
  const [formDescription, setFormDescription] = useState('')

  const loadAll = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      const [p, j] = await Promise.all([fetchPorts(), fetchJetties()])
      setPorts(Array.isArray(p) ? p : [])
      setJetties(Array.isArray(j) ? j : [])
    } catch (e) {
      setError(e?.message || 'Failed to load')
      setPorts([])
      setJetties([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  const portName = (portId) => ports.find((p) => p.id === portId)?.name ?? portId ?? '—'

  const openAdd = useCallback(() => {
    setEditingId(null)
    setFormPortId(ports[0]?.id != null ? String(ports[0].id) : '')
    setFormOrderNo('')
    setFormJettyName('')
    setFormDescription('')
    setModalOpen(true)
  }, [ports])

  const openEdit = useCallback((jetty) => {
    setEditingId(jetty.id)
    setFormPortId(String(jetty.portId ?? ''))
    setFormOrderNo(String(jetty.orderNo ?? ''))
    setFormJettyName(jetty.name || '')
    setFormDescription(jetty.description ?? '')
    setModalOpen(true)
  }, [])

  const closeModal = useCallback(() => {
    setModalOpen(false)
    setEditingId(null)
  }, [])

  const handleSubmit = useCallback(async () => {
    const portId = parseInt(formPortId, 10)
    const jettyName = (formJettyName || '').trim()
    if (Number.isNaN(portId) || !jettyName) return
    const orderNo = Math.max(0, Math.min(32767, parseInt(formOrderNo, 10) || 0))
    setSaving(true)
    setError(null)
    try {
      if (editingId != null) {
        await updateJettyApi(editingId, {
          portId,
          orderNo,
          name: jettyName,
          description: (formDescription || '').trim() || null,
        })
        logActivity({
          pageKey: 'master-jetty',
          action: 'update',
          entityType: 'Jetty',
          entityLabel: jettyName,
          details: portName(portId),
        })
      } else {
        await createJetty({
          portId,
          orderNo,
          name: jettyName,
          description: (formDescription || '').trim() || null,
        })
        logActivity({
          pageKey: 'master-jetty',
          action: 'add',
          entityType: 'Jetty',
          entityLabel: jettyName,
          details: portName(portId),
        })
      }
      await loadAll()
      closeModal()
    } catch (e) {
      setError(e?.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }, [editingId, formPortId, formOrderNo, formJettyName, formDescription, loadAll, closeModal, logActivity])

  const sortedJetties = [...jetties].sort((a, b) => {
    const na = a.portName || portName(a.portId)
    const nb = b.portName || portName(b.portId)
    if (na !== nb) return na.localeCompare(nb)
    return (a.orderNo ?? 0) - (b.orderNo ?? 0)
  })

  return (
    <div className="allocation-page">
      <h1 className="page-title">Master – Jetty</h1>
      <p className="allocation-page__intro">Jetties from API (per port).</p>
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
          <h2 className="card__title">Jetties</h2>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="button" className="btn btn--secondary btn--small" onClick={loadAll} disabled={loading}>
              Refresh
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={openAdd}
              disabled={ports.length === 0}
              title={ports.length === 0 ? 'Add a port first' : ''}
            >
              Add Jetty
            </button>
          </div>
        </div>
        {loading ? (
          <p className="text-steel">Loading…</p>
        ) : ports.length === 0 ? (
          <p className="text-steel">No ports. Add a port in Master – Port first.</p>
        ) : sortedJetties.length === 0 ? (
          <p className="text-steel">No jetties. Click Add Jetty.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table allocation-table">
              <thead>
                <tr>
                  <th>Port</th>
                  <th>Order</th>
                  <th>Jetty name</th>
                  <th>Status</th>
                  <th>Description</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedJetties.map((j) => (
                  <tr key={j.id}>
                    <td>{j.portName || portName(j.portId)}</td>
                    <td>{j.orderNo ?? '—'}</td>
                    <td><strong>{j.name || '—'}</strong></td>
                    <td>{j.status || '—'}</td>
                    <td>{j.description ? (j.description.length > 40 ? `${j.description.slice(0, 40)}…` : j.description) : '—'}</td>
                    <td>
                      <button type="button" className="btn btn--small btn--secondary" onClick={() => openEdit(j)}>
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
          <div className="modal modal--wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h2 className="modal__title">{editingId != null ? 'Edit Jetty' : 'Add Jetty'}</h2>
            <div className="modal__section">
              <label className="modal__label">Port</label>
              <select
                className="modal__input"
                value={formPortId}
                onChange={(e) => setFormPortId(e.target.value)}
              >
                {ports.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="modal__section">
              <label className="modal__label">Order #</label>
              <input
                type="number"
                className="modal__input"
                value={formOrderNo}
                onChange={(e) => setFormOrderNo(e.target.value)}
                min={0}
              />
            </div>
            <div className="modal__section">
              <label className="modal__label">Jetty name</label>
              <input
                className="modal__input"
                value={formJettyName}
                onChange={(e) => setFormJettyName(e.target.value)}
                placeholder="e.g. 1A"
              />
            </div>
            <div className="modal__section">
              <label className="modal__label">Description</label>
              <textarea
                className="modal__input modal__textarea"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                rows={3}
              />
            </div>
            <div className="modal__footer">
              <button type="button" className="btn btn--secondary" onClick={closeModal} disabled={saving}>Cancel</button>
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
