import { apiGet } from './client.js'

export function fetchActivityLogs({ pageKey, limit = 50, cursor = null } = {}) {
  const sp = new URLSearchParams()
  sp.set('page_key', pageKey)
  if (limit) sp.set('limit', String(limit))
  if (cursor) sp.set('cursor', cursor)
  return apiGet(`/activity-logs?${sp.toString()}`)
}

