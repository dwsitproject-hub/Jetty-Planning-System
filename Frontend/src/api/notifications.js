import { apiGet, apiPatch } from './client.js'

export function fetchNotificationsUnreadCount() {
  return apiGet('/notifications/unread-count')
}

export function fetchNotificationsList({ limit = 30, cursor } = {}) {
  const q = new URLSearchParams()
  if (limit) q.set('limit', String(limit))
  if (cursor) q.set('cursor', cursor)
  const suffix = q.toString() ? `?${q}` : ''
  return apiGet(`/notifications${suffix}`)
}

export function markNotificationsRead(ids) {
  return apiPatch('/notifications/read', { ids })
}

export function markAllNotificationsRead() {
  return apiPatch('/notifications/read', { all: true })
}
