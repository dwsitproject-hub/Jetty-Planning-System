export const SCOPE_PARTNER = 'partner'
export const SCOPE_ALL = 'all'

function clean(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v != null && v !== ''))
}

/** Query params for the webhook deliveries list (time window and cursor are added by the paging hook). */
export function buildWebhookParams({ scope, keyId, endpointId, status, eventType, q }) {
  const inPartner = scope === SCOPE_PARTNER
  return clean({
    keyId: inPartner ? keyId : null,
    endpointId: inPartner ? endpointId : null,
    status,
    eventType,
    q: q?.trim(),
  })
}

/** Query params for the inbound API requests list. */
export function buildApiParams({ scope, keyId, statusClass, method, route, q }) {
  return clean({
    keyId: scope === SCOPE_PARTNER ? keyId : null,
    statusClass,
    method,
    route,
    q: q?.trim(),
  })
}
