/**
 * Users for Admin / RBAC. In-memory store.
 * User has departmentIds[] and roleIds[].
 */

let nextUserId = 1
const users = []

export function getUsers() {
  return [...users]
}

export function getUserById(id) {
  return users.find((u) => u.id === id) ?? null
}

export function addUser(data) {
  const id = `user-${nextUserId++}`
  const entry = {
    id,
    username: (data.username || '').trim() || '',
    displayName: (data.displayName || '').trim() || '',
    email: (data.email || '').trim() || '',
    isActive: data.isActive !== false,
    departmentIds: Array.isArray(data.departmentIds) ? [...data.departmentIds] : [],
    roleIds: Array.isArray(data.roleIds) ? [...data.roleIds] : [],
  }
  users.push(entry)
  return entry
}

export function updateUser(id, data) {
  const i = users.findIndex((u) => u.id === id)
  if (i === -1) return null
  if (data.username !== undefined) users[i].username = (data.username || '').trim()
  if (data.displayName !== undefined) users[i].displayName = (data.displayName || '').trim()
  if (data.email !== undefined) users[i].email = (data.email || '').trim()
  if (data.isActive !== undefined) users[i].isActive = Boolean(data.isActive)
  if (data.departmentIds !== undefined) users[i].departmentIds = [...data.departmentIds]
  if (data.roleIds !== undefined) users[i].roleIds = [...data.roleIds]
  return users[i]
}

/** Count users that have this department assigned (for deactivate warning) */
export function countUsersByDepartmentId(departmentId) {
  return users.filter((u) => u.departmentIds && u.departmentIds.includes(departmentId)).length
}

/** Count users that have this role assigned */
export function countUsersByRoleId(roleId) {
  return users.filter((u) => u.roleIds && u.roleIds.includes(roleId)).length
}
