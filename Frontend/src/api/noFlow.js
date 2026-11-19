import { apiDelete, apiGet, apiPost, apiPut } from './client.js'

/**
 * @returns {Promise<{ minMinutes: number, window: { startedAt: string, endedAt: string, isOpen: boolean }|null,
 *   events: Array<object>, unexplained: Array<{ startedAt: string, endedAt: string, minutes: number, source: string }>,
 *   totals: { explainedMinutes: number, unexplainedMinutes: number, unexplainedCount: number } }>}
 */
export function fetchNoFlow(operationId) {
  return apiGet(`/operations/${operationId}/no-flow`)
}

/** Active reasons for the stop form. */
export function fetchNoFlowReasonOptions() {
  return apiGet('/no-flow-reasons/options')
}

export function createNoFlowEvent(operationId, body) {
  return apiPost(`/operations/${operationId}/no-flow-events`, body)
}

export function updateNoFlowEvent(operationId, eventId, body) {
  return apiPut(`/operations/${operationId}/no-flow-events/${eventId}`, body)
}

export function deleteNoFlowEvent(operationId, eventId) {
  return apiDelete(`/operations/${operationId}/no-flow-events/${eventId}`)
}
