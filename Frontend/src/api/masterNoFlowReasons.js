import { apiDelete, apiGet, apiPost, apiPut } from './client.js'

export function fetchNoFlowReasons() {
  return apiGet('/master/no-flow-reasons')
}

export function createNoFlowReason(body) {
  return apiPost('/master/no-flow-reasons', body)
}

export function updateNoFlowReason(id, body) {
  return apiPut(`/master/no-flow-reasons/${id}`, body)
}

export function deleteNoFlowReason(id) {
  return apiDelete(`/master/no-flow-reasons/${id}`)
}

export function fetchNoFlowPortSetting(portId) {
  return apiGet(`/master/no-flow-reasons/port-setting?portId=${encodeURIComponent(String(portId))}`)
}

export function updateNoFlowPortSetting(portId, minMinutes) {
  return apiPut('/master/no-flow-reasons/port-setting', { portId, minMinutes })
}
