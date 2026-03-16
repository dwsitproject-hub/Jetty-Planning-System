import { useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  getDepartments,
  getActiveDepartments,
  addDepartment,
  updateDepartment,
} from '../data/departmentsData'
import { countUsersByDepartmentId } from '../data/usersData'
import '../styles/allocation.css'
import '../styles/modal.css'
import '../styles/admin.css'

export default function AdminDepartments() {
  const [departments, setDepartments] = useState(() => getDepartments())
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [formName, setFormName] = useState('')
  const [formCode, setFormCode] = useState('')
  const [formActive, setFormActive] = useState(true)

  const refresh = useCallback(() => setDepartments(getDepartments()), [])

  const openAdd = useCallback(() => {
    setEditingId(null)
    setFormName('')
    setFormCode('')
    setFormActive(true)
    setModalOpen(true)
  }, [])

  const openEdit = useCallback((dept) => {
    setEditingId(dept.id)
    setFormName(dept.name || '')
    setFormCode(dept.code || '')
    setFormActive(dept.isActive !== false)
    setModalOpen(true)
  }, [])

  const closeModal = useCallback(() => {
    setModalOpen(false)
    setEditingId(null)
    setFormName('')
    setFormCode('')
    setFormActive(true)
  }, [])

  const handleSubmit = useCallback(() => {
    const name = (formName || '').trim()
    if (!name) return
    if (editingId) {
      updateDepartment(editingId, { name, code: formCode, isActive: formActive })
    } else {
      addDepartment({ name, code: formCode, isActive: formActive })
    }
    refresh()
    closeModal()
  }, [editingId, formName, formCode, formActive, refresh, closeModal])

  const handleToggleActive = useCallback((dept) => {
    const userCount = countUsersByDepartmentId(dept.id)
    if (dept.isActive !== false && userCount > 0) {
      const ok = window.confirm(
        `${userCount} user(s) have this department. They will keep the assignment but the department will be inactive. Continue?`
      )
      if (!ok) return
    }
    updateDepartment(dept.id, { isActive: !dept.isActive })
    refresh()
  }, [refresh])

  return (
    <div className="allocation-page">
      <h1 className="page-title">Department Management</h1>
      <p className="allocation-page__intro">
        <Link to="/admin" className="link">← Back to Admin</Link>
      </p>
      <section className="card at-berth-list-section">
        <div className="card__header-row">
          <h2 className="card__title">Departments</h2>
          <button type="button" className="btn btn--primary" onClick={openAdd}>
            Add Department
          </button>
        </div>
        {departments.length === 0 ? (
          <p className="text-steel">No departments. Click Add Department to add one.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table allocation-table">
              <thead>
                <tr>
                  <th className="allocation-table__th">Name</th>
                  <th className="allocation-table__th">Code</th>
                  <th className="allocation-table__th">Status</th>
                  <th className="allocation-table__action-col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {departments.map((d) => (
                  <tr
                    key={d.id}
                    className="allocation-table__row"
                    style={d.isActive === false ? { opacity: 0.7 } : undefined}
                  >
                    <td><strong>{d.name || '—'}</strong></td>
                    <td>{d.code || '—'}</td>
                    <td>
                      <span className={d.isActive !== false ? 'admin-status-badge admin-status-badge--active' : 'admin-status-badge admin-status-badge--inactive'}>
                        {d.isActive !== false ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="allocation-table__action-col">
                      <button type="button" className="btn btn--small btn--secondary" onClick={() => openEdit(d)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn btn--small btn--secondary"
                        onClick={() => handleToggleActive(d)}
                        style={{ marginLeft: 4 }}
                      >
                        {d.isActive !== false ? 'Deactivate' : 'Activate'}
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
            aria-labelledby="dept-modal-title"
            aria-modal="true"
          >
            <h2 id="dept-modal-title" className="modal__title">
              {editingId ? 'Edit Department' : 'Add Department'}
            </h2>
            <div className="modal__section">
              <label htmlFor="dept-name" className="modal__label">Name</label>
              <input
                id="dept-name"
                type="text"
                className="modal__input"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g. Industrial - Jetty Operation"
              />
            </div>
            <div className="modal__section">
              <label htmlFor="dept-code" className="modal__label">Code (optional)</label>
              <input
                id="dept-code"
                type="text"
                className="modal__input"
                value={formCode}
                onChange={(e) => setFormCode(e.target.value)}
                placeholder="e.g. IJO"
              />
            </div>
            {editingId && (
              <div className="modal__section">
                <label className="modal__label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={formActive}
                    onChange={(e) => setFormActive(e.target.checked)}
                  />
                  Active
                </label>
              </div>
            )}
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
