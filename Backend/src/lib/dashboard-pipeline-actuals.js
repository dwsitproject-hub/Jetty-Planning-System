/**
 * Dashboard V2 — Vessel Pipeline Actuals (per-stage event counts by actual timestamps).
 */
import {
  appendOpPlanFilters,
  appendPlanFilters,
} from './dashboard-v2-filters.js';

async function countShipmentRequestInRange(client, portId, wsIso, weIso, filters) {
  const params = [portId, wsIso, weIso];
  const { filterSql } = appendPlanFilters('', params, 4, filters);
  const r = await client.query(
    `SELECT COUNT(*)::int AS c
     FROM shipment_plans sp
     WHERE sp.port_id = $1
       AND sp.deleted_at IS NULL
       AND sp.approval_status <> 'Rejected'
       AND (
         (sp.submitted_at IS NOT NULL
           AND sp.submitted_at >= $2::timestamptz
           AND sp.submitted_at < $3::timestamptz)
         OR (sp.submitted_at IS NULL
           AND sp.approval_status = 'Draft'
           AND sp.created_at >= $2::timestamptz
           AND sp.created_at < $3::timestamptz)
       )
       ${filterSql}`,
    params
  );
  return Number(r.rows[0]?.c) || 0;
}

async function countIncomingInRange(client, portId, wsIso, weIso, filters) {
  const params = [portId, wsIso, weIso];
  const { filterSql } = appendPlanFilters('', params, 4, filters);
  const r = await client.query(
    `SELECT COUNT(*)::int AS c
     FROM shipment_plans sp
     WHERE sp.port_id = $1
       AND sp.deleted_at IS NULL
       AND sp.approval_status <> 'Rejected'
       AND sp.approved_at IS NOT NULL
       AND sp.approved_at >= $2::timestamptz
       AND sp.approved_at < $3::timestamptz
       ${filterSql}`,
    params
  );
  return Number(r.rows[0]?.c) || 0;
}

async function countPlannedBerthingInRange(client, portId, wsIso, weIso, filters) {
  const params = [portId, wsIso, weIso];
  const { filterSql } = appendPlanFilters('', params, 4, filters);
  const r = await client.query(
    `SELECT COUNT(*)::int AS c
     FROM shipment_plans sp
     WHERE sp.port_id = $1
       AND sp.deleted_at IS NULL
       AND sp.approval_status <> 'Rejected'
       AND sp.jetty_id IS NOT NULL
       AND sp.etb IS NOT NULL
       AND sp.etb >= $2::timestamptz
       AND sp.etb < $3::timestamptz
       ${filterSql}`,
    params
  );
  return Number(r.rows[0]?.c) || 0;
}

async function countAtBerthInRange(client, portId, wsIso, weIso, filters) {
  const params = [portId, wsIso, weIso];
  const { filterSql } = appendOpPlanFilters('', params, 4, filters);
  const r = await client.query(
    `SELECT COUNT(DISTINCT si.shipment_plan_id)::int AS c
     FROM operations o
     JOIN shipping_instructions si ON si.id = o.shipping_instruction_id AND si.deleted_at IS NULL
     LEFT JOIN shipment_plans sp ON sp.id = si.shipment_plan_id AND sp.deleted_at IS NULL
     LEFT JOIN jetties j ON j.id = COALESCE(o.jetty_id, sp.jetty_id) AND j.deleted_at IS NULL
     LEFT JOIN ports p ON p.id = COALESCE(o.port_id, j.port_id) AND p.deleted_at IS NULL
     WHERE o.deleted_at IS NULL
       AND COALESCE(o.port_id, p.id) = $1
       AND si.shipment_plan_id IS NOT NULL
       AND COALESCE(sp.approval_status, 'Approved') <> 'Rejected'
       AND COALESCE(o.tb, sp.tb, o.docking_start_time, sp.docking_start_time) IS NOT NULL
       AND COALESCE(o.tb, sp.tb, o.docking_start_time, sp.docking_start_time) >= $2::timestamptz
       AND COALESCE(o.tb, sp.tb, o.docking_start_time, sp.docking_start_time) < $3::timestamptz
       ${filterSql}`,
    params
  );
  return Number(r.rows[0]?.c) || 0;
}

