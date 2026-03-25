import { useEffect, useState, useCallback, Fragment } from 'react'
import { Link } from 'react-router-dom'
import { PAGE_OPTIONS } from '../data/rolesData'
import {
  createRole,
  deleteRoleApi,
  fetchPagePermissionCatalog,
  fetchRole,
  fetchRolePagePermissions,
  fetchRoles,
  updateRoleApi,
  upsertRolePermission,
} from '../api/rbac'
import '../styles/allocation.css'
import '../styles/modal.css'
import '../styles/admin.css'

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

function getPermission(perms, resourceType, resourceKey) {
  const p = perms.find((x) => x.resourceType === resourceType && x.resourceKey === resourceKey)
  return p ? { view: !!p.view, edit: !!p.edit, delete: !!p.delete } : { view: false, edit: false, delete: false }
}

const PAGE_LABEL_BY_ID = Object.fromEntries(PAGE_OPTIONS.map((p) => [p.id, p.label]))

/** API rows from fetchRolePagePermissions → granted pages only (for read-only summary table) */
function buildRolePageSummary(rows) {
  const list = Array.isArray(rows) ? rows : []
  return list
    .filter((p) => {
      if (p.resourceType !== 'page') return false
      const v = p.canView ?? p.can_view
      const e = p.canEdit ?? p.can_edit
      const d = p.canDelete ?? p.can_delete
      return Boolean(v || e || d)
    })
    .map((p) => {
      const label = PAGE_LABEL_BY_ID[p.resourceKey] || p.resourceKey || '—'
      return {
        key: p.resourceKey,
        label,
        view: Boolean(p.canView ?? p.can_view),
        edit: Boolean(p.canEdit ?? p.can_edit),
        delete: Boolean(p.canDelete ?? p.can_delete),
      }
    })
    .sort((a, b) => a.label.localeCompare(b.label))
}

