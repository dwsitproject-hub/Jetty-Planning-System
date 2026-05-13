/**
 * Collapse allocation queue / berth occupants to one logical vessel per shipment plan
 * for plan-centric Allocation (schematic, Gantt, incoming-by-jetty hints).
 */

function parseMs(val) {
  if (val == null || val === '') return null
  const t = new Date(val).getTime()
  return Number.isNaN(t) ? null : t
}

function minIsoDateTime(rows, key) {
  let best = null
  let bestMs = Infinity
  for (const r of rows) {
    const v = r?.[key]
    const ms = parseMs(v)
    if (ms != null && ms < bestMs) {
      bestMs = ms
      best = typeof v === 'string' ? v : new Date(v).toISOString()
    }
  }
  return best
}

function maxIsoDateTime(rows, key) {
  let best = null
  let bestMs = -Infinity
  for (const r of rows) {
    const v = r?.[key]
    const ms = parseMs(v)
    if (ms != null && ms > bestMs) {
      bestMs = ms
      best = typeof v === 'string' ? v : new Date(v).toISOString()
    }
  }
  return best
}

const STATUS_RANK = {
  SAILED: 100,
  SIGNOFF_APPROVED: 90,
  SIGNOFF_REQUESTED: 80,
  POST_OPS: 70,
  IN_PROGRESS: 60,
  DOCKED: 50,
  ALLOCATED: 40,
  PENDING: 30,
  '': 0,
}

function mergeStatus(children) {
  let best = ''
  let bestRank = -1
  for (const c of children) {
    const s = String(c?.status || '').trim().toUpperCase()
    const r = STATUS_RANK[s] ?? 0
    if (r > bestRank) {
      bestRank = r
      best = s || c?.status || ''
    }
  }
  return best || null
}

/** Prefer earliest TB among ops, else first row with operationId, else first child. */
export function pickRepresentativeQueueChild(children) {
  const seqRank = (a, b) => {
    const va = Number.isFinite(Number(a?.sequence)) ? Number(a.sequence) : Number.POSITIVE_INFINITY
    const vb = Number.isFinite(Number(b?.sequence)) ? Number(b.sequence) : Number.POSITIVE_INFINITY
    if (va !== vb) return va - vb
    return (Number(a?.operationId) || 0) - (Number(b?.operationId) || 0)
  }
  const sorted = [...(children || [])].sort(seqRank)
  const withTb = sorted.filter((c) => c.tbDateTime && c.operationId != null)
  if (withTb.length) {
    return [...withTb].sort((a, b) => parseMs(a.tbDateTime) - parseMs(b.tbDateTime))[0]
  }
  const withOp = sorted.filter((c) => c.operationId != null)
  if (withOp.length) return withOp[0]
  return sorted[0] || null
}

/**
 * @param {unknown[]} children
 * @param {number} planId
 * @param {Map<string, string>} repMapOut
 * @param {{ idMode?: 'plan' | 'representative' }} [options]
 */
