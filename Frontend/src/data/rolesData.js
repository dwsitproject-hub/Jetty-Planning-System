/**
 * Roles and permissions for RBAC.
 * Permission: { resourceType: 'department'|'page'|'field', resourceKey: string, view, edit, delete }
 */

export const PAGE_OPTIONS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'shipping-instruction', label: 'Shipping Instruction' },
  { id: 'allocation', label: 'Allocation & Berthing' },
  { id: 'at-berth', label: 'At-Berth Executions' },
  { id: 'loading', label: 'Loading / Unloading' },
  { id: 'quality', label: 'Quality' },
  { id: 'verification', label: 'Clearance' },
  { id: 'reporting', label: 'Reporting' },
  { id: 'master', label: 'Master Menu' },
  { id: 'master-port', label: 'Master – Port' },
  { id: 'master-jetty', label: 'Master – Jetty' },
  { id: 'master-jetty-layout', label: 'Master – Jetty Layout' },
  { id: 'admin', label: 'Admin' },
]

/** Fields that support field-level permissions (pageId -> [{ id, label }]) */
export const FIELD_OPTIONS_BY_PAGE = {
  loading: [
    { id: 'eta', label: 'ETA' },
    { id: 'etb', label: 'ETB' },
    { id: 'etd', label: 'ETD' },
    { id: 'cargo', label: 'Cargo' },
    { id: 'remarks', label: 'Remarks' },
  ],
  verification: [
    { id: 'status', label: 'Clearance Status' },
    { id: 'remarks', label: 'Remarks' },
  ],
}

let nextRoleId = 1
const roles = []

export function getRoles() {
  return [...roles]
}

export function getRoleById(id) {
  return roles.find((r) => r.id === id) ?? null
}

export function addRole(data) {
  const id = `role-${nextRoleId++}`
  const entry = {
    id,
    name: (data.name || '').trim() || 'Unnamed Role',
    description: (data.description || '').trim() || '',
    isSystemRole: Boolean(data.isSystemRole),
    permissions: Array.isArray(data.permissions) ? data.permissions.map((p) => ({ ...p })) : [],
  }
  roles.push(entry)
  return entry
}

export function updateRole(id, data) {
  const i = roles.findIndex((r) => r.id === id)
  if (i === -1) return null
  if (data.name !== undefined) roles[i].name = (data.name || '').trim() || roles[i].name
  if (data.description !== undefined) roles[i].description = (data.description || '').trim()
  if (data.permissions !== undefined) roles[i].permissions = data.permissions.map((p) => ({ ...p }))
  return roles[i]
}

export function getPermission(permissions, resourceType, resourceKey) {
  const p = permissions.find((x) => x.resourceType === resourceType && x.resourceKey === resourceKey)
  return p ? { view: !!p.view, edit: !!p.edit, delete: !!p.delete } : { view: false, edit: false, delete: false }
}

export function setPermission(permissions, { resourceType, resourceKey, view, edit, delete: del }) {
  const next = permissions.filter((x) => !(x.resourceType === resourceType && x.resourceKey === resourceKey))
  if (view || edit || del) {
    next.push({ resourceType, resourceKey, view: !!view, edit: !!edit, delete: !!del })
  }
  return next
}