export default function AdminRoles() {
  const [roles, setRoles] = useState([])
  const [editingRoleId, setEditingRoleId] = useState(null)
  const [formName, setFormName] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formPermissions, setFormPermissions] = useState([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(null)
  const [expandedRoleId, setExpandedRoleId] = useState(null)
  /** @type {[Record<string, { loading?: boolean, error?: string, items?: unknown[] }>, function]} */
  const [rolePageDetailById, setRolePageDetailById] = useState({})

  const refresh = useCallback(async () => {
    setLoading(true)
    setErr(null)
    setRolePageDetailById({})
    try {
      const data = await fetchRoles()
      setRoles(Array.isArray(data) ? data : [])
    } catch (e) {
      setErr(e?.message || 'Failed to load roles')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const isNew = editingRoleId === 'new'

  const openList = useCallback(() => {
    setEditingRoleId(null)
    setExpandedRoleId(null)
  }, [])

  const toggleRoleExpand = useCallback((roleId) => {
    setExpandedRoleId((cur) => (cur === roleId ? null : roleId))
  }, [])

  // Load page permissions when a row is expanded. IMPORTANT: depend only on `expandedRoleId`.
  // If `rolePageDetailById` were in the dependency array, setting `{ loading: true }` would re-run
  // this effect, the cleanup would set cancelled=true, and the in-flight fetch would never update state.
  useEffect(() => {
    const id = expandedRoleId
    if (id == null || id === '') return
    const key = String(id)

    let cancelled = false

    setRolePageDetailById((prev) => {
      if (prev[key]?.items != null) return prev
      return { ...prev, [key]: { loading: true } }
    })

    fetchRolePagePermissions(id)
      .then((items) => {
        if (cancelled) return
        const list = Array.isArray(items) ? items : []
        setRolePageDetailById((prev) => ({
          ...prev,
          [key]: { loading: false, items: list },
        }))
      })
      .catch((e) => {
        if (cancelled) return
        setRolePageDetailById((prev) => ({
          ...prev,
          [key]: { loading: false, error: e?.message || 'Failed to load page permissions' },
        }))
      })

    return () => {
      cancelled = true
    }
  }, [expandedRoleId])

  const openAdd = useCallback(() => {
    setEditingRoleId('new')
    setFormName('')
    setFormDescription('')
    setLoading(true)
    setErr(null)
    fetchPagePermissionCatalog()
      .then((items) => {
        const byKey = new Map((Array.isArray(items) ? items : []).map((p) => [p.resourceKey, p]))
        setFormPermissions(
          PAGE_OPTIONS.map((opt) => {
            const p = byKey.get(opt.id)
            return {
              permissionId: p?.id ?? null,
              resourceType: 'page',
              resourceKey: opt.id,
              view: false,
              edit: false,
              delete: false,
            }
          }).filter((p) => p.permissionId !== null)
        )
      })
      .catch((e) => setErr(e?.message || 'Failed to load page permissions'))
      .finally(() => setLoading(false))
  }, [])

  const openEdit = useCallback(async (r) => {
    setEditingRoleId(r.id)
    setLoading(true)
    setErr(null)
    try {
      const full = await fetchRole(r.id)
      setFormName(full?.name || '')
      setFormDescription(full?.description || '')
      const perms = await fetchRolePagePermissions(r.id)
      setFormPermissions(
        (Array.isArray(perms) ? perms : []).map((p) => ({
          permissionId: p.id,
          resourceType: p.resourceType,
          resourceKey: p.resourceKey,
          view: !!p.canView,
          edit: !!p.canEdit,
          delete: !!p.canDelete,
        }))
      )
    } catch (e) {
      setErr(e?.message || 'Failed to load role')
    } finally {
      setLoading(false)
    }
  }, [])

  const handleSaveRole = useCallback(async () => {
    const name = (formName || '').trim()
    if (!name) return
    setLoading(true)
    setErr(null)
    try {
      if (isNew) {
        const created = await createRole({ name, description: formDescription })
        const roleId = created?.id
        if (roleId) {
          const catalog = await fetchPagePermissionCatalog()
          const byKey = new Map((Array.isArray(catalog) ? catalog : []).map((p) => [p.resourceKey, p]))

          const pending = formPermissions
            .filter((p) => p.view || p.edit || p.delete)
            .map((p) => ({
              ...p,
              permissionId: p.permissionId ?? byKey.get(p.resourceKey)?.id ?? null,
            }))
            .filter((p) => p.permissionId !== null)

          for (const p of pending) {
            await upsertRolePermission(roleId, {
              permissionId: p.permissionId,
              canView: !!p.view,
              canEdit: !!p.edit,
              canDelete: !!p.delete,
            })
          }
        }
      } else {
        await updateRoleApi(editingRoleId, { name, description: formDescription })
      }
      await refresh()
      openList()
    } catch (e) {
      setErr(e?.message || 'Failed to save role')
    } finally {
      setLoading(false)
    }
  }, [isNew, editingRoleId, formName, formDescription, openList, refresh])

  if (editingRoleId !== null) {
    const updatePerm = async (resourceType, resourceKey, upd) => {
      if (resourceType !== 'page') return
      const existing = formPermissions.find((p) => p.resourceType === resourceType && p.resourceKey === resourceKey)
      const next = existing
        ? { ...existing, ...upd }
        : { permissionId: null, resourceType, resourceKey, view: false, edit: false, delete: false, ...upd }

      setFormPermissions((prev) => {
        const kept = prev.filter((p) => !(p.resourceType === resourceType && p.resourceKey === resourceKey))
        return [...kept, next]
      })

      if (editingRoleId !== 'new') {
        if (!next.permissionId) return
        setErr(null)
        try {
          await upsertRolePermission(editingRoleId, {
            permissionId: next.permissionId,
            canView: !!next.view,
            canEdit: !!next.edit,
            canDelete: !!next.delete,
          })
        } catch (e) {
          setErr(e?.message || 'Failed to update permission')
        }
      }
    }

    return (
      <div className="allocation-page">
        <h1 className="page-title">{isNew ? 'Add Role' : 'Edit Role'}</h1>
        <p className="allocation-page__intro">
          <button type="button" className="link" onClick={openList} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>← Back to Role Management</button>
        </p>

        {err && (
          <p className="text-steel" style={{ color: 'var(--danger-600)', marginTop: 'var(--spacing-2)' }}>
            {err}
          </p>
        )}
        {loading && <p className="text-steel" style={{ marginTop: 'var(--spacing-2)' }}>Loading…</p>}

        <section className="card admin-role-form__basic">
          <h2 className="card__title admin-role-form__section-title">Role details</h2>
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

        <section className="card admin-role-form__pages">
          <h2 className="card__title admin-role-form__section-title">Pages</h2>
          <p className="text-steel" style={{ marginBottom: 'var(--spacing-3)' }}>
            Which pages can this role view, edit, or delete.
          </p>
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
        {err && (
          <p className="text-steel" style={{ color: 'var(--danger-600)', marginTop: 'var(--spacing-2)' }}>
            {err}
          </p>
        )}
        {loading && <p className="text-steel" style={{ marginTop: 'var(--spacing-2)' }}>Loading…</p>}
        {roles.length === 0 ? (
          <p className="text-steel">No roles. Click Add Role to create one and set permissions (Pages).</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table allocation-table admin-roles-table">
              <thead>
                <tr>
                  <th className="allocation-table__expand-col" aria-label="Expand row" />
                  <th className="allocation-table__th">Name</th>
                  <th className="allocation-table__th">Description</th>
                  <th className="allocation-table__action-col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {roles.map((r) => (
                  <Fragment key={r.id}>
                    <tr
                      className={`allocation-table__row ${expandedRoleId === r.id ? 'allocation-table__row--expanded' : ''}`}
                      onClick={() => toggleRoleExpand(r.id)}
                    >
                      <td className="allocation-table__expand-col">
                        <span className="allocation-table__expand-icon" aria-hidden>
                          {expandedRoleId === r.id ? '▼' : '▶'}
                        </span>
                      </td>
                      <td><strong>{r.name || '—'}</strong></td>
                      <td>{(r.description || '').slice(0, 80)}{(r.description || '').length > 80 ? '…' : ''}</td>
                      <td className="allocation-table__action-col" onClick={(e) => e.stopPropagation()}>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <button type="button" className="btn btn--small btn--secondary" onClick={() => openEdit(r)}>
                            Edit
                          </button>
                          {!r.isSystemRole && (
                            <button
                              type="button"
                              className="btn btn--small btn--danger"
                              onClick={async () => {
                                try {
                                  await deleteRoleApi(r.id)
                                  await refresh()
                                } catch (e) {
                                  setErr(e?.message || 'Failed to delete role')
                                }
                              }}
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {expandedRoleId === r.id && (
                      <tr className="allocation-table__detail-row">
                        <td colSpan={4} className="allocation-table__detail-cell">
                          <div className="allocation-detail">
                            <h4 className="allocation-detail__title">Pages with access</h4>
                            {(() => {
                              const detailKey = String(r.id)
                              const detail = rolePageDetailById[detailKey]
                              if (detail?.loading && detail?.items == null) {
                                return <p className="text-steel">Loading page permissions…</p>
                              }
                              if (detail?.error) {
                                return (
                                  <p className="text-steel" style={{ color: 'var(--danger-600)' }}>
                                    {detail.error}
                                  </p>
                                )
                              }
                              if (detail?.items != null) {
                                const granted = buildRolePageSummary(detail.items)
                                if (granted.length === 0) {
                                  return (
                                    <p className="text-steel">
                                      No pages assigned — this role has no View / Edit / Delete on any page yet.
                                    </p>
                                  )
                                }
                                return (
                                  <div className="table-wrap admin-role-page-access-wrap">
                                    <table className="admin-permission-table admin-role-page-access-table">
                                      <thead>
                                        <tr>
                                          <th>Page</th>
                                          <th className="admin-permission-table__th--check">View</th>
                                          <th className="admin-permission-table__th--check">Edit</th>
                                          <th className="admin-permission-table__th--check">Delete</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {granted.map((row) => (
                                          <tr key={row.key}>
                                            <td>{row.label}</td>
                                            <td className="admin-permission-table__cell--check">
                                              <input
                                                type="checkbox"
                                                checked={row.view}
                                                disabled
                                                readOnly
                                                tabIndex={-1}
                                                aria-label={`${row.label}: View`}
                                              />
                                            </td>
                                            <td className="admin-permission-table__cell--check">
                                              <input
                                                type="checkbox"
                                                checked={row.edit}
                                                disabled
                                                readOnly
                                                tabIndex={-1}
                                                aria-label={`${row.label}: Edit`}
                                              />
                                            </td>
                                            <td className="admin-permission-table__cell--check">
                                              <input
                                                type="checkbox"
                                                checked={row.delete}
                                                disabled
                                                readOnly
                                                tabIndex={-1}
                                                aria-label={`${row.label}: Delete`}
                                              />
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )
                              }
                              return null
                            })()}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