async function countReadyToSailInRange(client, portId, wsIso, weIso, filters) {
  const params = [portId, wsIso, weIso];
  const { filterSql } = appendOpPlanFilters('', params, 4, filters);
  const r = await client.query(
    `SELECT COUNT(DISTINCT si.shipment_plan_id)::int AS c
     FROM operations o
     JOIN shipping_instructions si ON si.id = o.shipping_instruction_id AND si.deleted_at IS NULL
     LEFT JOIN shipment_plans sp ON sp.id = si.shipment_plan_id AND sp.deleted_at IS NULL
     LEFT JOIN jetties j ON j.id = COALESCE(o.jetty_id, sp.jetty_id) AND j.deleted_at IS NULL
     LEFT JOIN ports p ON p.id = COALESCE(o.port_id, j.port_id) AND p.deleted_at IS NULL
     WHERE o.deleted_at IS NULL
       AND COALESCE(o.port_id, p.id) = $1
       AND si.shipment_plan_id IS NOT NULL
       AND COALESCE(sp.approval_status, 'Approved') <> 'Rejected'
       AND COALESCE(o.operations_completed_at, sp.operations_completed_at) IS NOT NULL
       AND COALESCE(o.operations_completed_at, sp.operations_completed_at) >= $2::timestamptz
       AND COALESCE(o.operations_completed_at, sp.operations_completed_at) < $3::timestamptz
       ${filterSql}`,
    params
  );
  return Number(r.rows[0]?.c) || 0;
}

async function countSailedInRange(client, portId, wsIso, weIso, filters) {
  const params = [portId, wsIso, weIso];
  const { filterSql } = appendOpPlanFilters('', params, 4, filters);
  const r = await client.query(
    `SELECT COUNT(DISTINCT si.shipment_plan_id)::int AS c
     FROM operations o
     JOIN shipping_instructions si ON si.id = o.shipping_instruction_id AND si.deleted_at IS NULL
     LEFT JOIN shipment_plans sp ON sp.id = si.shipment_plan_id AND sp.deleted_at IS NULL
     LEFT JOIN jetties j ON j.id = COALESCE(o.jetty_id, sp.jetty_id) AND j.deleted_at IS NULL
     LEFT JOIN ports p ON p.id = COALESCE(o.port_id, j.port_id) AND p.deleted_at IS NULL
     WHERE o.deleted_at IS NULL
       AND COALESCE(o.port_id, p.id) = $1
       AND o.status = 'SAILED'
       AND si.shipment_plan_id IS NOT NULL
       AND COALESCE(sp.approval_status, 'Approved') <> 'Rejected'
       AND COALESCE(o.cast_off_at, o.actual_completion_time, sp.sailed_at, sp.cast_off_at) IS NOT NULL
       AND COALESCE(o.cast_off_at, o.actual_completion_time, sp.sailed_at, sp.cast_off_at) >= $2::timestamptz
       AND COALESCE(o.cast_off_at, o.actual_completion_time, sp.sailed_at, sp.cast_off_at) < $3::timestamptz
       ${filterSql}`,
    params
  );
  return Number(r.rows[0]?.c) || 0;
}

/**
 * @param {import('pg').PoolClient} client
 * @param {number} portId
 * @param {string} wsIso range start (inclusive)
 * @param {string} weIso range end (exclusive)
 * @param {{ purposeCodes: string[]|null, commodityIds: number[]|null }} filters
 */
export async function computePipelineActuals(client, portId, wsIso, weIso, filters) {
  const [
    shipmentRequest,
    incoming,
    plannedBerthing,
    atBerth,
    readyToSail,
    sailed,
  ] = await Promise.all([
    countShipmentRequestInRange(client, portId, wsIso, weIso, filters),
    countIncomingInRange(client, portId, wsIso, weIso, filters),
    countPlannedBerthingInRange(client, portId, wsIso, weIso, filters),
    countAtBerthInRange(client, portId, wsIso, weIso, filters),
    countReadyToSailInRange(client, portId, wsIso, weIso, filters),
    countSailedInRange(client, portId, wsIso, weIso, filters),
  ]);
  return {
    shipmentRequest,
    incoming,
    plannedBerthing,
    atBerth,
    readyToSail,
    sailed,
  };
}
