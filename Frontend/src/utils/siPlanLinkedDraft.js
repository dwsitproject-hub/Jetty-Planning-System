/**
 * Shared defaults, validation, and API payload for SI drafts linked to a shipment plan
 * (used by ShippingInstructionCreateForm and multi-draft ShipmentPlansList create flow).
 */

export function planEtaYmd(plan) {
  if (!plan?.eta) return ''
  const d = new Date(plan.eta)
  if (Number.isNaN(d.getTime())) return ''
  return d.toISOString().slice(0, 10)
}

export function emptyBreakdownRow(lookups) {
  const mt = lookups?.metrics?.find((m) => m.code === 'MT') || lookups?.metrics?.[0]
  const comm = lookups?.commodities?.[0]
  return {
    shipperId: '',
    commodityId: comm?.id != null ? String(comm.id) : '',
    metricId: mt?.id != null ? String(mt.id) : '',
    qty: '',
    contractNo: '',
    poNo: '',
    soNo: '',
    remarks: '',
  }
}

export function defaultSiDraftForPlanPreview(lookups, linkedPlan) {
  const ymd = planEtaYmd(linkedPlan)
  const base = {
    vesselName: linkedPlan?.vesselName || '',
    referenceNumber: '',
    voyageNo: '',
    purposeId: linkedPlan?.purposeId != null ? String(linkedPlan.purposeId) : '',
    tradeTermId: '',
    preferredJettyId: linkedPlan?.jettyId != null ? String(linkedPlan.jettyId) : '',
    loadingPortId: '',
    surveyorId: '',
    etaFrom: ymd,
    etaTo: ymd,
    documentDate: ymd,
    destinationText: '',
    freightTerms: '',
    billOfLadingClause: '',
    blSplitText: '',
    consigneeText: '',
    notifyPartyText: '',
    blIndicated: '',
    breakdown: lookups ? [emptyBreakdownRow(lookups)] : [],
    note: '',
    documents: [],
  }
  if (!lookups) return base
  return {
    ...base,
    tradeTermId: lookups.tradeTerms?.[0]?.id != null ? String(lookups.tradeTerms[0].id) : '',
  }
}

export function nextDocId() {
  return 'doc-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)
}

function toDateInputValue(iso) {
  if (iso == null || iso === '') return ''
  const s = String(iso).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toISOString().slice(0, 10)
}

/** Map GET /shipping-instructions/:id JSON into plan-linked SI draft form shape. */
export function siDetailToPlanLinkedDraftForm(si, lookups, linkedPlan) {
  const base = defaultSiDraftForPlanPreview(lookups, linkedPlan)
  const ymd = planEtaYmd(linkedPlan)
  const purposeCode = linkedPlan?.purposeCode
  const isUnloading = purposeCode === 'Unloading'
  const bd =
    Array.isArray(si?.breakdown) && si.breakdown.length > 0
      ? si.breakdown.map((b) => ({
          shipperId: b.shipperId != null ? String(b.shipperId) : '',
          commodityId: b.commodityId != null ? String(b.commodityId) : '',
          metricId: b.metricId != null ? String(b.metricId) : '',
          qty: b.qty != null && b.qty !== '' ? String(b.qty) : '',
          contractNo: b.contractNo ?? '',
          poNo: b.poNo ?? '',
          soNo: b.soNo ?? '',
          remarks: b.remarks ?? '',
        }))
      : base.breakdown
  return {
    ...base,
    vesselName: si?.vesselName ?? base.vesselName,
    referenceNumber: si?.referenceNumber ?? '',
    purposeId: linkedPlan?.purposeId != null ? String(linkedPlan.purposeId) : base.purposeId,
    tradeTermId:
      si?.tradeTermId != null
        ? String(si.tradeTermId)
        : isUnloading
          ? base.tradeTermId
          : '',
    preferredJettyId:
      si?.preferredJettyId != null ? String(si.preferredJettyId) : base.preferredJettyId,
    loadingPortId: si?.loadingPortId != null ? String(si.loadingPortId) : '',
    surveyorId: si?.surveyorId != null ? String(si.surveyorId) : '',
    etaFrom: toDateInputValue(si?.etaFrom) || ymd,
    etaTo: toDateInputValue(si?.etaTo) || ymd,
    documentDate: toDateInputValue(si?.documentDate) || ymd,
    destinationText: si?.destinationText ?? '',
    freightTerms: si?.freightTerms ?? '',
    billOfLadingClause: si?.billOfLadingClause ?? '',
    blSplitText: si?.blSplitText ?? '',
    consigneeText: si?.consigneeText ?? '',
    notifyPartyText: si?.notifyPartyText ?? '',
    blIndicated: si?.blIndicated ?? '',
    breakdown: bd,
    note: si?.note ?? '',
    documents: [],
  }
}

/**
 * @param {{ requirePlanId?: boolean }} [options] If requirePlanId is false, skips linkedPlan.id (validate before plan is POSTed).
 * @returns {string|object} error message or validated fields object for buildSiCreateApiPayload
 */