function mergePlanChildrenToQueueRow(children, planId, repMapOut, options = {}) {
  const idMode = options.idMode || 'plan'
  const rep = pickRepresentativeQueueChild(children) || children[0]
  const synthVesselId = `plan-${planId}`
  repMapOut.set(synthVesselId, rep?.vesselId || synthVesselId)

  const first = children[0] || {}
  const planRef = first.planReference || `Plan #${planId}`
  const siLabels = [...new Set(children.map((c) => (c.shippingInstruction || '').trim()).filter(Boolean))]
  const siJoined = siLabels.length ? siLabels.join(', ') : ''
  /** Single-line text for sort/filter (plan ref column shows ref separately on allocation-plans). */
  const shippingInstruction = siJoined || planRef || '—'

  const sortedCh = [...children].sort((a, b) => {
    const va = Number.isFinite(Number(a?.sequence)) ? Number(a.sequence) : Number.POSITIVE_INFINITY
    const vb = Number.isFinite(Number(b?.sequence)) ? Number(b.sequence) : Number.POSITIVE_INFINITY
    if (va !== vb) return va - vb
    return (Number(a?.operationId) || 0) - (Number(b?.operationId) || 0)
  })
  const seqNums = sortedCh
    .map((c) => (c.sequence != null ? Number(c.sequence) : NaN))
    .filter((n) => Number.isFinite(n))
  const seenSi = new Set()
  const planQueueSiEntries = []
  for (const c of sortedCh) {
    const sid = c?.shippingInstructionId
    if (sid == null || sid === '') continue
    const num = Number(sid)
    if (!Number.isFinite(num)) continue
    if (seenSi.has(num)) continue
    seenSi.add(num)
    const label = (c.shippingInstruction || '').trim() || `SI-${num}`
    planQueueSiEntries.push({ shippingInstructionId: num, label })
  }

  const jettySet = new Set()
  for (const c of children) {
    const j = String(c?.jetty || '')
      .trim()
      .split('/')[0]
      .trim()
    if (j) jettySet.add(j)
  }
  const jettyParts = [...jettySet]
  const jetty =
    jettyParts.length === 0 ? rep?.jetty || '' : jettyParts.length === 1 ? jettyParts[0] : jettyParts.join(', ')

  const shiftingOut = children.some((c) => c.shiftingOut)
  const completionPercent = Math.max(
    ...children.map((c) => (c.completionPercent != null ? Number(c.completionPercent) : 0)),
    0
  )

  const mergedId =
    idMode === 'representative' && rep?.id != null && rep.id !== ''
      ? rep.id
      : `plan-${planId}`

  return {
    ...rep,
    id: mergedId,
    vesselId: synthVesselId,
    vesselName: first.vesselName || rep?.vesselName || '—',
    shippingInstruction,
    jetty,
    sequence: seqNums.length ? Math.min(...seqNums) : null,
    shipmentPlanId: planId,
    planReference: first.planReference ?? rep?.planReference ?? null,
    planPurposeLabel: first.planPurposeLabel ?? rep?.planPurposeLabel ?? null,
    purpose: first.planPurposeLabel || rep?.purpose || first.purpose || null,
    shiftingOut,
    shiftingOutAt: maxIsoDateTime(children, 'shiftingOutAt'),
    status: mergeStatus(children),
    completionPercent,
    etaDateTime: minIsoDateTime(children, 'etaDateTime'),
    taDateTime: minIsoDateTime(children, 'taDateTime'),
    etbDateTime: minIsoDateTime(children, 'etbDateTime'),
    plannedEtbDateTime: minIsoDateTime(children, 'plannedEtbDateTime') ?? minIsoDateTime(children, 'etbDateTime'),
    pobDateTime: minIsoDateTime(children, 'pobDateTime'),
    tbDateTime: minIsoDateTime(children, 'tbDateTime'),
    sobDateTime: maxIsoDateTime(children, 'sobDateTime'),
    estimatedCompletionDateTime: maxIsoDateTime(children, 'estimatedCompletionDateTime'),
    actualCompletionDateTime: maxIsoDateTime(children, 'actualCompletionDateTime'),
    castOffDateTime: maxIsoDateTime(children, 'castOffDateTime'),
    norTenderedDateTime: minIsoDateTime(children, 'norTenderedDateTime'),
    norAcceptedDateTime: maxIsoDateTime(children, 'norAcceptedDateTime'),
    demurrageLiabilityFromDateTime: rep?.demurrageLiabilityFromDateTime ?? minIsoDateTime(children, 'demurrageLiabilityFromDateTime'),
    recordLastUpdatedAt: maxIsoDateTime(children, 'recordLastUpdatedAt'),
    recordLastUpdatedByDisplayName: rep?.recordLastUpdatedByDisplayName ?? null,
    operationId: rep?.operationId ?? null,
    shippingInstructionId: rep?.shippingInstructionId ?? null,
    jettyOperationCode: rep?.jettyOperationCode ?? null,
    norDocuments: Array.isArray(rep?.norDocuments) ? rep.norDocuments : [],
    noPkk: rep?.noPkk ?? null,
    priority: rep?.priority ?? null,
    remark: rep?.remark ?? rep?.remarks ?? null,
    remarks: rep?.remarks ?? rep?.remark ?? null,
    shipper: rep?.shipper ?? null,
    agent: rep?.agent ?? null,
    surveyor: rep?.surveyor ?? null,
    commodity: [...new Set(children.map((c) => c.commodity).filter(Boolean))].join(' · ') || rep?.commodity || null,
    source: children.some((c) => c.source === 'operation') ? 'operation' : rep?.source || 'incoming-si',
    eta: rep?.eta ?? first.eta ?? null,
    etb: rep?.etb ?? first.etb ?? null,
    planQueueSiEntries,
  }
}

