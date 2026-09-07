import { apiDelete, apiGet, apiPost } from './client.js'

export function createSoundingSession(operationId, body) {
  return apiPost(`/operations/${encodeURIComponent(String(operationId))}/sounding-sessions`, body)
}

export function fetchSoundingSession(sessionId) {
  return apiGet(`/sounding-sessions/${encodeURIComponent(String(sessionId))}`)
}

export function cancelSoundingSession(sessionId) {
  return apiDelete(`/sounding-sessions/${encodeURIComponent(String(sessionId))}`)
}

export function lockSoundingReading(sessionId, tankId) {
  return apiPost(`/sounding-sessions/${encodeURIComponent(String(sessionId))}/lock`, { tankId })
}

export function unlockSoundingTank(sessionId, tankId) {
  return apiPost(`/sounding-sessions/${encodeURIComponent(String(sessionId))}/unlock`, { tankId })
}

export function setSoundingManualMode(sessionId, tankId, enabled) {
  return apiPost(`/sounding-sessions/${encodeURIComponent(String(sessionId))}/manual-mode`, {
    tankId,
    enabled,
  })
}

export function confirmSoundingManualReading(sessionId, body) {
  return apiPost(`/sounding-sessions/${encodeURIComponent(String(sessionId))}/manual`, body)
}
