import { apiGet } from './client.js'

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