/**
 * @param {unknown[]} rows
 * @param {{ idMode?: 'plan' | 'representative' }} [options]
 * @returns {{ mergedRows: unknown[], planVesselToRepresentativeVesselId: Map<string, string> }}
 */
export function mergeQueueRowsForPlanPov(rows, options = {}) {
  const planMap = new Map()
  const order = []
  for (const r of rows || []) {
    const pid = r?.shipmentPlanId != null ? Number(r.shipmentPlanId) : null
    if (pid == null || Number.isNaN(pid)) {
      order.push({ type: 'row', row: r })
      continue
    }
    if (!planMap.has(pid)) {
      planMap.set(pid, [])
      order.push({ type: 'plan', planId: pid })
    }
    planMap.get(pid).push(r)
  }

  const repMap = new Map()
  const mergedRows = []
  for (const ent of order) {
    if (ent.type === 'row') {
      mergedRows.push(ent.row)
      continue
    }
    const ch = planMap.get(ent.planId) || []
    mergedRows.push(mergePlanChildrenToQueueRow(ch, ent.planId, repMap, options))
  }
  return { mergedRows, planVesselToRepresentativeVesselId: repMap }
}

function pickRepresentativeOccupant(group) {
  const withTb = group.filter((o) => o.tbDateTime && o.operationId != null)
  if (withTb.length) {
    return [...withTb].sort((a, b) => parseMs(a.tbDateTime) - parseMs(b.tbDateTime))[0]
  }
  const withOp = group.filter((o) => o.operationId != null)
  if (withOp.length) return withOp[0]
  return group[0]
}

function mergeOccupantGroup(group, planId, repMapFromQueue) {
  const synth = `plan-${planId}`
  const repV = repMapFromQueue?.get(synth)
  const rep = repV
    ? group.find((g) => g.vesselId === repV) || pickRepresentativeOccupant(group)
    : pickRepresentativeOccupant(group)
  return {
    vesselId: synth,
    vesselName: group[0]?.vesselName || rep?.vesselName || '—',
    operationId: rep?.operationId ?? null,
    shipmentPlanId: planId,
    status: mergeStatus(group),
    taDateTime: minIsoDateTime(group, 'taDateTime'),
    tbDateTime: minIsoDateTime(group, 'tbDateTime'),
    estimatedCompletionDateTime: maxIsoDateTime(group, 'estimatedCompletionDateTime'),
    actualCompletionDateTime: maxIsoDateTime(group, 'actualCompletionDateTime'),
    castOffDateTime: maxIsoDateTime(group, 'castOffDateTime'),
  }
}

/**
 * @param {unknown[]} berths
 * @param {Map<string, string>} [repMapFromQueue] plan vessel id -> real queue vesselId for representative alignment
 */
export function mergeBerthsStateForPlanPov(berths, repMapFromQueue) {
  if (!Array.isArray(berths)) return []
  return berths.map((b) => {
    const occs = Array.isArray(b.occupants) ? b.occupants : []
    const byPlan = new Map()
    const unlinked = []
    for (const o of occs) {
      const pid = o?.shipmentPlanId != null ? Number(o.shipmentPlanId) : null
      if (pid == null || Number.isNaN(pid)) {
        unlinked.push(o)
        continue
      }
      if (!byPlan.has(pid)) byPlan.set(pid, [])
      byPlan.get(pid).push(o)
    }
    const mergedOcc = []
    for (const [pid, grp] of byPlan) {
      mergedOcc.push(mergeOccupantGroup(grp, pid, repMapFromQueue))
    }
    const nextOcc = [...mergedOcc, ...unlinked]
    const occ0 = nextOcc[0] || null
    return {
      ...b,
      occupants: nextOcc,
      occupiedCount: nextOcc.length,
      currentVesselId: occ0 ? occ0.vesselId : null,
      currentVesselName: occ0 ? occ0.vesselName : null,
      currentOperationId: occ0?.operationId != null ? Number(occ0.operationId) : null,
    }
  })
}
