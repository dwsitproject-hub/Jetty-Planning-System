/**
 * Allocation & Berthing activity log: show "Vessel · Plan reference" instead of
 * raw "Operation #231" / plan-code-only labels. Resolved at read time so older rows benefit too.
 */

export const PLAN_LABEL_PAGE_KEYS = new Set(['allocation-plan']);

const DOCUMENT_TYPE = / document$/i;

export function formatVesselPlanLabel(vesselName, planReference) {
  const vessel = (vesselName || '').trim();
  const plan = (planReference || '').trim();
  if (vessel && plan) return `${vessel} · ${plan}`;
  return vessel || plan || null;
}

function positiveInt(value) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Which operation / shipment plan a row refers to (from entity id or meta). */
export function activityRowTarget(row, meta) {
  const type = row.entity_type || '';
  if (type === 'ShipmentPlan') {
    return { planId: positiveInt(row.entity_id) ?? positiveInt(meta?.shipmentPlanId) };
  }
  if (type === 'Operation' || DOCUMENT_TYPE.test(type)) {
    return { operationId: positiveInt(meta?.operationId) ?? positiveInt(row.entity_id) };
  }
  return {};
}

/** Apply a resolved { vesselName, planReference } to one row (pure). */
export function applyPlanLabel(row, meta, info) {
  const label = info ? formatVesselPlanLabel(info.vesselName, info.planReference) : null;
  if (!label) return row;
  const nextMeta = { ...(meta || {}), vesselName: info.vesselName || null, planReference: info.planReference || null };
  if (DOCUMENT_TYPE.test(row.entity_type || '')) {
    const opId = positiveInt(meta?.operationId) ?? positiveInt(row.entity_id);
    const summary = opId && row.summary
      ? row.summary.replace(new RegExp(`\\boperation ${opId}\\b`, 'i'), label)
      : row.summary;
    return { ...row, summary, meta_json: nextMeta };
  }
  return { ...row, entity_label: label, meta_json: nextMeta };
}

export async function enrichPlanLabelsOnActivityRows(pool, rows, parseMeta) {
  const targets = rows.map((row) => {
    const meta = parseMeta(row.meta_json);
    return { meta, ...activityRowTarget(row, meta) };
  });
  const opIds = [...new Set(targets.map((t) => t.operationId).filter(Boolean))];
  const planIds = [...new Set(targets.map((t) => t.planId).filter(Boolean))];
  if (!opIds.length && !planIds.length) return rows;

  const [opsRes, plansRes] = await Promise.all([
    opIds.length
      ? pool.query(
          `SELECT o.id, sp.vessel_name, sp.plan_reference
             FROM operations o
             JOIN shipping_instructions si ON si.id = o.shipping_instruction_id
             LEFT JOIN shipment_plans sp ON sp.id = si.shipment_plan_id
            WHERE o.id = ANY($1::bigint[])`,
          [opIds]
        )
      : { rows: [] },
    planIds.length
      ? pool.query(
          `SELECT id, vessel_name, plan_reference FROM shipment_plans WHERE id = ANY($1::bigint[])`,
          [planIds]
        )
      : { rows: [] },
  ]);
  const toInfo = (r) => [Number(r.id), { vesselName: r.vessel_name, planReference: r.plan_reference }];
  const byOp = new Map(opsRes.rows.map(toInfo));
  const byPlan = new Map(plansRes.rows.map(toInfo));

  return rows.map((row, i) => {
    const { meta, operationId, planId } = targets[i];
    const info = operationId ? byOp.get(operationId) : planId ? byPlan.get(planId) : null;
    return applyPlanLabel(row, meta, info);
  });
}
