import { apiDelete, apiGet, apiPost, apiPut } from './client.js'

/**
 * @returns {Promise<Array<{ id: string, portId: number, isDefault: boolean, remainingPctBelow: number,
 *   rateMtPerHourBelow: number, matchMode: 'and'|'or', isActive: boolean,
 *   commodities: Array<{ id: string, label: string }> }>>}
 */
export function fetchKurasRules(portId) {
  return apiGet(`/master/kuras-rules?portId=${encodeURIComponent(String(portId))}`)
}

function body(rule) {
  return {
    remainingPctBelow: Number(rule.remainingPctBelow),
    rateMtPerHourBelow: Number(rule.rateMtPerHourBelow),
    matchMode: rule.matchMode,
    isActive: rule.isActive,
    commodityIds: (rule.commodityIds || []).map(Number),
  }
}

export function createKurasRule(portId, rule) {
  return apiPost('/master/kuras-rules', { portId, ...body(rule) })
}

export function updateKurasRule(id, rule) {
  return apiPut(`/master/kuras-rules/${id}`, body(rule))
}

export function deleteKurasRule(id) {
  return apiDelete(`/master/kuras-rules/${id}`)
}

/** Re-apply the port's rules to every auto-tagged cargo entry. */
export function recheckKurasRules(portId) {
  return apiPost('/master/kuras-rules/recheck', { portId })
}
