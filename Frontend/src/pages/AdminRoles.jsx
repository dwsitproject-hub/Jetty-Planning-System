import { useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  getRoles,
  getRoleById,
  addRole,
  updateRole,
  getPermission,
  setPermission,
  PAGE_OPTIONS,
  FIELD_OPTIONS_BY_PAGE,
} from '../data/rolesData'
import { getActiveDepartments } from '../data/departmentsData'
import { countUsersByRoleId } from '../data/usersData'
import '../styles/allocation.css'
import '../styles/modal.css'
import '../styles/admin.css'

const PERM_TAB = { basic: 'basic', department: 'department', page: 'page', field: 'field' }

function PermissionRow({ label, perm, onChange }) {
  return (
    <tr>
      <td>{label}</td>
      <td className="admin-permission-table__cell--check">
        <input
          type="checkbox"
          checked={perm.view}
          onChange={(e) => onChange({ ...perm, view: e.target.checked })}
          aria-label={`View ${label}`}
        />
      </td>
      <td className="admin-permission-table__cell--check">
        <input
          type="checkbox"
          checked={perm.edit}
          onChange={(e) => onChange({ ...perm, edit: e.target.checked })}
          aria-label={`Edit ${label}`}
        />
      </td>
      <td className="admin-permission-table__cell--check">
        <input
          type="checkbox"
          checked={perm.delete}
          onChange={(e) => onChange({ ...perm, delete: e.target.checked })}
          aria-label={`Delete ${label}`}
        />
      </td>
    </tr>
  )
}

function FieldPermissionRow({ label, perm, onChange }) {
  return (
    <tr>
      <td>{label}</td>
      <td className="admin-permission-table__cell--check">
        <input
          type="checkbox"
          checked={perm.view}
          onChange={(e) => onChange({ ...perm, view: e.target.checked })}
          aria-label={`View ${label}`}
        />
      </td>
      <td className="admin-permission-table__cell--check">
        <input
          type="checkbox"
          checked={perm.edit}
          onChange={(e) => onChange({ ...perm, edit: e.target.checked })}
          aria-label={`Edit ${label}`}
        />
      </td>
      <td className="admin-permission-table__cell--check">—</td>
    </tr>
  )
}

function roleSummary(role) {
  const dept = role.permissions.filter((p) => p.resourceType === 'department').filter((p) => p.view || p.edit || p.delete).length
  const page = role.permissions.filter((p) => p.resourceType === 'page').filter((p) => p.view || p.edit || p.delete).length
  const parts = []
  if (page) parts.push(`${page} page(s)`)
  if (dept) parts.push(`${dept} dept(s)`)
  return parts.length ? parts.join(', ') : 'No permissions'
}

