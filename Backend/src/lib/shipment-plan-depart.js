/**
 * Shared departure transaction: mark all SIGNOFF_APPROVED operations on a plan SAILED
 * and persist cast-off / clearance evidence on the plan (when planId is set).
 *
 * @param {import('pg').PoolClient} client
 * @param {{
 *   planId: number,
 *   castOffAt: Date,
 *   clearanceDocumentUrl: string | null,
 *   vesselPhotoUrl: string | null,
 *   portId: number,
 * }} args
 * @returns {Promise<{ ok: true, toSailIds: number[], primaryOperationId: number | null } | { ok: false, status: number, error: string }>}
 */
export async function departShipmentPlanInTransaction(client, args) {
  const { planId, castOffAt, clearanceDocumentUrl, vesselPhotoUrl, portId } = args;
  if (!Number.isFinite(planId) || planId <= 0) {
    return { ok: false, status: 400, error: 'Invalid shipment plan id' };
  }

  const planRes = await client.query(
    `SELECT id FROM shipment_plans WHERE id = $1 AND port_id = $2 AND deleted_at IS NULL`,
    [planId, portId]
  );
  if (planRes.rows.length === 0) {
    return { ok: false, status: 404, error: 'Shipment plan not found' };
  }

  const sib = await client.query(
    `SELECT o.id, o.status
     FROM operations o
     JOIN shipping_instructions si ON si.id = o.shipping_instruction_id AND si.deleted_at IS NULL
     WHERE si.shipment_plan_id = $1 AND o.deleted_at IS NULL`,
    [planId]
  );
  const siblingRows = sib.rows;
  const notReady = siblingRows.filter(
    (r) => r.status !== 'SIGNOFF_APPROVED' && r.status !== 'SAILED'
  );
  if (notReady.length > 0) {
    return {
      ok: false,
      status: 400,
      error:
        'All operations on this shipment plan must be SIGNOFF_APPROVED before departure (multi-SI vessel call).',
    };
  }

  const toSailIds = siblingRows.filter((r) => r.status === 'SIGNOFF_APPROVED').map((r) => Number(r.id));
  if (toSailIds.length === 0) {
    const anyOp = siblingRows[0];
    return {
      ok: true,
      toSailIds: [],
      primaryOperationId: anyOp ? Number(anyOp.id) : null,
    };
  }

  await client.query(
    `UPDATE operations SET
       status = 'SAILED',
       cast_off_at = $1,
       actual_completion_time = COALESCE(actual_completion_time, $1),
       clearance_document_url = $2,
       vessel_photo_url = $3,
       sailed_at = NOW(),
       updated_at = NOW()
     WHERE id = ANY($4::bigint[]) AND deleted_at IS NULL AND status = 'SIGNOFF_APPROVED'`,
    [castOffAt, clearanceDocumentUrl, vesselPhotoUrl, toSailIds]
  );

  await client.query(
    `UPDATE shipment_plans SET
       cast_off_at = $1,
       actual_completion_time = COALESCE(actual_completion_time, $1),
       clearance_document_url = $2,
       vessel_photo_url = $3,
       sailed_at = COALESCE(sailed_at, NOW()),
       updated_at = NOW()
     WHERE id = $4 AND deleted_at IS NULL`,
    [castOffAt, clearanceDocumentUrl, vesselPhotoUrl, planId]
  );

  return { ok: true, toSailIds, primaryOperationId: toSailIds[0] ?? null };
}
