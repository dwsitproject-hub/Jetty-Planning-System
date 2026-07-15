import { apiGet, apiPost, apiPut } from './client.js'

export function fetchJetties(portId) {
  const q = portId != null ? `?port_id=${encodeURIComponent(portId)}` : ''
  return apiGet(`/jetties${q}`)
}

export function fetchJetty(id) {
  return apiGet(`/jetties/${id}`)
}

export function createJetty({
  portId,
  orderNo,
  name,
  description,
  capacity,
  rtspLink,
  jettyLengthM,
  jettyDraft,
  jettyDwt,
  unloadingCommodityIds,
  loadingCommodityIds,
}) {
  return apiPost('/jetties', {
    port_id: portId,
    order_no: orderNo ?? 0,
    name,
    description: description ?? null,
    capacity: capacity ?? undefined,
    rtsp_link: rtspLink ?? null,
    jetty_length_m: jettyLengthM,
    jetty_draft: jettyDraft,
    jetty_dwt: jettyDwt,
    unloading_commodity_ids: Array.isArray(unloadingCommodityIds) ? unloadingCommodityIds : [],
    loading_commodity_ids: Array.isArray(loadingCommodityIds) ? loadingCommodityIds : [],
  })
}

export function updateJettyApi(id, {
  portId,
  orderNo,
  name,
  description,
  capacity,
  rtspLink,
  jettyLengthM,
  jettyDraft,
  jettyDwt,
  unloadingCommodityIds,
  loadingCommodityIds,
}) {
  return apiPut(`/jetties/${id}`, {
    port_id: portId,
    order_no: orderNo,
    name,
    description: description ?? null,
    capacity: capacity ?? undefined,
    rtsp_link: rtspLink ?? null,
    jetty_length_m: jettyLengthM,
    jetty_draft: jettyDraft,
    jetty_dwt: jettyDwt,
    unloading_commodity_ids: Array.isArray(unloadingCommodityIds) ? unloadingCommodityIds : [],
    loading_commodity_ids: Array.isArray(loadingCommodityIds) ? loadingCommodityIds : [],
  })
}

export function updateJettyStatus(id, status) {
  return apiPut(`/jetties/${id}/status`, { status })
}
