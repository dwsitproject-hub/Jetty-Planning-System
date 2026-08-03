import { apiGet, apiPost, apiPut, apiDelete } from './client.js'

/**
 * @param {string|number} portId
 * @returns {Promise<Array<{
 *   tankId: string,
 *   code: string,
 *   name: string|null,
 *   productName: string|null,
 *   levelMm: number|null,
 *   temperatureC: number|null,
 *   totalMass: number|null,
 *   flowRateTph: number|null,
 *   statusText: string|null,
 *   recordedAt: string|null,
 *   fetchedAt: string|null,
 *   sourceBaseUrl: string|null,
 *   sourceUnitName: string|null,
 * }>>}
 */
export function fetchTankGaugingLatest(portId) {
  const q = encodeURIComponent(String(portId))
  return apiGet(`/tank-gauging/latest?portId=${q}`)
}

/**
 * Segment mass delta (sum |Δmass| per tank) for cargo operations entry form.
 */
export function fetchTankGaugingMassDelta({ portId, tankIds, startAt, endAt }) {
  const params = new URLSearchParams()
  params.set('portId', String(portId))
  params.set('tankIds', (Array.isArray(tankIds) ? tankIds : []).join(','))
  params.set('startAt', startAt)
  if (endAt != null && endAt !== '') params.set('endAt', endAt)
  return apiGet(`/tank-gauging/mass-delta?${params.toString()}`)
}

export function fetchTankGaugingSources(portId) {
  const q = encodeURIComponent(String(portId))
  return apiGet(`/tank-gauging/sources?portId=${q}`)
}

export function createTankGaugingSource(body) {
  return apiPost('/tank-gauging/sources', body)
}

export function updateTankGaugingSource(id, body) {
  return apiPut(`/tank-gauging/sources/${encodeURIComponent(String(id))}`, body)
}

export function deleteTankGaugingSource(id) {
  return apiDelete(`/tank-gauging/sources/${encodeURIComponent(String(id))}`)
}

export function testTankGaugingSource(id, body = {}) {
  return apiPost(`/tank-gauging/sources/${encodeURIComponent(String(id))}/test`, body)
}
