/**
 * Builds Jetty - Vessel Report data: vessels allocated and berthed to a jetty.
 * Sources: allocationPlan, getLoadingOperationCargo, getBerthingEvents (TB), getClearance (Cast off).
 */

function startOfDay(s) {
  if (!s) return null
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  d.setUTCHours(0, 0, 0, 0)
  return d.getTime()
}

function endOfDay(s) {
  if (!s) return null
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  d.setUTCHours(23, 59, 59, 999)
  return d.getTime()
}

function isInDateRange(dateStr, startDate, endDate) {
  if (!dateStr || !startDate || !endDate) return false
  const t = new Date(dateStr).getTime()
  if (Number.isNaN(t)) return false
  const start = startOfDay(startDate)
  const end = endOfDay(endDate)
  return t >= start && t <= end
}

/**
 * @param filters { startDate, endDate, selectedJettyIds: string[] }
 * @param deps { allocationPlan, getLoadingOperationCargo, getBerthingEvents, getClearance }
 * @returns { rows: Array<{ vesselId, jetty, vessel, eta, arrivalDateTime, etb, berthedDateTime, sailedOffDateTime, commodity, quantity, stowage, loadPort, dischPort, shipper, consignee, surveyor, agent }> }
 */
export function buildJettyVesselReport(filters, deps) {
  const { allocationPlan, getLoadingOperationCargo, getBerthingEvents, getClearance } = deps
  const startDate = (filters.startDate || '').trim()
  const endDate = (filters.endDate || '').trim()
  const selectedJettyIds = Array.isArray(filters.selectedJettyIds) ? filters.selectedJettyIds : []

  const planList = allocationPlan || []
  const rows = []

  for (const plan of planList) {
    const jetty = plan.jetty || '—'
    if (selectedJettyIds.length > 0 && !selectedJettyIds.includes(jetty)) continue

    const vesselId = plan.vesselId
    const cargo = getLoadingOperationCargo(vesselId)
    const berthing = getBerthingEvents(vesselId) || {}
    const clearance = getClearance(vesselId) || {}

    const arrivalDateTime = plan.taDateTime || ''   // TA
    const berthedDateTime = berthing.allFast || ''  // TB
    const sailedOffDateTime = clearance.castOff || '' // Cast off

    const eta = plan.etaDateTime || ''
    const etb = plan.etbDateTime || ''

    const vesselName = plan.vesselName || cargo?.vesselName || vesselId
    const commodity = cargo?.commodity ?? (plan.shippingTable?.[0]?.material) ?? '—'
    const quantity = cargo?.quantity ?? (plan.shippingTable?.[0]?.qty) ?? plan.shippingTable?.map((r) => r.qty).join(', ') ?? '—'
    const stowage = cargo?.stowage ?? '—'
    const loadPort = cargo?.loadPort ?? '—'
    const dischPort = cargo?.dischPort ?? plan?.dischPort ?? '—'
    const shipper = cargo?.shipper ?? plan.shipper ?? '—'
    const consignee = cargo?.consignee ?? plan?.consignee ?? '—'
    const surveyor = cargo?.surveyor ?? plan.surveyor ?? '—'
    const agent = cargo?.agent ?? plan.agent ?? '—'

    if (startDate && endDate) {
      const anyInRange =
        isInDateRange(eta, startDate, endDate) ||
        isInDateRange(arrivalDateTime, startDate, endDate) ||
        isInDateRange(etb, startDate, endDate) ||
        isInDateRange(berthedDateTime, startDate, endDate) ||
        isInDateRange(sailedOffDateTime, startDate, endDate)
      if (!anyInRange) continue
    }

    rows.push({
      vesselId,
      jetty,
      vessel: vesselName,
      eta,
      arrivalDateTime,
      etb,
      berthedDateTime,
      sailedOffDateTime,
      commodity,
      quantity,
      stowage,
      loadPort,
      dischPort,
      shipper,
      consignee,
      surveyor,
      agent,
    })
  }

  return { rows }
}
