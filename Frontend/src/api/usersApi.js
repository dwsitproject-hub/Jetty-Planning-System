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
