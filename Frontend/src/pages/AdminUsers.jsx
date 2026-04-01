import { useState, useCallback, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { fetchUsers, createUser, updateUserApi, deleteUser, fetchUserPorts, saveUserPorts } from '../api/usersApi'
import { fetchPorts } from '../api/ports'
import { assignUserRole, fetchRoles, fetchUserRoles, removeUserRole } from '../api/rbac'
import '../styles/allocation.css'
import '../styles/modal.css'
import '../styles/admin.css'

export default function AdminUsers() {
  const [users, setUsers] = useState([])
  const [userRolesById, setUserRolesById] = useState({})
  const [loading, setLoading] = useState(true)
  const [listErr, setListErr] = useState(null)
  const [roles, setRoles] = useState([])
  const [rolesErr, setRolesErr] = useState(null)
  const [ports, setPorts] = useState([])
  const [portsErr, setPortsErr] = useState(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [formUsername, setFormUsername] = useState('')
  const [formPassword, setFormPassword] = useState('')
  const [formDisplayName, setFormDisplayName] = useState('')
  const [formEmail, setFormEmail] = useState('')
  const [formActive, setFormActive] = useState(true)
  const [formRoleIds, setFormRoleIds] = useState([])
  const [initialRoleIds, setInitialRoleIds] = useState([])
  const [formPortIds, setFormPortIds] = useState([])
  const [portSearch, setPortSearch] = useState('')
  const [modalErr, setModalErr] = useState(null)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null)

  const load = useCallback(async () => {
    setListErr(null)
    setLoading(true)
    try {
      const list = await fetchUsers()
      const nextUsers = Array.isArray(list) ? list : []
      setUsers(nextUsers)

      // Load assigned roles for display in the table (best-effort).
      const settled = await Promise.allSettled(
        nextUsers.map(async (u) => {
          const assigned = await fetchUserRoles(u.id)
          return [u.id, Array.isArray(assigned) ? assigned : []]
        })
      )
      const map = {}
      for (const s of settled) {
        if (s.status === 'fulfilled') {
          const [id, assigned] = s.value
          map[id] = assigned
        }
      }
      setUserRolesById(map)
    } catch (e) {
      setListErr(e?.message || 'Failed to load users (sign in as admin?)')
      setUsers([])
      setUserRolesById({})
    } finally {
      setLoading(false)
    }
  }, [])

  const loadRoles = useCallback(async () => {
    setRolesErr(null)
    try {
      const list = await fetchRoles()
      setRoles(Array.isArray(list) ? list : [])
    } catch (e) {
      setRolesErr(e?.message || 'Failed to load roles')
      setRoles([])
    }
  }, [])

  const loadPorts = useCallback(async () => {
    setPortsErr(null)
    try {
      const list = await fetchPorts()
      setPorts(Array.isArray(list) ? list : [])
    } catch (e) {
      setPortsErr(e?.message || 'Failed to load ports')
      setPorts([])
    }
  }, [])

  useEffect(() => {
    load()
    loadRoles()
    loadPorts()
  }, [load, loadRoles, loadPorts])

  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(null), 3000)
    return () => window.clearTimeout(timer)
  }, [toast])

  const openAdd = useCallback(() => {
    setEditingId(null)
    setFormUsername('')
    setFormPassword('')
    setFormDisplayName('')
    setFormEmail('')
    setFormActive(true)
    setFormRoleIds([])
    setInitialRoleIds([])
    setFormPortIds([])
    setPortSearch('')
    setModalErr(null)
    setModalOpen(true)
  }, [])

  const openEdit = useCallback(async (user) => {
    setEditingId(user.id)
    setFormUsername(user.username || '')
    setFormPassword('')
    setFormDisplayName(user.displayName || '')
    setFormEmail(user.email || '')
    setFormActive(user.isActive !== false)
    setFormRoleIds([])
    setInitialRoleIds([])
    setFormPortIds(
      Array.isArray(user?.assignedPorts)
        ? user.assignedPorts.map((p) => Number(p.id)).filter((n) => Number.isFinite(n))
        : []
    )
    setPortSearch('')
    setModalErr(null)
    setModalOpen(true)

    try {
      const [assignedRoles, assignedPorts] = await Promise.all([
        fetchUserRoles(user.id),
        fetchUserPorts(user.id),
      ])
      const roleIds = (Array.isArray(assignedRoles) ? assignedRoles : []).map((r) => r.id)
      const portIds = (Array.isArray(assignedPorts?.assignedPorts) ? assignedPorts.assignedPorts : [])
        .map((p) => Number(p.id))
        .filter((n) => Number.isFinite(n))
      setFormRoleIds(roleIds)
      setInitialRoleIds(roleIds)
      setFormPortIds(portIds)
    } catch (e) {
      setModalErr(e?.message || 'Failed to refresh user roles/ports, showing cached assignments')
    }
  }, [])

  const closeModal = useCallback(() => {
    setModalOpen(false)
    setEditingId(null)
    setModalErr(null)
  }, [])

  const toggleRole = useCallback((roleId, checked) => {
    setFormRoleIds((prev) => {
      const set = new Set(prev)
      if (checked) set.add(roleId)
      else set.delete(roleId)
      return Array.from(set)
    })
  }, [])

  const togglePort = useCallback((portId, checked) => {
    setFormPortIds((prev) => {
      const set = new Set(prev)
      if (checked) set.add(portId)
      else set.delete(portId)
      return Array.from(set)
    })
  }, [])

  const handleSubmit = useCallback(async () => {
    const username = (formUsername || '').trim()
    if (!username) {
      setModalErr('Username required')
      return
    }
    if (!editingId && !(formPassword || '').trim()) {
      setModalErr('Password required for new user')
      return
    }
    setModalErr(null)
    setSaving(true)
    try {
      let userId = editingId
      if (editingId) {
        await updateUserApi(editingId, {
          displayName: formDisplayName,
          email: formEmail,
          isActive: formActive,
          password: (formPassword || '').trim() || undefined,
        })
      } else {
        const created = await createUser({
          username,
          password: formPassword,
          displayName: formDisplayName,
          email: formEmail,
          isActive: formActive,
        })
        userId = created?.id
      }

      // Sync roles (multi-role)
      if (userId) {
        const next = new Set(formRoleIds.map((x) => String(x)))
        const prev = new Set(initialRoleIds.map((x) => String(x)))

        for (const roleId of next) {
          if (!prev.has(roleId)) {
            await assignUserRole(userId, roleId)
          }
        }
        for (const roleId of prev) {
          if (!next.has(roleId)) {
            await removeUserRole(userId, roleId)
          }
        }
        await saveUserPorts(userId, formPortIds)
      }

      await load()
      setToast({
        kind: 'success',
        text: `User saved successfully. ${formPortIds.length} port${formPortIds.length === 1 ? '' : 's'} assigned.`,
      })
      closeModal()
    } catch (e) {
      setModalErr(e?.message || 'Save failed')
      setToast({ kind: 'error', text: e?.message || 'Save failed' })
    } finally {
      setSaving(false)
    }
  }, [
    editingId,
    formUsername,
    formPassword,
    formDisplayName,
    formEmail,
    formActive,
    formRoleIds,
    formPortIds,
    initialRoleIds,
    load,
    closeModal,
  ])

  const handleDelete = useCallback(
    async (id) => {
      if (!window.confirm('Soft-delete this user?')) return
      try {
        await deleteUser(id)
        await load()
        setToast({ kind: 'success', text: 'User deleted successfully.' })
      } catch (e) {
        setToast({ kind: 'error', text: e?.message || 'Delete failed' })
      }
    },
    [load]
  )

  const filteredPorts = ports.filter((p) => {
    const q = (portSearch || '').trim().toLowerCase()
    if (!q) return true
    return String(p.name || '').toLowerCase().includes(q)
  })

  const selectAllVisiblePorts = useCallback(() => {
    setFormPortIds((prev) => {
      const set = new Set(prev)
      for (const p of filteredPorts) set.add(p.id)
      return Array.from(set)
    })
  }, [filteredPorts])

  const clearAllVisiblePorts = useCallback(() => {
    const visibleIds = new Set(filteredPorts.map((p) => p.id))
    setFormPortIds((prev) => prev.filter((id) => !visibleIds.has(id)))
  }, [filteredPorts])

  return (
    <div className="allocation-page">
      <h1 className="page-title">User Management</h1>
      <p className="allocation-page__intro">
        <Link to="/admin" className="link">← Back to Admin</Link>
      </p>
      {toast && (
        <div
          className={`toast ${toast.kind === 'error' ? 'toast--error' : 'toast--success'}`}
          role="status"
          aria-live="polite"
          style={{ marginTop: 12 }}
        >
          {toast.text}
        </div>
      )}
      {listErr && <p style={{ color: '#c00' }}>{listErr}</p>}

      <section className="card at-berth-list-section">
        <div className="card__header-row">
          <h2 className="card__title">Users</h2>
          <button type="button" className="btn btn--primary" onClick={openAdd}>
            Add User
          </button>
        </div>
        {loading ? (
          <p className="text-steel">Loading…</p>
        ) : users.length === 0 ? (
          <p className="text-steel">No users or not authorized. <Link to="/login">Login</Link> as admin.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table allocation-table">
              <thead>
                <tr>
                  <th className="allocation-table__th">User</th>
                  <th className="allocation-table__th">Email</th>
                  <th className="allocation-table__th">Roles</th>
                  <th className="allocation-table__th">Ports</th>
                  <th className="allocation-table__th">Status</th>
                  <th className="allocation-table__action-col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="allocation-table__row" style={u.isActive === false ? { opacity: 0.7 } : undefined}>
                    <td>
                      <strong>{u.displayName || u.username || '—'}</strong>
                      {u.displayName && u.username && (
                        <span className="admin-role-summary" style={{ display: 'block' }}>{u.username}</span>
                      )}
                    </td>
                    <td>{u.email || '—'}</td>
                    <td className="text-steel">
                      {(userRolesById[u.id] || [])
                        .map((r) => roles.find((x) => x.id === r.id)?.name || r.name || r.id)
                        .join(', ') || '—'}
                    </td>
                    <td className="text-steel">
                      {(Array.isArray(u.assignedPorts) ? u.assignedPorts : [])
                        .map((p) => p.name)
                        .join(', ') || '—'}
                    </td>
                    <td>
                      <span className={u.isActive !== false ? 'admin-status-badge admin-status-badge--active' : 'admin-status-badge admin-status-badge--inactive'}>
                        {u.isActive !== false ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="allocation-table__action-col">
                      <button type="button" className="btn btn--small btn--secondary" onClick={() => openEdit(u)}>
                        Edit
                      </button>
                      <button type="button" className="btn btn--small btn--secondary" style={{ marginLeft: 6 }} onClick={() => handleDelete(u.id)}>
                        Delete
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
          <div className="modal modal--wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-labelledby="user-modal-title" aria-modal="true">
            <h2 id="user-modal-title" className="modal__title">{editingId ? 'Edit User' : 'Add User'}</h2>
            <div className="modal__section">
              <label htmlFor="user-username" className="modal__label">Username</label>
              <input
                id="user-username"
                type="text"
                className="modal__input"
                value={formUsername}
                onChange={(e) => setFormUsername(e.target.value)}
                disabled={!!editingId}
                placeholder="e.g. jane.doe"
              />
            </div>
            <div className="modal__section">
              <label htmlFor="user-password" className="modal__label">
                {editingId ? 'New password (optional)' : 'Password'}
              </label>
              <input
                id="user-password"
                type="password"
                className="modal__input"
                value={formPassword}
                onChange={(e) => setFormPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <div className="modal__section">
              <label htmlFor="user-displayname" className="modal__label">Display name</label>
              <input id="user-displayname" type="text" className="modal__input" value={formDisplayName} onChange={(e) => setFormDisplayName(e.target.value)} />
            </div>
            <div className="modal__section">
              <label htmlFor="user-email" className="modal__label">Email</label>
              <input id="user-email" type="email" className="modal__input" value={formEmail} onChange={(e) => setFormEmail(e.target.value)} />
            </div>
            <div className="modal__section">
              <label className="modal__label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={formActive} onChange={(e) => setFormActive(e.target.checked)} />
                Active
              </label>
            </div>
            <div className="modal__section">
              <div className="modal__label">Roles (multi-select)</div>
              {rolesErr && <p style={{ color: '#c00', marginTop: 6 }}>{rolesErr}</p>}
              {roles.length === 0 ? (
                <p className="text-steel" style={{ marginTop: 6 }}>No roles found.</p>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8, marginTop: 8 }}>
                  {roles.map((r) => (
                    <label key={r.id} className="text-steel" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input
                        type="checkbox"
                        checked={formRoleIds.includes(r.id)}
                        onChange={(e) => toggleRole(r.id, e.target.checked)}
                      />
                      <span>
                        {r.name}
                        {r.isSystemRole ? <span className="admin-role-summary"> (system)</span> : null}
                      </span>
                    </label>
                  ))}
                </div>
              )}
              <p className="text-steel" style={{ marginTop: 8 }}>
                Tip: roles control page access (View/Edit/Delete) via RBAC.
              </p>
            </div>
            <div className="modal__section">
              <div className="modal__label">Port Access (multi-select)</div>
              {portsErr && <p style={{ color: '#c00', marginTop: 6 }}>{portsErr}</p>}
              <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
                <input
                  type="text"
                  className="modal__input"
                  style={{ margin: 0 }}
                  placeholder="Search port..."
                  value={portSearch}
                  onChange={(e) => setPortSearch(e.target.value)}
                />
                <button type="button" className="btn btn--secondary btn--small" onClick={selectAllVisiblePorts}>
                  Select visible
                </button>
                <button type="button" className="btn btn--secondary btn--small" onClick={clearAllVisiblePorts}>
                  Clear visible
                </button>
              </div>
              {ports.length === 0 ? (
                <p className="text-steel" style={{ marginTop: 6 }}>No ports found.</p>
              ) : (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                    gap: 8,
                    marginTop: 8,
                    maxHeight: 180,
                    overflow: 'auto',
                    border: '1px solid var(--color-border, #d8dbe1)',
                    borderRadius: 8,
                    padding: 8,
                  }}
                >
                  {filteredPorts.map((p) => (
                    <label key={p.id} className="text-steel" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input
                        type="checkbox"
                        checked={formPortIds.includes(p.id)}
                        onChange={(e) => togglePort(p.id, e.target.checked)}
                      />
                      <span>{p.name}</span>
                    </label>
                  ))}
                </div>
              )}
              <p className="text-steel" style={{ marginTop: 8 }}>
                Users without assigned ports cannot access operational modules.
              </p>
            </div>
            {modalErr && <p style={{ color: '#c00' }}>{modalErr}</p>}
            <div className="modal__footer">
              <button type="button" className="btn btn--secondary" onClick={closeModal}>Cancel</button>
              <button type="button" className="btn btn--primary" onClick={handleSubmit} disabled={saving}>
                {saving ? 'Saving…' : editingId ? 'Save' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
