export const JETTY_STATUS_OUT_OF_SERVICE = 'Out of Service'

export function isBerthOutOfService(berth) {
  return (berth?.status || '') === JETTY_STATUS_OUT_OF_SERVICE
}

export function jettyOosAllocationMessage(jettyId, canEditMasterJetty) {
  const j = jettyId || '—'
  if (canEditMasterJetty) {
    return `Jetty ${j} is out of service. Select another jetty or restore service in Master – Jetty.`
  }
  return `Jetty ${j} is out of service. Select another jetty or contact an admin to restore the jetty.`
}
