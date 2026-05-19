import { apiGet, apiPost, apiPut, apiDelete } from './client.js'

export function fetchUsers() {
  return apiGet('/users')
}

export function fetchUser(id) {
  return apiGet(`/users/${id}`)
}

export function createUser(body) {
  return apiPost('/users', {
    username: body.username,
    password: body.password,
    display_name: body.displayName,
    email: body.email,
    is_active: body.isActive !== false,
  })
}

export function updateUserApi(id, body) {
  return apiPut(`/users/${id}`, {
    display_name: body.displayName,
    email: body.email,
    is_active: body.isActive,
    password: body.password || undefined,
  })
}

export function deleteUser(id) {
  return apiDelete(`/users/${id}`)
}

export function fetchMe() {
  return apiGet('/users/me')
}

export function fetchMyPorts() {
  return apiGet('/users/me/ports')
}

export function fetchMySsoStatus() {
  return apiGet('/users/me/sso-status')
}

export function changeMyPasswordApi({ currentPassword, newPassword }) {
  return apiPut('/users/me/password', {
    current_password: currentPassword,
    new_password: newPassword,
  })
}

export function startMySsoConnect() {
  return apiPost('/users/me/sso-connect/start', {})
}

export function fetchUserPorts(userId) {
  return apiGet(`/users/${userId}/ports`)
}

export function saveUserPorts(userId, portIds) {
  return apiPut(`/users/${userId}/ports`, {
    port_ids: Array.isArray(portIds) ? portIds : [],
  })
}

export function fetchAdminUserSsoStatus(userId) {
  return apiGet(`/admin/users/${userId}/sso-status`)
}

export function generateAdminUserSsoLink(userId) {
  return apiPost(`/admin/users/${userId}/sso-link/start`, {})
}

export function unlinkAdminUserSso(userId, reason = '') {
  return apiPost(`/admin/users/${userId}/sso-unlink`, { reason })
}

export function dryRunBulkSsoLink(rows) {
  return apiPost('/admin/sso-link/bulk/dry-run', { rows: Array.isArray(rows) ? rows : [] })
}

export function executeBulkSsoLink(items, selectedRowIndexes) {
  return apiPost('/admin/sso-link/bulk/jobs', {
    items: Array.isArray(items) ? items : [],
    selectedRowIndexes: Array.isArray(selectedRowIndexes) ? selectedRowIndexes : [],
  })
}
