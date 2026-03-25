import { apiGet, apiPost, apiPut } from './client.js'

export function fetchJetties(portId) {
  const q = portId != null ? `?port_id=${encodeURIComponent(portId)}` : ''
  return apiGet(`/jetties${q}`)
}

export function fetchJetty(id) {
  return apiGet(`/jetties/${id}`)
}

export function createJetty({ portId, orderNo, name, description }) {
  return apiPost('/jetties', {
    port_id: portId,
    order_no: orderNo ?? 0,
    name,
    description: description ?? null,
  })
}

export function updateJettyApi(id, { portId, orderNo, name, description }) {
  return apiPut(`/jetties/${id}`, {
    port_id: portId,
    order_no: orderNo,
    name,
    description: description ?? null,
  })
}

export function updateJettyStatus(id, status) {
  return apiPut(`/jetties/${id}/status`, { status })
}
