/** Dashboard V2 filter helpers — OR within category, AND across categories. */

/**
 * @param {Array<{ id?: number, name?: string, value?: string }>} masterCommodities
 * @returns {Map<string, number>}
 */
export function buildCommodityIdByName(masterCommodities) {
  const map = new Map()
  for (const c of masterCommodities || []) {
    const name = (c.name || c.value || '').trim().toLowerCase()
    if (name && c.id != null) map.set(name, Number(c.id))
  }
  return map
}

/**
 * @param {Array<{ id?: number, shippingInstructions?: Array<{ breakdown?: Array<{ commodityId?: number|null }> }> }>} plans
 * @param {object[]} [ops]
 * @param {Map<string, number>} [commodityIdByName]
 * @returns {Map<number, Set<number>>}
 */
export function buildPlanCommodityIndex(plans, ops = [], commodityIdByName = new Map()) {
  const index = new Map()
  for (const plan of plans) {
    const planId = plan?.id
    if (planId == null) continue
    const ids = new Set()
    for (const si of plan.shippingInstructions || []) {
      for (const line of si.breakdown || []) {
        const cid = line?.commodityId
        if (cid != null && Number.isFinite(Number(cid))) ids.add(Number(cid))
      }
    }
    index.set(Number(planId), ids)
  }
  for (const op of ops || []) {
    const pid = op?.shipmentPlanId
    if (pid == null) continue
    const key = Number(pid)
    if (!index.has(key)) index.set(key, new Set())
    const name = (op?.commodity || '').trim().toLowerCase()
    const cid = name ? commodityIdByName.get(name) : null
    if (cid != null) index.get(key).add(cid)
  }
  return index
}

/**
 * @param {Map<number, Set<number>>} commodityIndex
 * @param {number|null|undefined} planId
 */
function planCommodityIds(commodityIndex, planId) {
  if (planId == null) return new Set()
  return commodityIndex.get(Number(planId)) || new Set()
}

/**
 * @param {object} plan
 * @param {{ purposes?: string[], commodityIds?: string[], commodityIndex?: Map<number, Set<number>>, commodityNameById?: Map<number, string> }} filters
 */
export function planMatchesFilters(plan, filters) {
  const { purposes = [], commodityIds = [], commodityIndex = new Map() } = filters

  if (purposes.length > 0) {
    const code = plan?.purposeCode || plan?.purpose || ''
    if (!purposes.includes(code)) return false
  }

  if (commodityIds.length > 0) {
    const selected = commodityIds.map((id) => Number(id)).filter((n) => Number.isFinite(n))
    const planIds = planCommodityIds(commodityIndex, plan?.id)
    if (selected.length > 0 && !selected.some((id) => planIds.has(id))) return false
  }

  return true
}

/**
 * @param {object} op
 * @param {object} filters
 * @param {Map<number, object>|null} [planById]
 */
export function opMatchesFilters(op, filters, planById = null) {
  const {
    purposes = [],
    commodityIds = [],
    commodityIndex = new Map(),
    commodityNameById = new Map(),
  } = filters

  const pid = op?.shipmentPlanId != null ? Number(op.shipmentPlanId) : null
  const linkedPlan = pid != null && planById ? planById.get(pid) : null

  if (purposes.length > 0) {
    const purpose = op?.purpose || linkedPlan?.purposeCode || linkedPlan?.purpose || ''
    if (!purposes.includes(purpose)) return false
  }

  if (commodityIds.length > 0) {
    const selectedNums = commodityIds.map((id) => Number(id)).filter((n) => Number.isFinite(n))
    if (selectedNums.length === 0) return true

    if (pid != null) {
      const planIds = planCommodityIds(commodityIndex, pid)
      if (selectedNums.some((id) => planIds.has(id))) return true
    }

    const opCommodity = (op?.commodity || '').trim().toLowerCase()
    if (opCommodity) {
      for (const id of selectedNums) {
        const name = (commodityNameById.get(id) || '').trim().toLowerCase()
        if (name && name === opCommodity) return true
      }
    }
    return false
  }

  return true
}

/**
 * @param {object[]} plans
 * @param {object} filters
 */
export function filterPlans(plans, filters) {
  if (!Array.isArray(plans)) return []
  const hasPurpose = (filters.purposes || []).length > 0
  const hasCommodity = (filters.commodityIds || []).length > 0
  if (!hasPurpose && !hasCommodity) return plans
  return plans.filter((p) => planMatchesFilters(p, filters))
}

/**
 * @param {object[]} ops
 * @param {object} filters
 * @param {Map<number, Set<number>>} [commodityIndex]
 * @param {object[]} [plansForLookup]
 */
export function filterOps(ops, filters, commodityIndex, plansForLookup = []) {
  if (!Array.isArray(ops)) return []
  const hasPurpose = (filters.purposes || []).length > 0
  const hasCommodity = (filters.commodityIds || []).length > 0
  if (!hasPurpose && !hasCommodity) return ops

  const planById = new Map()
  for (const p of plansForLookup) {
    if (p?.id != null) planById.set(Number(p.id), p)
  }

  const enriched = {
    ...filters,
    commodityIndex: commodityIndex || filters.commodityIndex || new Map(),
  }

  return ops.filter((o) => opMatchesFilters(o, enriched, planById))
}

/**
 * @param {string[]} selectedIds
 * @param {Set<string>|string[]} availableIds
 */
export function pruneInvalidCommoditySelection(selectedIds, availableIds) {
  const avail = availableIds instanceof Set ? availableIds : new Set(availableIds)
  return (selectedIds || []).filter((id) => avail.has(String(id)))
}

/**
 * Dropdown options from Master Commodity (si_commodities via /si-lookups).
 * @param {Array<{ id?: number, name?: string, value?: string, sortOrder?: number }>} masterCommodities
 * @returns {Array<{ value: string, label: string }>}
 */
export function extractCommodityOptionsFromMaster(masterCommodities) {
  const options = (masterCommodities || [])
    .filter((c) => c?.id != null)
    .map((c) => ({
      value: String(c.id),
      label: c.name || c.value || `Commodity #${c.id}`,
      sortOrder: c.sortOrder ?? 0,
    }))

  options.sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
    return a.label.localeCompare(b.label)
  })

  return options.map(({ value, label }) => ({ value, label }))
}

/**
 * @param {Array<{ id?: number, name?: string, value?: string }>} masterCommodities
 * @returns {Map<number, string>}
 */
export function buildCommodityNameById(masterCommodities) {
  const map = new Map()
  for (const c of masterCommodities || []) {
    const id = c?.id
    if (id != null) map.set(Number(id), c.name || c.value || '')
  }
  return map
}
