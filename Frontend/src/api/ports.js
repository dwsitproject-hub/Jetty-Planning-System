import { apiGet, apiPost, apiPut, apiDelete } from './client.js'

/** @returns {Promise<Array<{ id: number, name: string, description: string | null, scheduleTimezone: string, operationalDayStart: string, createdAt: string, updatedAt: string }>>} */
export function fetchPorts() {
  return apiGet('/ports')
}

function bodyScheduleTimezone(scheduleTimezone) {
  if (scheduleTimezone == null) return null
  const t = String(scheduleTimezone).trim()
  return t === '' ? null : t
}

function bodyOperationalDayStart(operationalDayStart) {
  if (operationalDayStart == null) return undefined
  const t = String(operationalDayStart).trim()
  return t === '' ? undefined : t
}

export function createPort({
  name,
  description,
  scheduleTimezone,
  operationalDayStart,
  allowMultiJetyBerthing,
} = {}) {
  return apiPost('/ports', {
    name,
    description: description ?? null,
    scheduleTimezone: bodyScheduleTimezone(scheduleTimezone),
    operationalDayStart: bodyOperationalDayStart(operationalDayStart) ?? '06:00:00',
    allowMultiJetyBerthing: allowMultiJetyBerthing === true,
  })
}

export function updatePortApi(
  id,
  { name, description, scheduleTimezone, operationalDayStart, allowMultiJetyBerthing } = {}
) {
  const body = {
    name,
    description: description ?? null,
    scheduleTimezone: bodyScheduleTimezone(scheduleTimezone),
    allowMultiJetyBerthing: allowMultiJetyBerthing === true,
  }
  const opDay = bodyOperationalDayStart(operationalDayStart)
  if (opDay != null) body.operationalDayStart = opDay
  return apiPut(`/ports/${id}`, body)
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
