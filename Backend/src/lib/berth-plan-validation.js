import { validateBerthPlanJettyAssignment } from './berth-plan-interval.js';

/**
 * Load schedule-shaped rows on a jetty for berth-plan conflict checks.
 * @param {import('pg').PoolClient} client
 * @param {number} portId
 * @param {number} jettyId
 * @param {{ excludeShipmentPlanId?: number | null, excludeOperationId?: number | null }} [opts]
 */
export async function loadBerthPlanRowsOnJetty(client, portId, jettyId, opts = {}) {
  const { excludeShipmentPlanId = null, excludeOperationId = null } = opts;
  const res = await client.query(
    `SELECT DISTINCT ON (sp.id)
        sp.id AS shipment_plan_id,
        o.id AS operation_id,
        sp.vessel_name,
        COALESCE(sp.tb, o.tb, sp.docking_start_time, o.docking_start_time) AS tb_datetime,
        COALESCE(sp.etb, o.etb) AS etb_datetime,
        COALESCE(sp.estimated_completion_time, o.estimated_completion_time) AS estimated_completion_datetime,
        COALESCE(sp.actual_completion_time, o.actual_completion_time) AS actual_completion_datetime,
        COALESCE(sp.cast_off_at, o.cast_off_at) AS cast_off_datetime,
        COALESCE(o.status, 'PLANNED') AS source_status,
        regexp_replace(j.name, '^Jetty\\s+', '', 'i') AS jetty_display
     FROM shipment_plans sp
     JOIN jetties j ON j.id = sp.jetty_id AND j.deleted_at IS NULL
     LEFT JOIN shipping_instructions si ON si.shipment_plan_id = sp.id AND si.deleted_at IS NULL
     LEFT JOIN operations o ON o.shipping_instruction_id = si.id
       AND o.deleted_at IS NULL
       AND o.status <> 'SAILED'
     WHERE sp.port_id = $1
       AND sp.deleted_at IS NULL
       AND sp.jetty_id = $2
       AND ($3::int IS NULL OR sp.id <> $3)
       AND ($4::int IS NULL OR o.id IS NULL OR o.id <> $4)
     ORDER BY sp.id, o.id DESC NULLS LAST`,
    [portId, jettyId, excludeShipmentPlanId, excludeOperationId]
  );

  return res.rows.map((r) => ({
    shipmentPlanId: r.shipment_plan_id,
    operationId: r.operation_id,
    vesselId: r.operation_id != null ? `op-${r.operation_id}` : `plan-${r.shipment_plan_id}`,
    vesselName: r.vessel_name,
    tbDateTime: r.tb_datetime,
    etbDateTime: r.etb_datetime,
    estimatedCompletionDateTime: r.estimated_completion_datetime,
    actualCompletionDateTime: r.actual_completion_datetime,
    castOffDateTime: r.cast_off_datetime,
    status: r.source_status,
    jetty: r.jetty_display,
  }));
}

/**
 * @param {import('pg').PoolClient} client
 * @param {object} params
 */
export async function assertBerthPlanJettyAllowed(client, params) {
  const {
    portId,
    jettyId,
    jettyShortId = null,
    jettyCapacity = null,
    candidate,
    excludeShipmentPlanId = null,
    excludeOperationId = null,
  } = params;

  if (!jettyId) return { ok: true };

  let shortId = jettyShortId;
  let capacity = jettyCapacity;
  if (shortId == null || capacity == null) {
    const jr = await client.query(
      `SELECT name, capacity FROM jetties WHERE id = $1 AND deleted_at IS NULL`,
      [jettyId]
    );
    if (shortId == null) {
      shortId = String(jr.rows[0]?.name || '')
        .replace(/^Jetty\s+/i, '')
        .trim();
    }
    if (capacity == null) {
      capacity = jr.rows[0]?.capacity != null ? Number(jr.rows[0].capacity) : 1;
    }
  }

  const scheduleRows = await loadBerthPlanRowsOnJetty(client, portId, jettyId, {
    excludeShipmentPlanId,
    excludeOperationId,
  });

  return validateBerthPlanJettyAssignment({
    candidate,
    scheduleRows,
    jettyShortId: shortId,
    jettyCapacity: capacity,
    excludeVesselId: candidate?.vesselId ?? null,
    excludeShipmentPlanId,
  });
}
