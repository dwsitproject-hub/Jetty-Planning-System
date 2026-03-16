import { useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { getPorts, addPort, updatePort } from '../data/masterData'
import { useActivityLog } from '../context/ActivityLogContext'
import '../styles/allocation.css'
import '../styles/modal.css'

export default function MasterPort() {
  const { logActivity } = useActivityLog()
  const [ports, setPorts] = useState(() => getPorts())
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
    setFormDescription(port.description || '')
    setModalOpen(true)
  }, [])

  const closeModal = useCallback(() => {
    setModalOpen(false)
    setEditingId(null)
    setFormName('')
    setFormDescription('')
  }, [])

  const handleSubmit = useCallback(() => {
    const name = (formName || '').trim()
    if (!name) return
    if (editingId) {
      updatePort(editingId, { name, description: formDescription || '' })
      logActivity({ pageKey: 'master-port', action: 'update', entityType: 'Port', entityLabel: name })
    } else {
      addPort({ name, description: formDescription || '' })
      logActivity({ pageKey: 'master-port', action: 'add', entityType: 'Port', entityLabel: name })
    }
    setPorts(getPorts())
    closeModal()
  }, [editingId, formName, formDescription, closeModal, logActivity])

  return (
    <div className="allocation-page">
      <h1 className="page-title">Master – Port</h1>
      <p className="allocation-page__intro">
        Add and manage master port / site data.
      </p>
      <p className="text-steel">
        <Link to="/master" className="link">← Back to Master Menu</Link>
      </p>

      <section className="card at-berth-list-section">
        <div className="card__header-row">
          <h2 className="card__title">Ports</h2>
          <button type="button" className="btn btn--primary" onClick={openAdd}>
            Add Port
          </button>
        </div>
        {ports.length === 0 ? (
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
                    <td>{p.description ? (p.description.length > 60 ? p.description.slice(0, 60) + '…' : p.description) : '—'}</td>
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
              {editingId ? 'Edit Port' : 'Add Port'}
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
