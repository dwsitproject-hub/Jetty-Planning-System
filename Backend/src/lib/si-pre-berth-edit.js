/** Reject SI / plan update when any operation on the plan has recorded TB. */
export const POST_BERTH_EDIT_ERROR = 'Shipping instruction cannot be edited after berthing.';

export const POST_BERTH_PLAN_EDIT_ERROR = 'Shipment plan cannot be edited after berthing.';

/** Block material edits while plan awaits approval decision. */
export const SUBMITTED_MATERIAL_EDIT_ERROR =
  'Material SI changes are not allowed while the shipment plan is submitted. Update the reference number or wait for an approval decision.';

function trimOrNull(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  return s || null;
}

function numOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeBreakdownRow(row) {
  if (!row) return null;
  return {
    commodityId: Number.parseInt(row.commodity_id ?? row.commodityId, 10),
    metricId: Number.parseInt(row.metric_id ?? row.metricId, 10),
    qty: Number(row.qty) || 0,
    shipperId: numOrNull(row.shipper_id ?? row.shipperId),
    contractNo: trimOrNull(row.contract_no ?? row.contractNo),
    poNo: trimOrNull(row.po_no ?? row.poNo),
    soNo: trimOrNull(row.so_no ?? row.soNo),
    remarks: trimOrNull(row.remarks),
  };
}

function breakdownSignature(rows) {
  const normalized = (rows || [])
    .map(normalizeBreakdownRow)
    .filter(Boolean)
    .map((r) =>
      JSON.stringify([
        r.commodityId,
        r.metricId,
        r.qty,
        r.shipperId,
        r.contractNo,
        r.poNo,
        r.soNo,
        r.remarks,
      ])
    )
    .sort();
  return normalized.join('|');
}

/**
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {number} planId
 * @returns {Promise<boolean>}
 */
export async function isShipmentPlanPreBerth(db, planId) {
  const r = await db.query(
    `SELECT 1
     FROM operations o
     JOIN shipping_instructions si ON si.id = o.shipping_instruction_id AND si.deleted_at IS NULL
     WHERE si.shipment_plan_id = $1
       AND o.deleted_at IS NULL
       AND o.tb IS NOT NULL
     LIMIT 1`,
    [planId]
  );
  return r.rows.length === 0;
}

/**
 * Reopen an Approved/Submitted plan to Draft (shared by POST new SI and PUT material edit).
 * @returns {Promise<boolean>} true when reopen was applied
 */
export async function reopenShipmentPlanForSiEdit(client, planId, portId) {
  const p = await client.query(
    `SELECT approval_status FROM shipment_plans
     WHERE id = $1 AND port_id = $2 AND deleted_at IS NULL`,
    [planId, portId]
  );
  if (p.rows.length === 0) return false;
  const status = p.rows[0].approval_status;
  if (status !== 'Approved' && status !== 'Submitted') return false;

  await client.query(
    `UPDATE shipment_plans SET
       approval_status = 'Draft',
       approved_at = NULL,
       approved_by_user_id = NULL,
       submitted_at = NULL,
       rejection_reason = NULL,
       rejected_at = NULL,
       updated_at = NOW()
     WHERE id = $1 AND port_id = $2 AND deleted_at IS NULL`,
    [planId, portId]
  );
  await client.query(
    `UPDATE shipping_instructions
     SET status = 'Draft', updated_at = NOW()
     WHERE shipment_plan_id = $1 AND deleted_at IS NULL`,
    [planId]
  );
  return true;
}

/**
 * @param {object} beforeRow - DB row before update
 * @param {Array<object>} beforeBd - existing breakdown from loadBreakdown
 * @param {object} next - computed next scalar values
 * @param {Array<object>|undefined} nextBreakdownPayload - request breakdown when provided
 * @returns {boolean}
 */
export function hasSiUpdateMaterialChanges(beforeRow, beforeBd, next, nextBreakdownPayload) {
  const scalarFields = [
    ['trade_term_id', beforeRow.trade_term_id, next.tradeTermId],
    ['loading_port_id', beforeRow.loading_port_id, next.loadingPortId],
    ['surveyor_id', beforeRow.surveyor_id, next.surveyorId],
    ['preferred_jetty_id', beforeRow.preferred_jetty_id, next.preferredJettyId],
    ['destination_text', beforeRow.destination_text, next.destinationText],
    ['freight_terms', beforeRow.freight_terms, next.freightTerms],
    ['bill_of_lading_clause', beforeRow.bill_of_lading_clause, next.billOfLadingClause],
    ['consignee_text', beforeRow.consignee_text, next.consigneeText],
    ['notify_party_text', beforeRow.notify_party_text, next.notifyPartyText],
    ['bl_split_text', beforeRow.bl_split_text, next.blSplitText],
    ['bl_indicated', beforeRow.bl_indicated, next.blIndicated],
  ];

  for (const [, beforeVal, afterVal] of scalarFields) {
    const b = beforeVal == null || beforeVal === '' ? null : beforeVal;
    const a = afterVal == null || afterVal === '' ? null : afterVal;
    if (String(b ?? '') !== String(a ?? '')) return true;
  }

  if (nextBreakdownPayload !== undefined) {
    if (breakdownSignature(beforeBd) !== breakdownSignature(nextBreakdownPayload)) return true;
  }

  return false;
}
