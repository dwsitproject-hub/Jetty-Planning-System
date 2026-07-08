import { useEffect, useState, useCallback, Fragment } from 'react'
import { Link } from 'react-router-dom'
import { PAGE_OPTIONS } from '../data/rolesData'
import {
  createRole,
  deleteRoleApi,
  deleteRolePermission,
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
import { MAX_ROLE_DESCRIPTION_CHARS, MAX_ROLE_NAME_CHARS } from '../constants/inputLimits'

function Toast({ message, variant = 'success', onDismiss, stacked = false }) {
  if (!message) return null
  const isWarn = variant === 'warning'
  const isErr = variant === 'error'
  const cls = `toast ${isErr ? 'toast--warning' : isWarn ? 'toast--warning' : 'toast--success'}${stacked ? ' toast--stacked' : ''}`
  const icon = isErr || isWarn ? '!' : '✓'
  return (
    <div className={cls} role="status" aria-live="polite" aria-atomic="true">
      <span className="toast__icon" aria-hidden>
        {icon}
      </span>
      <p className="toast__message">{message}</p>
      <button type="button" className="toast__close" onClick={onDismiss} aria-label="Dismiss notification">
        ×
      </button>
    </div>
  )
}

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

/** Inline under Loading / Unloading: final operation sign-off (after request). */
function LoadingOperationSignoffApproveSubrow({ perm, onToggleApprove }) {
  return (
    <tr className="admin-permission-table__si-subrow">
      <td colSpan={4}>
        <label className="admin-permission-table__si-approve-label">
          <span className="admin-permission-table__si-subindent" aria-hidden>
            ↳
          </span>
          <input
            type="checkbox"
            checked={!!perm.approve}
            onChange={(e) => onToggleApprove(e.target.checked)}
            aria-label="Approve operation sign-off (Loading / Unloading)"
          />
          <span className="admin-permission-table__si-approve-text">
            <strong>Approve operation sign-off</strong>
            <span className="admin-permission-table__si-approve-hint">
              {' '}
              — final sign-off after a request; vessel moves to Clearance (Ready to Sail). Separate from Edit above.
            </span>
          </span>
        </label>
      </td>
    </tr>
  )
}

/** Inline under At-Berth Executions: Jetty Live CCTV from Allocation schematic. */
function AtBerthJettyLiveSubrow({ perm, onToggleApprove }) {
  return (
    <tr className="admin-permission-table__si-subrow">
      <td colSpan={4}>
        <label className="admin-permission-table__si-approve-label">
          <span className="admin-permission-table__si-subindent" aria-hidden>
            ↳
          </span>
          <input
            type="checkbox"
            checked={!!perm.approve}
            onChange={(e) => onToggleApprove(e.target.checked)}
            aria-label="View Jetty Live stream (CCTV from Allocation schematic)"
          />
          <span className="admin-permission-table__si-approve-text">
            <strong>View Jetty Live stream</strong>
            <span className="admin-permission-table__si-approve-hint">
              {' '}
              — opens live CCTV from the Allocation & Berthing jetty schematic. Separate from View/Edit/Delete above.
            </span>
          </span>
        </label>
      </td>
    </tr>
  )
}

/** Inline under Shipment Plan only: plan-level approve / reject (vessel call). */
function ShipmentPlanApproveSubrow({ perm, onToggleApprove }) {
  return (
    <tr className="admin-permission-table__si-subrow">
      <td colSpan={4}>
        <label className="admin-permission-table__si-approve-label">
          <span className="admin-permission-table__si-subindent" aria-hidden>
            ↳
          </span>
          <input
            type="checkbox"
            checked={!!perm.approve}
            onChange={(e) => onToggleApprove(e.target.checked)}
            aria-label="Approve or reject submitted shipment plans (vessel call)"
          />
          <span className="admin-permission-table__si-approve-text">
            <strong>Approve shipment plan</strong>
            <span className="admin-permission-table__si-approve-hint">
              {' '}
              — allows approving or rejecting a submitted shipment plan (one decision per vessel call). Separate from
              View/Edit/Delete above.
            </span>
          </span>
        </label>
      </td>
    </tr>
  )
}

function getPermission(perms, resourceType, resourceKey) {
  const p = perms.find((x) => x.resourceType === resourceType && x.resourceKey === resourceKey)
  return p
    ? { view: !!p.view, edit: !!p.edit, delete: !!p.delete, approve: !!p.approve }
    : { view: false, edit: false, delete: false, approve: false }
}

const PAGE_LABEL_BY_ID = Object.fromEntries(PAGE_OPTIONS.map((p) => [p.id, p.label]))

function normalizeSearch(s) {
  return String(s || '').trim().toLowerCase()
}

function isMasterKey(k) {
  return k === 'master' || k.startsWith('master-')
}

function getGroupForPageKey(k) {
  if (k === 'master' || k === 'master-port' || k === 'master-jetty' || k === 'master-jetty-layout') {
    return 'master-port-jetty'
  }
  if (k.startsWith('master-si-')) return 'master-si'
  return 'core'
}

const GROUPS = [
  { id: 'core', title: 'Core modules', description: 'Main app pages (operations & reporting).' },
  { id: 'master-port-jetty', title: 'Master – Port & Jetty', description: 'Ports, preferred jetties, and jetty layout.' },
  { id: 'master-si', title: 'Master – Shipping Instruction', description: 'SI dropdown master data pages.' },
]

/** API rows from fetchRolePagePermissions → granted pages only (for read-only summary table) */
function buildRolePageSummary(rows) {
  const list = Array.isArray(rows) ? rows : []
  return list
    .filter((p) => {
      if (p.resourceType !== 'page') return false
      const v = p.canView ?? p.can_view
      const e = p.canEdit ?? p.can_edit
      const d = p.canDelete ?? p.can_delete
      const a = p.canApprove ?? p.can_approve
      return Boolean(v || e || d || a)
    })
    .map((p) => {
      const label = PAGE_LABEL_BY_ID[p.resourceKey] || p.resourceKey || '—'
      return {
        key: p.resourceKey,
        label,
        view: Boolean(p.canView ?? p.can_view),
        edit: Boolean(p.canEdit ?? p.can_edit),
        delete: Boolean(p.canDelete ?? p.can_delete),
        approve: Boolean(p.canApprove ?? p.can_approve),
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
  const [initialPermByKey, setInitialPermByKey] = useState({})
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(null)
  const [toast, setToast] = useState(null) // { message, variant }
  const [expandedRoleId, setExpandedRoleId] = useState(null)
  const [pageSearch, setPageSearch] = useState('')
  const [collapsedGroup, setCollapsedGroup] = useState(() => ({
    core: false,
    'master-port-jetty': false,
    'master-si': false,
  }))
  /** @type {[Record<string, { loading?: boolean, error?: string, items?: unknown[] }>, function]} */
  const [rolePageDetailById, setRolePageDetailById] = useState({})

  useEffect(() => {
    if (!toast?.message) return
    const t = setTimeout(() => setToast(null), 5500)
    return () => clearTimeout(t)
  }, [toast])

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
  const nameLabel = (formName || '').trim() || 'Role'

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
              approve: false,
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
      const mapped = (Array.isArray(perms) ? perms : []).map((p) => ({
        permissionId: p.id,
        resourceType: p.resourceType,
        resourceKey: p.resourceKey,
        view: !!p.canView,
        edit: !!p.canEdit,
        delete: !!p.canDelete,
        approve: !!p.canApprove,
      }))
      setFormPermissions(mapped)
      const byKey = {}
      for (const p of mapped) {
        if (p.resourceType !== 'page') continue
        byKey[p.resourceKey] = {
          view: !!p.view,
          edit: !!p.edit,
          delete: !!p.delete,
          approve: !!p.approve,
        }
      }
      setInitialPermByKey(byKey)
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
            .filter((p) => p.view || p.edit || p.delete || p.approve)
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
              canApprove: !!p.approve,
            })
          }
        }
        setToast({ message: `Role created: ${name}.`, variant: 'success' })
      } else {
        await updateRoleApi(editingRoleId, { name, description: formDescription })

        // Persist permission changes ONLY on Save.
        const nextList = Array.isArray(formPermissions) ? formPermissions : []
        for (const p of nextList) {
          if (p.resourceType !== 'page') continue
          if (!p.permissionId) continue

          const before = initialPermByKey?.[p.resourceKey] || { view: false, edit: false, delete: false, approve: false }
          const after = { view: !!p.view, edit: !!p.edit, delete: !!p.delete, approve: !!p.approve }
          const changed =
            before.view !== after.view ||
            before.edit !== after.edit ||
            before.delete !== after.delete ||
            before.approve !== after.approve
          if (!changed) continue

          const anyAfter = after.view || after.edit || after.delete || after.approve
          if (!anyAfter) {
            const anyBefore = before.view || before.edit || before.delete || before.approve
            if (anyBefore) {
              await deleteRolePermission(editingRoleId, p.permissionId)
            }
            continue
          }

          await upsertRolePermission(editingRoleId, {
            permissionId: p.permissionId,
            canView: after.view,
            canEdit: after.edit,
            canDelete: after.delete,
            canApprove: after.approve,
          })
        }

        setToast({ message: `Role saved: ${name}.`, variant: 'success' })
      }
      await refresh()
      openList()
    } catch (e) {
      setErr(e?.message || 'Failed to save role')
      setToast({ message: e?.message || 'Failed to save role.', variant: 'error' })
    } finally {
      setLoading(false)
    }
  }, [isNew, editingRoleId, formName, formDescription, formPermissions, initialPermByKey, openList, refresh])

  if (editingRoleId !== null) {
    const updatePerm = (resourceType, resourceKey, upd) => {
      if (resourceType !== 'page') return
      const existing = formPermissions.find((p) => p.resourceType === resourceType && p.resourceKey === resourceKey)
      const next = existing
        ? { ...existing, ...upd }
        : {
            permissionId: null,
            resourceType,
            resourceKey,
            view: false,
            edit: false,
            delete: false,
            approve: false,
            ...upd,
          }

      setFormPermissions((prev) => {
        const kept = prev.filter((p) => !(p.resourceType === resourceType && p.resourceKey === resourceKey))
        return [...kept, next]
      })
    }

    const filteredPageOptions = (() => {
      const q = normalizeSearch(pageSearch)
      if (!q) return PAGE_OPTIONS
      return PAGE_OPTIONS.filter((p) => {
        const hay = `${p.label} ${p.id}`.toLowerCase()
        if (hay.includes(q)) return true
        // Convenience: typing "master" should match all master-* pages
        if (q === 'master' && isMasterKey(p.id)) return true
        return false
      })
    })()

    const pagesByGroup = GROUPS.reduce((acc, g) => {
      acc[g.id] = []
      return acc
    }, {})
    for (const p of filteredPageOptions) {
      const gid = getGroupForPageKey(p.id)
      if (!pagesByGroup[gid]) pagesByGroup[gid] = []
      pagesByGroup[gid].push(p)
    }

    const computeGroupState = (groupId) => {
      const pages = pagesByGroup[groupId] || []
      const flags = { view: [], edit: [], delete: [] }
      for (const p of pages) {
        const perm = getPermission(formPermissions, 'page', p.id)
        flags.view.push(perm.view)
        flags.edit.push(perm.edit)
        flags.delete.push(perm.delete)
      }
      const agg = (arr) => {
        if (arr.length === 0) return { checked: false, indeterminate: false }
        const all = arr.every(Boolean)
        const any = arr.some(Boolean)
        return { checked: all, indeterminate: any && !all }
      }
      return {
        view: agg(flags.view),
        edit: agg(flags.edit),
        delete: agg(flags.delete),
        count: pages.length,
      }
    }

    const applyGroupBulk = (groupId, field, value) => {
      const pages = pagesByGroup[groupId] || []
      for (const p of pages) {
        const existing = getPermission(formPermissions, 'page', p.id)
        updatePerm('page', p.id, { ...existing, [field]: value })
      }
    }

    return (
      <div className="allocation-page">
        <Toast message={toast?.message} variant={toast?.variant} onDismiss={() => setToast(null)} />
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
              maxLength={MAX_ROLE_NAME_CHARS}
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
              maxLength={MAX_ROLE_DESCRIPTION_CHARS}
              placeholder="Brief description"
              rows={2}
            />
          </div>
        </section>

        <section className="card admin-role-form__pages">
          <h2 className="card__title admin-role-form__section-title">Pages</h2>
          <p className="text-steel" style={{ marginBottom: 'var(--spacing-3)' }}>
            Which pages this role can view, edit, or delete. For <strong>Shipping Instruction</strong>, an extra option
            appears below that row for <strong>internal SI approval</strong> sign-off. For <strong>Shipment Plan</strong>,
            an extra option appears for <strong>plan-level approval</strong> (approve or reject a submitted vessel call).
          </p>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 'var(--spacing-3)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 260 }}>
              <label htmlFor="role-page-search" className="modal__label" style={{ margin: 0 }}>
                Search page permissions
              </label>
              <input
                id="role-page-search"
                type="text"
                className="modal__input"
                value={pageSearch}
                onChange={(e) => setPageSearch(e.target.value)}
                placeholder="Type to filter… (e.g. master, shipper, jetty)"
              />
            </div>
            <button
              type="button"
              className="btn btn--secondary btn--small"
              onClick={() => setPageSearch('')}
              disabled={!pageSearch}
              title={!pageSearch ? 'Search is empty' : 'Clear search'}
            >
              Clear
            </button>
          </div>
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
                {GROUPS.map((g) => {
                  const state = computeGroupState(g.id)
                  const isCollapsed = !!collapsedGroup[g.id]
                  const pages = pagesByGroup[g.id] || []
                  const showGroup = pages.length > 0 || normalizeSearch(pageSearch) === ''

                  if (!showGroup) return null

                  return (
                    <Fragment key={g.id}>
                      <tr className="admin-permission-table__group-row">
                        <td colSpan={4}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              className="link"
                              onClick={() => setCollapsedGroup((prev) => ({ ...prev, [g.id]: !prev[g.id] }))}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                              aria-expanded={!isCollapsed}
                            >
                              <strong>{isCollapsed ? '▶' : '▼'} {g.title}</strong>
                              <span className="text-steel" style={{ marginLeft: 8, fontSize: 'var(--font-size-xs)' }}>
                                {g.description} ({state.count})
                              </span>
                            </button>

                            <div style={{ display: 'inline-flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                              <label className="admin-permission-table__bulk" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                                <input
                                  type="checkbox"
                                  checked={state.view.checked}
                                  ref={(el) => {
                                    if (el) el.indeterminate = state.view.indeterminate
                                  }}
                                  onChange={(e) => applyGroupBulk(g.id, 'view', e.target.checked)}
                                  aria-label={`Toggle View for all pages in ${g.title}`}
                                />
                                <span className="text-steel" style={{ fontSize: 'var(--font-size-xs)' }}>View all</span>
                              </label>
                              <label className="admin-permission-table__bulk" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                                <input
                                  type="checkbox"
                                  checked={state.edit.checked}
                                  ref={(el) => {
                                    if (el) el.indeterminate = state.edit.indeterminate
                                  }}
                                  onChange={(e) => applyGroupBulk(g.id, 'edit', e.target.checked)}
                                  aria-label={`Toggle Edit for all pages in ${g.title}`}
                                />
                                <span className="text-steel" style={{ fontSize: 'var(--font-size-xs)' }}>Edit all</span>
                              </label>
                              <label className="admin-permission-table__bulk" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                                <input
                                  type="checkbox"
                                  checked={state.delete.checked}
                                  ref={(el) => {
                                    if (el) el.indeterminate = state.delete.indeterminate
                                  }}
                                  onChange={(e) => applyGroupBulk(g.id, 'delete', e.target.checked)}
                                  aria-label={`Toggle Delete for all pages in ${g.title}`}
                                />
                                <span className="text-steel" style={{ fontSize: 'var(--font-size-xs)' }}>Delete all</span>
                              </label>
                            </div>
                          </div>
                        </td>
                      </tr>

                      {!isCollapsed &&
                        pages.map((p) => {
                          const perm = getPermission(formPermissions, 'page', p.id)
                          const label =
                            g.id === 'master-si'
                              ? (p.label || '').replace(/^Master\s+–\s+SI\s+/i, '')
                              : g.id === 'master-port-jetty'
                                ? (p.label || '').replace(/^Master\s+–\s+/i, '')
                                : p.label
                          return (
                            <Fragment key={p.id}>
                              <PermissionRow
                                label={label}
                                perm={perm}
                                onChange={(pUpd) => updatePerm('page', p.id, pUpd)}
                              />
                              {p.id === 'loading' && (
                                <LoadingOperationSignoffApproveSubrow
                                  perm={perm}
                                  onToggleApprove={(approve) => updatePerm('page', 'loading', { ...perm, approve })}
                                />
                              )}
                              {p.id === 'shipment-plan' && (
                                <ShipmentPlanApproveSubrow
                                  perm={perm}
                                  onToggleApprove={(approve) => updatePerm('page', 'shipment-plan', { ...perm, approve })}
                                />
                              )}
                              {p.id === 'at-berth' && (
                                <AtBerthJettyLiveSubrow
                                  perm={perm}
                                  onToggleApprove={(approve) => updatePerm('page', 'at-berth', { ...perm, approve })}
                                />
                              )}
                            </Fragment>
                          )
                        })}
                    </Fragment>
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
      <Toast message={toast?.message} variant={toast?.variant} onDismiss={() => setToast(null)} />
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
                                // eslint-disable-next-line no-alert
                                const ok = window.confirm(`Delete role "${r.name}"?`)
                                if (!ok) return
                                try {
                                  await deleteRoleApi(r.id)
                                  setToast({ message: `Role deleted: ${r.name || r.id}.`, variant: 'success' })
                                  await refresh()
                                } catch (e) {
                                  setErr(e?.message || 'Failed to delete role')
                                  setToast({ message: e?.message || 'Failed to delete role.', variant: 'error' })
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
                                          <Fragment key={row.key}>
                                            <tr>
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
                                            {row.key === 'loading' && (
                                              <tr className="admin-permission-table__si-subrow admin-permission-table__si-subrow--readonly">
                                                <td colSpan={4}>
                                                  <span className="admin-permission-table__si-subindent" aria-hidden>
                                                    ↳
                                                  </span>
                                                  <span className="text-steel">
                                                    Approve operation sign-off:{' '}
                                                    <strong>{row.approve ? 'Yes' : 'No'}</strong>
                                                  </span>
                                                </td>
                                              </tr>
                                            )}
                                            {row.key === 'shipment-plan' && (
                                              <tr className="admin-permission-table__si-subrow admin-permission-table__si-subrow--readonly">
                                                <td colSpan={4}>
                                                  <span className="admin-permission-table__si-subindent" aria-hidden>
                                                    ↳
                                                  </span>
                                                  <span className="text-steel">
                                                    Approve shipment plan:{' '}
                                                    <strong>{row.approve ? 'Yes' : 'No'}</strong>
                                                  </span>
                                                </td>
                                              </tr>
                                            )}
                                            {row.key === 'at-berth' && (
                                              <tr className="admin-permission-table__si-subrow admin-permission-table__si-subrow--readonly">
                                                <td colSpan={4}>
                                                  <span className="admin-permission-table__si-subindent" aria-hidden>
                                                    ↳
                                                  </span>
                                                  <span className="text-steel">
                                                    View Jetty Live stream:{' '}
                                                    <strong>{row.approve ? 'Yes' : 'No'}</strong>
                                                  </span>
                                                </td>
                                              </tr>
                                            )}
                                          </Fragment>
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