export function validateSiDraftForCreate(form, lookups, linkedPlan, options = {}) {
  const requirePlanId = options.requirePlanId !== false
  if (!lookups) return 'Form options not loaded.'
  if (requirePlanId && !linkedPlan?.id) return 'Plan must be saved first.'
  const effectivePurposeId = linkedPlan?.purposeId != null ? String(linkedPlan.purposeId) : form.purposeId
  const pid = parseInt(effectivePurposeId, 10)
  if (Number.isNaN(pid)) return 'Select purpose on the shipment plan.'
  const pRow = (lookups?.purposes || []).find((p) => Number(p.id) === pid) || null
  const pCode = pRow?.code || null
  const isLoading = pCode === 'Loading'
  const isUnloading = pCode === 'Unloading'
  if (!form.referenceNumber?.trim()) return 'Shipping Instructions No. is required.'
  const ymd = planEtaYmd(linkedPlan)
  if (!ymd) return 'Shipment plan has no ETA.'
  let documentDateVal = form.documentDate
  if (!documentDateVal?.trim()) documentDateVal = ymd
  const num = (v) => {
    const n = parseInt(v, 10)
    return v !== '' && !Number.isNaN(n) ? n : null
  }
  const breakdownPayload = (form.breakdown || []).map((row) => ({
    shipperId: num(row.shipperId),
    commodityId: parseInt(row.commodityId, 10),
    metricId: parseInt(row.metricId, 10),
    qty: Number(row.qty) || 0,
    contractNo: row.contractNo?.trim() || null,
    poNo: row.poNo?.trim() || null,
    soNo: row.soNo?.trim() || null,
    remarks: row.remarks?.trim() || null,
  }))
  for (let i = 0; i < breakdownPayload.length; i += 1) {
    const r = breakdownPayload[i]
    if (Number.isNaN(r.commodityId) || Number.isNaN(r.metricId) || r.qty < 0) {
      return `Breakdown row ${i + 1}: select commodity and metric; quantity must be zero or greater.`
    }
  }
  const distinctCommodityTypes = new Set()
  for (const row of form.breakdown || []) {
    const c = (lookups?.commodities || []).find((x) => String(x.id) === String(row.commodityId))
    if (c?.commodityType) distinctCommodityTypes.add(c.commodityType)
  }
  if (distinctCommodityTypes.size > 1) {
    return 'All commodities on one shipping instruction must be the same type (Solid or Liquid).'
  }
  if (!form.vesselName?.trim()) return 'Vessel name is required.'
  return { pid, isLoading, isUnloading, ymd, documentDateVal: documentDateVal.trim(), breakdownPayload, num }
}

/** Draft block id from plan modal when editing an existing SI (`si-existing-<id>`). */
export function existingSiIdFromDraftKey(draftId) {
  const m = /^si-existing-(\d+)$/.exec(String(draftId || ''))
  return m ? parseInt(m[1], 10) : null
}

/**
 * @param {ReturnType<typeof validateSiDraftForCreate> extends string ? never : object} validated
 */
export function buildSiCreateApiPayload(form, linkedPlan, validated) {
  const { pid, isLoading, isUnloading, ymd, documentDateVal, breakdownPayload, num } = validated
  const etaIso = new Date(`${ymd}T12:00:00`).toISOString()
  return {
    vesselName: form.vesselName.trim(),
    purposeId: pid,
    tradeTermId: isUnloading ? num(form.tradeTermId) : null,
    preferredJettyId: num(form.preferredJettyId),
    loadingPortId: num(form.loadingPortId),
    surveyorId: num(form.surveyorId),
    agentId: linkedPlan?.agentId != null && linkedPlan.agentId !== '' ? num(String(linkedPlan.agentId)) : null,
    referenceNumber: form.referenceNumber.trim(),
    voyageNo: linkedPlan.voyageNo?.trim() || null,
    eta: etaIso,
    etaFrom: ymd,
    etaTo: ymd,
    documentDate: documentDateVal,
    destinationText: isLoading ? form.destinationText?.trim() || null : null,
    freightTerms: isLoading ? form.freightTerms?.trim() || null : null,
    billOfLadingClause: isLoading ? form.billOfLadingClause?.trim() || null : null,
    blSplitText: isLoading ? form.blSplitText?.trim() || null : null,
    consigneeText: isLoading ? form.consigneeText?.trim() || null : null,
    notifyPartyText: isLoading ? form.notifyPartyText?.trim() || null : null,
    blIndicated: isLoading ? form.blIndicated?.trim() || null : null,
    status: 'Draft',
    breakdown: breakdownPayload,
    note: form.note?.trim() || null,
    shipmentPlanId: linkedPlan.id,
  }
}

export function buildSiUpdateApiPayload(form, linkedPlan, validated) {
  const payload = buildSiCreateApiPayload(form, linkedPlan, validated)
  delete payload.shipmentPlanId
  return payload
}
