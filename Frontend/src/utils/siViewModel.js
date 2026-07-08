import { formatDateDisplay } from './formatDateTimeDisplay.js'

/** Shared SI document view model (SIView page + SiDocumentModal). */

export const SI_FORM_COMPANY = {
  name: 'PT ENERGI UNGGUL PERSADA',
  address: 'GAMA TOWER, LT 41, JL HR RASUNA SAID, KAV C 22, KARET KUNINGAN, SETIABUDI, KOTA ADM. JAKARTA SELATAN, DKI JAKARTA, 12940',
}

/** Same rule as main list: formal document after approval (Loading or Unloading). */
export function canViewAsDocument(si) {
  if (!si) return false
  return (si.status || '').toLowerCase() === 'approved'
}

export function formatEtaBontang(si) {
  const from = si.etaFrom
  const to = si.etaTo
  if (!from && !to) return si.etaDateTime ? formatDateDisplay(si.etaDateTime) : '—'
  if (from && to && from !== to) {
    const d1 = new Date(from)
    const d2 = new Date(to)
    const mon2 = d2.toLocaleString('en-GB', { month: 'short' }).toUpperCase()
    return `${d1.getDate()} - ${d2.getDate()} ${mon2} ${d2.getFullYear()}`
  }
  return formatDateDisplay(from || to)
}

export function getShipperLines(si) {
  const fromBreakdown = (si.breakdown || [])
    .map((b) => (b.shipperName || b.shipper || '').trim())
    .filter(Boolean)
  const combined = [...new Set(fromBreakdown)]
  if (combined.length) return combined
  const aggregated = (si.shipperNames || si.shipper || '').trim()
  return aggregated ? aggregated.split(',').map((s) => s.trim()).filter(Boolean) : ['—']
}

export function mapApiToSi(row) {
  if (!row) return null
  const breakdown = Array.isArray(row.breakdown) ? row.breakdown : []
  const shipperFromLines = [
    ...new Set(breakdown.map((b) => (b.shipperName || '').trim()).filter(Boolean)),
  ]
  const shipperDisplay =
    shipperFromLines.length > 0
      ? shipperFromLines.join(', ')
      : row.shipperNames ?? '—'
  return {
    id: row.id,
    siId: row.referenceNumber || `SI-${row.id}`,
    referenceNumber: row.referenceNumber ?? null,
    vesselName: row.vesselName,
    vesselId: row.vesselId ?? null,
    voyageNo: row.voyageNo ?? null,
    purpose: row.purpose,
    purposeId: row.purposeId ?? null,
    status: row.status,
    approvalId: row.approvalId ?? null,
    commodity: row.commodity,
    commodityId: row.commodityId ?? null,
    etaDateTime: row.eta,
    etaFrom: row.etaFrom ?? null,
    etaTo: row.etaTo ?? null,
    documentDate: row.documentDate ?? null,
    destinationText: row.destinationText ?? null,
    freightTerms: row.freightTerms ?? null,
    billOfLadingClause: row.billOfLadingClause ?? null,
    consigneeText: row.consigneeText ?? null,
    notifyPartyText: row.notifyPartyText ?? null,
    blIndicated: row.blIndicated ?? null,
    approverNameSnapshot: row.approverNameSnapshot ?? null,
    approverTitleSnapshot: row.approverTitleSnapshot ?? null,
    breakdown,
    shipper: shipperDisplay,
    shipperNames: row.shipperNames ?? (shipperFromLines.length ? shipperFromLines.join(', ') : null),
    loadingPort: row.loadingPortName ?? '—',
    agent: row.agentName ?? '—',
    surveyor: row.surveyorName ?? '—',
    term: row.tradeTermCode ?? '—',
    note: row.note ?? null,
    receivedAt: row.createdAt ?? null,
    updatedAt: row.updatedAt ?? null,
    resolvedPortId: row.resolvedPortId ?? null,
    approvedAt: row.approvedAt ?? null,
  }
}
