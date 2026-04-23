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
  if (!from && !to) return si.etaDateTime ? new Date(si.etaDateTime).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
  if (from && to && from !== to) {
    const d1 = new Date(from)
    const d2 = new Date(to)
    const mon2 = d2.toLocaleString('en-GB', { month: 'short' }).toUpperCase()
    return `${d1.getDate()} - ${d2.getDate()} ${mon2} ${d2.getFullYear()}`
  }
  const d = new Date(from || to)
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function getShipperLines(si) {
  const main = (si.shipper || '').trim()
  const fromBreakdown = (si.breakdown || []).map((b) => (b.shipper || '').trim()).filter(Boolean)
  const combined = main ? [main, ...fromBreakdown.filter((s) => s !== main)] : [...new Set(fromBreakdown)]
  return combined.length ? combined : ['—']
}

export function mapApiToSi(row) {
  if (!row) return null
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
    breakdown: Array.isArray(row.breakdown) ? row.breakdown : [],
    shipper: row.shipperName ?? '—',
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
