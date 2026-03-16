import { useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { getUsers, addUser, updateUser } from '../data/usersData'
import { getActiveDepartments, getDepartmentById } from '../data/departmentsData'
import { getRoles, getRoleById } from '../data/rolesData'
import '../styles/allocation.css'
import '../styles/modal.css'
import '../styles/admin.css'

export default function AdminUsers() {
  const [users, setUsers] = useState(() => getUsers())
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [formUsername, setFormUsername] = useState('')
  const [formDisplayName, setFormDisplayName] = useState('')
  const [formEmail, setFormEmail] = useState('')
  const [formActive, setFormActive] = useState(true)
  const [formDepartmentIds, setFormDepartmentIds] = useState([])
  const [formRoleIds, setFormRoleIds] = useState([])

  const departments = getActiveDepartments()
  const roles = getRoles()

  const refresh = useCallback(() => setUsers(getUsers()), [])

  const toggleArray = (arr, id) =>
    arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]

  const openAdd = useCallback(() => {
    setEditingId(null)
    setFormUsername('')
    setFormDisplayName('')
    setFormEmail('')
    setFormActive(true)
    setFormDepartmentIds([])
    setFormRoleIds([])
    setModalOpen(true)
  }, [])

  const openEdit = useCallback((user) => {
    setEditingId(user.id)
    setFormUsername(user.username || '')
    setFormDisplayName(user.displayName || '')
    setFormEmail(user.email || '')
    setFormActive(user.isActive !== false)
    setFormDepartmentIds(user.departmentIds ? [...user.departmentIds] : [])
    setFormRoleIds(user.roleIds ? [...user.roleIds] : [])
    setModalOpen(true)
  }, [])

  const closeModal = useCallback(() => {
    setModalOpen(false)
    setEditingId(null)
  }, [])

  const handleSubmit = useCallback(() => {
    const username = (formUsername || '').trim()
    if (!username) return
    if (editingId) {
      updateUser(editingId, {
        username,
        displayName: formDisplayName,
        email: formEmail,
        isActive: formActive,
        departmentIds: formDepartmentIds,
        roleIds: formRoleIds,
      })
    } else {
      addUser({
        username,
        displayName: formDisplayName,
        email: formEmail,
        isActive: formActive,
        departmentIds: formDepartmentIds,
        roleIds: formRoleIds,
      })
    }
    refresh()
    closeModal()
  }, [editingId, formUsername, formDisplayName, formEmail, formActive, formDepartmentIds, formRoleIds, refresh, closeModal])

  const departmentNames = (ids) =>
    (ids || [])
      .map((id) => getDepartmentById(id)?.name)
      .filter(Boolean)
      .join(', ') || '—'
  const roleNames = (ids) =>
    (ids || []).map((id) => getRoleById(id)?.name).filter(Boolean).join(', ') || '—'

  return (
    <div className="allocation-page">
      <h1 className="page-title">User Management</h1>
      <p className="allocation-page__intro">
        <Link to="/admin" className="link">← Back to Admin</Link>
      </p>
      <section className="card at-berth-list-section">
        <div className="card__header-row">
          <h2 className="card__title">Users</h2>
          <button type="button" className="btn btn--primary" onClick={openAdd}>
            Add User
          </button>
        </div>
        {users.length === 0 ? (
          <p className="text-steel">No users. Click Add User to add one and assign departments and roles.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table allocation-table">
              <thead>
                <tr>
                  <th className="allocation-table__th">User</th>
                  <th className="allocation-table__th">Email</th>
                  <th className="allocation-table__th">Departments</th>
                  <th className="allocation-table__th">Roles</th>
                  <th className="allocation-table__th">Status</th>
                  <th className="allocation-table__action-col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="allocation-table__row" style={u.isActive === false ? { opacity: 0.7 } : undefined}>
                    <td>
                      <strong>{u.displayName || u.username || '—'}</strong>
                      {u.displayName && u.username && <span className="admin-role-summary" style={{ display: 'block' }}>{u.username}</span>}
                    </td>
                    <td>{u.email || '—'}</td>
                    <td>{departmentNames(u.departmentIds)}</td>
                    <td>{roleNames(u.roleIds)}</td>
                    <td>
                      <span className={u.isActive !== false ? 'admin-status-badge admin-status-badge--active' : 'admin-status-badge admin-status-badge--inactive'}>
                        {u.isActive !== false ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="allocation-table__action-col">
                      <button type="button" className="btn btn--small btn--secondary" onClick={() => openEdit(u)}>
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
            aria-labelledby="user-modal-title"
            aria-modal="true"
          >
            <h2 id="user-modal-title" className="modal__title">
              {editingId ? 'Edit User' : 'Add User'}
            </h2>
            <div className="modal__section">
              <label htmlFor="user-username" className="modal__label">Username / Login</label>
              <input
                id="user-username"
                type="text"
                className="modal__input"
                value={formUsername}
                onChange={(e) => setFormUsername(e.target.value)}
                placeholder="e.g. jane.doe"
              />
            </div>
            <div className="modal__section">
              <label htmlFor="user-displayname" className="modal__label">Display name (optional)</label>
              <input
                id="user-displayname"
                type="text"
                className="modal__input"
                value={formDisplayName}
                onChange={(e) => setFormDisplayName(e.target.value)}
                placeholder="e.g. Jane Doe"
              />
            </div>
            <div className="modal__section">
              <label htmlFor="user-email" className="modal__label">Email (optional)</label>
              <input
                id="user-email"
                type="email"
                className="modal__input"
                value={formEmail}
                onChange={(e) => setFormEmail(e.target.value)}
                placeholder="jane@example.com"
              />
            </div>
            <div className="modal__section">
              <span className="modal__label">Departments</span>
              <div className="admin-multiselect">
                {departments.length === 0 ? (
                  <p className="text-steel">No active departments. Add departments first.</p>
                ) : (
                  departments.map((d) => (
                    <label key={d.id} className="admin-multiselect__item">
                      <input
                        type="checkbox"
                        checked={formDepartmentIds.includes(d.id)}
                        onChange={() => setFormDepartmentIds((prev) => toggleArray(prev, d.id))}
                      />
                      {d.name}
                    </label>
                  ))
                )}
              </div>
            </div>
            <div className="modal__section">
              <span className="modal__label">Roles</span>
              <div className="admin-multiselect">
                {roles.length === 0 ? (
                  <p className="text-steel">No roles. Add roles in Role Management first.</p>
                ) : (
                  roles.map((r) => (
                    <label key={r.id} className="admin-multiselect__item">
                      <input
                        type="checkbox"
                        checked={formRoleIds.includes(r.id)}
                        onChange={() => setFormRoleIds((prev) => toggleArray(prev, r.id))}
                      />
                      {r.name}
                    </label>
                  ))
                )}
              </div>
            </div>
            <div className="modal__section">
              <label className="modal__label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={formActive} onChange={(e) => setFormActive(e.target.checked)} />
                Active
              </label>
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
