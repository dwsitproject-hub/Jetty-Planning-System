function getBerthingPlanStatus(row) {
  if (row?.shiftingOut) return 'incoming'
  const hasTb = Boolean(row?.tbDateTime)
  const opStatus = String(row?.status || '').toUpperCase()
  if (
    hasTb ||
    opStatus === 'DOCKED' ||
    opStatus === 'IN_PROGRESS' ||
    opStatus === 'POST_OPS' ||
    opStatus === 'SIGNOFF_REQUESTED' ||
    opStatus === 'SIGNOFF_APPROVED'
  ) {
    return 'berthed'
  }
  return 'incoming'
}

function parseEtaMs(row) {
  if (!row?.etaDateTime) return null
  const t = new Date(row.etaDateTime).getTime()
  return Number.isNaN(t) ? null : t
}

function compareChildren(a, b) {
  const sa = Number.isFinite(Number(a?.sequence)) ? Number(a.sequence) : Number.POSITIVE_INFINITY
  const sb = Number.isFinite(Number(b?.sequence)) ? Number(b.sequence) : Number.POSITIVE_INFINITY
  if (sa !== sb) return sa - sb
  const ea = parseEtaMs(a) ?? Number.MAX_SAFE_INTEGER
  const eb = parseEtaMs(b) ?? Number.MAX_SAFE_INTEGER
  if (ea !== eb) return ea - eb
  const ida = String(a.id || '')
  const idb = String(b.id || '')
  return ida.localeCompare(idb, undefined, { numeric: true })
}

/**
 * @param {Array<Record<string, unknown>>} rows Filtered allocation queue rows (flat).
 * @param {Array<Record<string, unknown>>|null} globalOrder Optional rows in display order (e.g. sorted list); when set, children within each plan follow this order.
 * @returns {{ grouped: Array<{ planId: number, planReference: string, planPurposeLabel: string|null, vesselName: string, jettySummary: string, children: typeof rows }>, unlinked: typeof rows }}
 */
export function groupQueueByShipmentPlan(rows, globalOrder = null) {
  const orderIndex =
    globalOrder && globalOrder.length
      ? new Map(globalOrder.map((r, i) => [r.id, i]))
      : null
  const byPlan = new Map()
  const unlinked = []
  for (const r of rows || []) {
    const pid = r?.shipmentPlanId != null ? Number(r.shipmentPlanId) : null
    if (pid == null || Number.isNaN(pid)) {
      unlinked.push(r)
      continue
    }
    if (!byPlan.has(pid)) byPlan.set(pid, [])
    byPlan.get(pid).push(r)
  }

  const grouped = []
  for (const [planId, children] of byPlan) {
    const sortedChildren = [...children].sort((a, b) => {
      if (orderIndex) {
        const ia = orderIndex.has(a.id) ? orderIndex.get(a.id) : Number.MAX_SAFE_INTEGER
        const ib = orderIndex.has(b.id) ? orderIndex.get(b.id) : Number.MAX_SAFE_INTEGER
        if (ia !== ib) return ia - ib
      }
      return compareChildren(a, b)
    })
    const first = sortedChildren[0] || {}
    const planReference = first.planReference || `Plan #${planId}`
    const planPurposeLabel = first.planPurposeLabel ?? null
    const vesselName = first.vesselName || '—'
    const jettySet = new Set()
    for (const c of sortedChildren) {
      const j = String(c?.jetty || '')
        .trim()
        .split('/')[0]
        .trim()
      if (j) jettySet.add(j)
    }
    const jettySummary = jettySet.size === 0 ? '—' : jettySet.size === 1 ? [...jettySet][0] : `${[...jettySet].join(', ')}`

    const incoming = sortedChildren.filter((c) => getBerthingPlanStatus(c) === 'incoming').length
    const berthed = sortedChildren.length - incoming

    grouped.push({
      planId,
      planReference,
      planPurposeLabel,
      vesselName,
      jettySummary,
      berthedCount: berthed,
      incomingCount: incoming,
      children: sortedChildren,
    })
  }

  grouped.sort((a, b) => {
    const amin = Math.min(
      ...a.children.map((c) => parseEtaMs(c) ?? Number.MAX_SAFE_INTEGER)
    )
    const bmin = Math.min(
      ...b.children.map((c) => parseEtaMs(c) ?? Number.MAX_SAFE_INTEGER)
    )
    if (amin !== bmin) return amin - bmin
    return a.planId - b.planId
  })

  unlinked.sort((a, b) => {
    if (orderIndex) {
      const ia = orderIndex.has(a.id) ? orderIndex.get(a.id) : Number.MAX_SAFE_INTEGER
      const ib = orderIndex.has(b.id) ? orderIndex.get(b.id) : Number.MAX_SAFE_INTEGER
      if (ia !== ib) return ia - ib
    }
    return compareChildren(a, b)
  })
  return { grouped, unlinked }
}
