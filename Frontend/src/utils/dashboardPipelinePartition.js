/** @see Frontend/src/pages/DashboardV2.jsx vessel pipeline */

const AT_BERTH_OP_STATUSES = new Set(['DOCKED', 'IN_PROGRESS', 'POST_OPS', 'SIGNOFF_REQUESTED'])
const READY_TO_SAIL_OP_STATUSES = new Set(['SIGNOFF_APPROVED'])
const SAILED_OP_STATUSES = new Set(['SAILED'])
const PIPELINE_ORPHAN_OP_STATUSES = new Set([
  ...AT_BERTH_OP_STATUSES,
  ...READY_TO_SAIL_OP_STATUSES,
  ...SAILED_OP_STATUSES,
])

function parseIso(value) {
  if (value == null || value === '') return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function maxOpStageRank(planOps) {
  let r = 0
  for (const o of planOps) {
    const s = o?.status
    if (SAILED_OP_STATUSES.has(s)) r = Math.max(r, 4)
    else if (READY_TO_SAIL_OP_STATUSES.has(s)) r = Math.max(r, 3)
    else if (AT_BERTH_OP_STATUSES.has(s)) r = Math.max(r, 2)
  }
  return r
}

/**
 * Mutually exclusive pipeline buckets for non-rejected plans (filtered list = ETA window).
 * Stage 2 (Shipment request): Draft or Submitted pending approval, regardless of preferred jettyId.
 * Stage 3 (Incoming): Approved, no jetty assigned, not alongside.
 * Stage 4 (Planned berthing): Approved with jetty assigned, not alongside (not Draft/Submitted).
 * Stages 5–7: operations linked via shipmentPlanId; plan.tb / plan.sailedAt as fallbacks.
 */
export function computePipelinePartition(plans, ops) {
  const opsByPlan = new Map()
  for (const o of ops) {
    const pid = o.shipmentPlanId
    if (pid == null) continue
    if (!opsByPlan.has(pid)) opsByPlan.set(pid, [])
    opsByPlan.get(pid).push(o)
  }

  let orphanPipelineOps = 0
  for (const o of ops) {
    if (o.shipmentPlanId != null) continue
    if (PIPELINE_ORPHAN_OP_STATUSES.has(o.status)) orphanPipelineOps += 1
  }

  let shipmentRequest = 0
  let incoming = 0
  let plannedBerthing = 0
  let atBerthCount = 0
  let readyToSail = 0
  let sailed = 0
  let unclassified = 0
  let rejectedPlans = 0
  let approvedPlans = 0

  for (const p of plans) {
    const st = p.approvalStatus
    if (st === 'Approved') approvedPlans += 1
    if (st === 'Rejected') {
      rejectedPlans += 1
      continue
    }

    const planOps = opsByPlan.get(p.id) || []
    const opRank = maxOpStageRank(planOps)
    const hasTb = !!parseIso(p.tb)
    const sailedByPlan = !!parseIso(p.sailedAt)

    if (opRank >= 4 || sailedByPlan) sailed += 1
    else if (opRank >= 3) readyToSail += 1
    else if (opRank >= 2 || (st === 'Approved' && hasTb)) atBerthCount += 1
    else if (st === 'Approved' && p.jettyId != null && !hasTb) plannedBerthing += 1
    else if (st === 'Approved' && !p.jettyId && !hasTb) incoming += 1
    else if ((st === 'Draft' || st === 'Submitted') && !hasTb) shipmentRequest += 1
    else if (hasTb) atBerthCount += 1
    else unclassified += 1
  }

  const planCountTotal = plans.length
  const planPipelineTotal = planCountTotal - rejectedPlans
  const stageSum =
    shipmentRequest + incoming + plannedBerthing + atBerthCount + readyToSail + sailed + unclassified

  return {
    planCountTotal,
    planPipelineTotal,
    rejectedPlans,
    approvedPlans,
    shipmentRequest,
    incoming,
    plannedBerthing,
    atBerthCount,
    readyToSail,
    sailed,
    unclassified,
    orphanPipelineOps,
    partitionBalanced: stageSum === planPipelineTotal,
  }
}
