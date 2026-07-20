import { apiGet, apiPut, apiPost, apiDelete } from './client.js'

export function fetchNotificationEvents() {
  return apiGet('/notification-admin/events')
}

export function updateNotificationEvent(eventKey, body) {
  return apiPut(`/notification-admin/events/${encodeURIComponent(eventKey)}`, body)
}

export function fetchEventRecipients(eventKey) {
  return apiGet(`/notification-admin/events/${encodeURIComponent(eventKey)}/recipients`)
}

export function addEventRecipient(eventKey, body) {
  return apiPost(`/notification-admin/events/${encodeURIComponent(eventKey)}/recipients`, body)
}

export function removeEventRecipient(id) {
  return apiDelete(`/notification-admin/recipients/${id}`)
}

export function fetchSmtpConfig() {
  return apiGet('/notification-admin/smtp')
}

export function saveSmtpConfig(body) {
  return apiPut('/notification-admin/smtp', body)
}

export function sendSmtpTestEmail() {
  return apiPost('/notification-admin/smtp/test', {})
}

export function fetchEmailDeliveries(params = {}) {
  const sp = new URLSearchParams()
  if (params.status) sp.set('status', params.status)
  if (params.eventKey) sp.set('eventKey', params.eventKey)
  if (params.portId != null && params.portId !== '') sp.set('portId', String(params.portId))
  if (params.from) sp.set('from', params.from)
  if (params.to) sp.set('to', params.to)
  if (params.q) sp.set('q', params.q)
  if (params.cursor) sp.set('cursor', params.cursor)
  if (params.limit) sp.set('limit', String(params.limit))
  const qs = sp.toString()
  return apiGet(`/notification-admin/deliveries${qs ? `?${qs}` : ''}`)
}
