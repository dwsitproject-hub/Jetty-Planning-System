import { useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { getPorts, getJetties, addJetty, updateJetty } from '../data/masterData'
import { useActivityLog } from '../context/ActivityLogContext'
import '../styles/allocation.css'
import '../styles/modal.css'

export default function MasterJetty() {
  const { logActivity } = useActivityLog()
  const [ports, setPorts] = useState(() => getPorts())
  const [jetties, setJetties] = useState(() => getJetties())
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [formPortId, setFormPortId] = useState('')
  const [formOrderNo, setFormOrderNo] = useState('')
  const [formJettyName, setFormJettyName] = useState('')
  const [formDescription, setFormDescription] = useState('')

  const refresh = useCallback(() => {
    setPorts(getPorts())
    setJetties(getJetties())
  }, [])

  const portName = (portId) => ports.find((p) => p.id === portId)?.name ?? portId ?? '—'

  const openAdd = useCallback(() => {
    setEditingId(null)
    setFormPortId(ports[0]?.id ?? '')
    setFormOrderNo('')
    setFormJettyName('')
    setFormDescription('')
    setModalOpen(true)
  }, [ports])

  const openEdit = useCallback((jetty) => {
    setEditingId(jetty.id)
    setFormPortId(jetty.portId || '')
    setFormOrderNo(String(jetty.orderNo ?? ''))
    setFormJettyName(jetty.jettyName || '')
    setFormDescription(jetty.description || '')
    setModalOpen(true)
  }, [])

  const closeModal = useCallback(() => {
    setModalOpen(false)
    setEditingId(null)
  }, [])

  const handleSubmit = useCallback(() => {
    const portId = (formPortId || '').trim()
    const jettyName = (formJettyName || '').trim()
    if (!portId) return
    if (!jettyName) return
    const orderNo = Math.max(0, Math.min(32767, parseInt(formOrderNo, 10) || 0))
    if (editingId) {
      updateJetty(editingId, { portId, orderNo, jettyName, description: formDescription || '' })
      logActivity({ pageKey: 'master-jetty', action: 'update', entityType: 'Jetty', entityLabel: jettyName, details: portName(formPortId) })
    } else {
      addJetty({ portId, orderNo, jettyName, description: formDescription || '' })
      logActivity({ pageKey: 'master-jetty', action: 'add', entityType: 'Jetty', entityLabel: jettyName, details: portName(formPortId) })
    }
    refresh()
    closeModal()
  }, [editingId, formPortId, formOrderNo, formJettyName, formDescription, refresh, closeModal, logActivity])

  const sortedJetties = [...jetties].sort((a, b) => {
    const na = portName(a.portId)
    const nb = portName(b.portId)
    if (na !== nb) return na.localeCompare(nb)
    return (a.orderNo ?? 0) - (b.orderNo ?? 0)
  })

  return (
    <div className="allocation-page">
      <h1 className="page-title">Master – Jetty</h1>
      <p className="allocation-page__intro">
        Add and manage master Jetty for each Port.
      </p>
      <p className="text-steel">
        <Link to="/master" className="link">← Back to Master Menu</Link>
      </p>

      <section className="card at-berth-list-section">
        <div className="card__header-row">
          <h2 className="card__title">Jetties</h2>
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
        {ports.length === 0 ? (
          <p className="text-steel">No ports. Add a port in Master – Port first.</p>
        ) : jetties.length === 0 ? (
          <p className="text-steel">No jetties. Click &quot;Add Jetty&quot; to add one.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table allocation-table">
              <thead>
                <tr>
                  <th className="allocation-table__th">Port</th>
                  <th className="allocation-table__th">Order No</th>
                  <th className="allocation-table__th">Jetty Name</th>
                  <th className="allocation-table__th">Description</th>
                  <th className="allocation-table__action-col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedJetties.map((j) => (
                  <tr key={j.id} className="allocation-table__row">
                    <td>{portName(j.portId)}</td>
                    <td>{j.orderNo ?? '—'}</td>
                    <td><strong>{j.jettyName || '—'}</strong></td>
                    <td>{j.description ? (j.description.length > 50 ? `${j.description.slice(0, 50)}…` : j.description) : '—'}</td>
                    <td className="allocation-table__action-col">
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
          <div
            className="modal modal--wide"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-labelledby="jetty-modal-title"
            aria-modal="true"
          >
            <h2 id="jetty-modal-title" className="modal__title">
              {editingId ? 'Edit Jetty' : 'Add Jetty'}
            </h2>
            <div className="modal__section">
              <label htmlFor="jetty-port" className="modal__label">Port</label>
              <select
                id="jetty-port"
                className="modal__input"
                value={formPortId}
                onChange={(e) => setFormPortId(e.target.value)}
              >
                <option value="">Select port</option>
                {ports.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="modal__section">
              <label htmlFor="jetty-order" className="modal__label">Order No</label>
              <input
                id="jetty-order"
                type="number"
                min={0}
                max={32767}
                className="modal__input"
                value={formOrderNo}
                onChange={(e) => setFormOrderNo(e.target.value)}
                placeholder="e.g. 1"
              />
            </div>
            <div className="modal__section">
              <label htmlFor="jetty-name" className="modal__label">Jetty Name</label>
              <input
                id="jetty-name"
                type="text"
                className="modal__input"
                value={formJettyName}
                onChange={(e) => setFormJettyName(e.target.value)}
                placeholder="e.g. 1A"
              />
            </div>
            <div className="modal__section">
              <label htmlFor="jetty-description" className="modal__label">Description</label>
              <textarea
                id="jetty-description"
                className="modal__input modal__textarea"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="Optional description"
                rows={4}
              />
            </div>
            <div className="modal__footer">
              <button type="button" className="btn btn--secondary" onClick={closeModal}>Cancel</button>
              <button type="button" className="btn btn--primary" onClick={handleSubmit}>
                {editingId ? 'Save' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