export default function AdminRoles() {
  const [roles, setRoles] = useState(() => getRoles())
  const [editingRoleId, setEditingRoleId] = useState(null)
  const [activeTab, setActiveTab] = useState(PERM_TAB.basic)
  const [formName, setFormName] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formPermissions, setFormPermissions] = useState([])

  const refresh = useCallback(() => setRoles(getRoles()), [])
  const role = editingRoleId ? getRoleById(editingRoleId) : null
  const isNew = editingRoleId === 'new'

  const openList = useCallback(() => {
    setEditingRoleId(null)
    setActiveTab(PERM_TAB.basic)
    refresh()
  }, [refresh])

  const openAdd = useCallback(() => {
    setEditingRoleId('new')
    setFormName('')
    setFormDescription('')
    setFormPermissions([])
    setActiveTab(PERM_TAB.basic)
  }, [])

  const openEdit = useCallback((r) => {
    setEditingRoleId(r.id)
    setFormName(r.name || '')
    setFormDescription(r.description || '')
    setFormPermissions(r.permissions ? r.permissions.map((p) => ({ ...p })) : [])
    setActiveTab(PERM_TAB.basic)
  }, [])

  const updatePerm = useCallback((resourceType, resourceKey, upd) => {
    setFormPermissions((prev) => setPermission(prev, { resourceType, resourceKey, ...upd }))
  }, [])

  const handleSaveRole = useCallback(() => {
    const name = (formName || '').trim()
    if (!name) return
    if (isNew) {
      addRole({ name, description: formDescription, permissions: formPermissions })
    } else {
      updateRole(editingRoleId, { name, description: formDescription, permissions: formPermissions })
    }
    openList()
  }, [isNew, editingRoleId, formName, formDescription, formPermissions, openList])

  if (editingRoleId !== null) {
    const departments = getActiveDepartments()
    const fieldPageIds = Object.keys(FIELD_OPTIONS_BY_PAGE)

    return (
      <div className="allocation-page">
        <h1 className="page-title">{isNew ? 'Add Role' : 'Edit Role'}</h1>
        <p className="allocation-page__intro">
          <button type="button" className="link" onClick={openList} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>← Back to Role Management</button>
        </p>

        <div className="admin-tabs">
          {['basic', 'department', 'page', 'field'].map((tab) => (
            <button
              key={tab}
              type="button"
              className={`admin-tabs__tab ${activeTab === tab ? 'admin-tabs__tab--active' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab === 'basic' && 'Basic'}
              {tab === 'department' && 'Departments'}
              {tab === 'page' && 'Pages'}
              {tab === 'field' && 'Fields'}
            </button>
          ))}
        </div>

        {activeTab === PERM_TAB.basic && (
          <section className="card">
            <div className="modal__section">
              <label htmlFor="role-name" className="modal__label">Role name</label>
              <input
                id="role-name"
                type="text"
                className="modal__input"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g. Allocator"
              />
            </div>
            <div className="modal__section">
              <label htmlFor="role-desc" className="modal__label">Description (optional)</label>
              <textarea
                id="role-desc"
                className="modal__input modal__textarea"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="Brief description"
                rows={2}
              />
            </div>
          </section>
        )}

        {activeTab === PERM_TAB.department && (
          <section className="card">
            <h3 className="admin-section-title">1. Department access</h3>
            <p className="text-steel" style={{ marginBottom: 'var(--spacing-3)' }}>Which departments can this role view, edit, or delete.</p>
            <div className="table-wrap">
              <table className="admin-permission-table">
                <thead>
                  <tr>
                    <th>Department</th>
                    <th className="admin-permission-table__th--check">View</th>
                    <th className="admin-permission-table__th--check">Edit</th>
                    <th className="admin-permission-table__th--check">Delete</th>
                  </tr>
                </thead>
                <tbody>
                  {departments.map((d) => {
                    const perm = getPermission(formPermissions, 'department', d.id)
                    return (
                      <PermissionRow
                        key={d.id}
                        label={d.name}
                        perm={perm}
                        onChange={(p) => updatePerm('department', d.id, p)}
                      />
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activeTab === PERM_TAB.page && (
          <section className="card">
            <h3 className="admin-section-title">2. Page access</h3>
            <p className="text-steel" style={{ marginBottom: 'var(--spacing-3)' }}>Which pages can this role view, edit, or delete.</p>
            <div className="table-wrap">
              <table className="admin-permission-table">
                <thead>
                  <tr>
                    <th>Page</th>
                    <th className="admin-permission-table__th--check">View</th>
                    <th className="admin-permission-table__th--check">Edit</th>
                    <th className="admin-permission-table__th--check">Delete</th>
                  </tr>
                </thead>
                <tbody>
                  {PAGE_OPTIONS.map((p) => {
                    const perm = getPermission(formPermissions, 'page', p.id)
                    return (
                      <PermissionRow
                        key={p.id}
                        label={p.label}
                        perm={perm}
                        onChange={(pUpd) => updatePerm('page', p.id, pUpd)}
                      />
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activeTab === PERM_TAB.field && (
          <section className="card">
            <h3 className="admin-section-title">3. Field access (per page)</h3>
            <p className="text-steel" style={{ marginBottom: 'var(--spacing-3)' }}>Which fields can this role view or edit. Only pages with field-level control are listed.</p>
            {fieldPageIds.map((pageId) => {
              const fields = FIELD_OPTIONS_BY_PAGE[pageId] || []
              const pageLabel = PAGE_OPTIONS.find((p) => p.id === pageId)?.label || pageId
              return (
                <div key={pageId} style={{ marginBottom: 'var(--spacing-4)' }}>
                  <h4 style={{ fontSize: 'var(--font-size-small)', marginBottom: 'var(--spacing-2)' }}>{pageLabel}</h4>
                  <div className="table-wrap">
                    <table className="admin-permission-table">
                      <thead>
                        <tr>
                          <th>Field</th>
                          <th className="admin-permission-table__th--check">View</th>
                          <th className="admin-permission-table__th--check">Edit</th>
                          <th className="admin-permission-table__th--check">Delete</th>
                        </tr>
                      </thead>
                      <tbody>
                        {fields.map((f) => {
                          const resourceKey = `${pageId}.${f.id}`
                          const perm = getPermission(formPermissions, 'field', resourceKey)
                          return (
                            <FieldPermissionRow
                              key={resourceKey}
                              label={f.label}
                              perm={perm}
                              onChange={(p) => updatePerm('field', resourceKey, p)}
                            />
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            })}
            {fieldPageIds.length === 0 && <p className="text-steel">No pages with field-level permissions defined.</p>}
          </section>
        )}

        <div className="modal__footer" style={{ marginTop: 'var(--spacing-4)' }}>
          <button type="button" className="btn btn--secondary" onClick={openList}>Cancel</button>
          <button type="button" className="btn btn--primary" onClick={handleSaveRole}>Save role</button>
        </div>
      </div>
    )
  }

  return (
    <div className="allocation-page">
      <h1 className="page-title">Role Management</h1>
      <p className="allocation-page__intro">
        <Link to="/admin" className="link">← Back to Admin</Link>
      </p>
      <section className="card at-berth-list-section">
        <div className="card__header-row">
          <h2 className="card__title">Roles</h2>
          <button type="button" className="btn btn--primary" onClick={openAdd}>
            Add Role
          </button>
        </div>
        {roles.length === 0 ? (
          <p className="text-steel">No roles. Click Add Role to create one and set permissions (Departments, Pages, Fields).</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table allocation-table">
              <thead>
                <tr>
                  <th className="allocation-table__th">Name</th>
                  <th className="allocation-table__th">Description</th>
                  <th className="allocation-table__th">Users</th>
                  <th className="allocation-table__th">Permissions</th>
                  <th className="allocation-table__action-col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {roles.map((r) => (
                  <tr key={r.id} className="allocation-table__row">
                    <td><strong>{r.name || '—'}</strong></td>
                    <td>{(r.description || '').slice(0, 50)}{(r.description || '').length > 50 ? '…' : ''}</td>
                    <td>{countUsersByRoleId(r.id)}</td>
                    <td><span className="admin-role-summary">{roleSummary(r)}</span></td>
                    <td className="allocation-table__action-col">
                      <button type="button" className="btn btn--small btn--secondary" onClick={() => openEdit(r)}>
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
    </div>
  )
}
