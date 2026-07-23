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

/**
 * Multi-jetty berthing: capacity/occupancy check for assigning `berth` as a PRIMARY jetty.
 * Counts real occupants (excluding the vessel currently being edited) PLUS vessels berthed at
 * adjacent jetties that span into this one (`berth.spannedByLanes` / `berth.spannedBy`) — each
 * occupies one of this jetty's own lanes even though they're not in `berth.occupants`. Without
 * this, a double-bank jetty already spanned into on one lane would look fully free for a second,
 * unrelated direct booking.
 */
export function berthOtherOccupants(berth, excludeVesselId) {
  const occList = Array.isArray(berth?.occupants)
    ? berth.occupants
    : berth?.currentVesselId
      ? [{ vesselId: berth.currentVesselId }]
      : []
  const others = occList.filter((o) => o?.vesselId && o.vesselId !== excludeVesselId)
  const spannedLanes =
    Array.isArray(berth?.spannedByLanes) && berth.spannedByLanes.length
      ? berth.spannedByLanes
      : berth?.spannedBy
        ? [berth.spannedBy]
        : []
  for (const spanned of spannedLanes) {
    if (spanned?.vesselId && spanned.vesselId !== excludeVesselId) {
      others.push({ vesselId: spanned.vesselId, vesselName: spanned.vesselName })
    }
  }
  return others
}
