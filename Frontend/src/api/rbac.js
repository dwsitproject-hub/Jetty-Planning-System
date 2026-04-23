import { apiDelete, apiGet, apiPost, apiPut } from './client'

export function fetchRoles() {
  return apiGet('/rbac/roles')
}

export function fetchRole(id) {
  return apiGet(`/rbac/roles/${id}`)
}

export function createRole({ name, description }) {
  return apiPost('/rbac/roles', { name, description })
}

export function updateRoleApi(id, { name, description }) {
  return apiPut(`/rbac/roles/${id}`, { name, description })
}

export function deleteRoleApi(id) {
  return apiDelete(`/rbac/roles/${id}`)
}

export function fetchRolePagePermissions(roleId) {
  return apiGet(`/rbac/roles/${roleId}/page-permissions`)
}

export function fetchPagePermissionCatalog() {
  return apiGet('/rbac/permissions?resource_type=page')
}

export function upsertRolePermission(roleId, { permissionId, canView, canEdit, canDelete, canApprove }) {
  return apiPost(`/rbac/roles/${roleId}/permissions`, {
    permission_id: permissionId,
    can_view: canView,
    can_edit: canEdit,
    can_delete: canDelete,
    can_approve: canApprove,
  })
}

export function deleteRolePermission(roleId, permissionId) {
  return apiDelete(`/rbac/roles/${roleId}/permissions/${permissionId}`)
}

export function fetchUserRoles(userId) {
  return apiGet(`/rbac/users/${userId}/roles`)
}

export function assignUserRole(userId, roleId) {
  return apiPost(`/rbac/users/${userId}/roles`, { role_id: roleId })
}

export function removeUserRole(userId, roleId) {
  return apiDelete(`/rbac/users/${userId}/roles/${roleId}`)
}

