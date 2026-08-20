import { apiGet } from './client.js'

/**
 * @param {{ portId: string|number, from: string, to: string, tankIds?: Array<string|number> }} opts
 */
export function fetchTankCargoMovementBoard({ portId, from, to, tankIds }) {
  const params = new URLSearchParams()
  params.set('portId', String(portId))
  params.set('from', from)
  params.set('to', to)
  if (Array.isArray(tankIds) && tankIds.length) {
    params.set('tankIds', tankIds.join(','))
  }
  return apiGet(`/tank-cargo-movements/board?${params.toString()}`)
}

export function fetchSegmentInspect({ portId, loadLineId, tankId }) {
  const params = new URLSearchParams()
  params.set('portId', String(portId))
  params.set('tankId', String(tankId))
  return apiGet(
    `/tank-cargo-movements/segments/${encodeURIComponent(String(loadLineId))}/inspect?${params.toString()}`
  )
}
