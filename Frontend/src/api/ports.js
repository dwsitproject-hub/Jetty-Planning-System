import { apiGet, apiPost, apiPut, apiDelete } from './client.js'

/** @returns {Promise<Array<{ id: number, name: string, description: string | null, scheduleTimezone: string, createdAt: string, updatedAt: string }>>} */
export function fetchPorts() {
  return apiGet('/ports')
}

function bodyScheduleTimezone(scheduleTimezone) {
  if (scheduleTimezone == null) return null
  const t = String(scheduleTimezone).trim()
  return t === '' ? null : t
}

export function createPort({ name, description, scheduleTimezone } = {}) {
  return apiPost('/ports', {
    name,
    description: description ?? null,
    scheduleTimezone: bodyScheduleTimezone(scheduleTimezone),
  })
}

export function updatePortApi(id, { name, description, scheduleTimezone } = {}) {
  return apiPut(`/ports/${id}`, {
    name,
    description: description ?? null,
    scheduleTimezone: bodyScheduleTimezone(scheduleTimezone),
  })
}

export function deletePort(id) {
  return apiDelete(`/ports/${id}`)
}

export function fetchPortUsers(portId) {
  return apiGet(`/ports/${portId}/users`)
}

export function savePortUsers(portId, userIds) {
  return apiPut(`/ports/${portId}/users`, {
    user_ids: Array.isArray(userIds) ? userIds : [],
  })
}
