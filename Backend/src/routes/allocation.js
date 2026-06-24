/**
 * Allocation & Berthing overview (DB-backed).
 *
 * - Queue rows come from:
 *   1) Operations that are not SAILED (already allocated / at-berth)
 *   2) Shipping instructions with no operation yet (incoming vessels; any plan approval status)
 *   3) Shipment plans with no shipping instruction yet (late-SI scheduling; Draft plans included)
 *
 * Base path: /api/v1/allocation
 */
import express from 'express';
import { pool } from '../db.js';
import { assignJettyOperationCode } from '../lib/jetty-operation-code.js';
import { writeActivityLog } from '../lib/activity-log.js';
import { requirePageView, userHasPageEdit } from '../middleware/permissions.js';
import { JETTY_OUT_OF_SERVICE } from '../lib/jetty-blocking.js';
import { loadOperationScheduleTimezone, parseScheduleInstantToIso } from '../lib/schedule-instant.js';
import { enrichRowsWithCargoDisplay } from '../lib/siBreakdownDisplay.js';

const router = express.Router();
const SCHEDULE_SAILED_LOOKBACK_DAYS = 90;

/** null = unknown; set false if DB has no operations.updated_by (migration 044 not applied). */
let allocationOpsHasUpdatedByColumn = null;
let allocationPlanHasUpdatedByColumn = null;

const UPDATE_SHIPMENT_PLAN_ARRIVAL_WITH_UPDATED_BY = `UPDATE shipment_plans SET
         eta = $1,
         ta = $2,
         etb = $3,
         pob = $4,
         tb = $5,
         docking_start_time = COALESCE($5, docking_start_time),
         sob = $6,
         nor_tendered_at = $7,
         nor_accepted_at = $8,
         demurrage_liability_from_at = CASE
           WHEN $9::boolean THEN $10::timestamptz
           ELSE demurrage_liability_from_at
         END,
         remark = COALESCE($11, remark),
         priority = COALESCE($12, priority),
         no_pkk = COALESCE($13, no_pkk),
         jetty_id = COALESCE($14, jetty_id),
         estimated_completion_time = $15,
         actual_completion_time = $16,
         updated_at = NOW(),
         updated_by = $17
       WHERE id = $18`;

const UPDATE_SHIPMENT_PLAN_ARRIVAL_NO_UPDATED_BY = `UPDATE shipment_plans SET
         eta = $1,
         ta = $2,
         etb = $3,
         pob = $4,
         tb = $5,
         docking_start_time = COALESCE($5, docking_start_time),
         sob = $6,
         nor_tendered_at = $7,
         nor_accepted_at = $8,
         demurrage_liability_from_at = CASE
           WHEN $9::boolean THEN $10::timestamptz
           ELSE demurrage_liability_from_at
         END,
         remark = COALESCE($11, remark),
         priority = COALESCE($12, priority),
         no_pkk = COALESCE($13, no_pkk),
         jetty_id = COALESCE($14, jetty_id),
         estimated_completion_time = $15,
         actual_completion_time = $16,
         updated_at = NOW()
       WHERE id = $17`;

async function runArrivalShipmentPlanUpdate(client, paramsWithUpdatedBy, paramsWithoutUpdatedBy) {
  if (allocationPlanHasUpdatedByColumn === false) {
    return client.query(UPDATE_SHIPMENT_PLAN_ARRIVAL_NO_UPDATED_BY, paramsWithoutUpdatedBy);
  }
  await client.query('SAVEPOINT allocation_arrival_plan_upd');
  try {
    const r = await client.query(UPDATE_SHIPMENT_PLAN_ARRIVAL_WITH_UPDATED_BY, paramsWithUpdatedBy);
    allocationPlanHasUpdatedByColumn = true;
    await client.query('RELEASE SAVEPOINT allocation_arrival_plan_upd');
    return r;
  } catch (e) {
    const msg = String(e?.message || '');
    if (e?.code === '42703' && msg.includes('updated_by')) {
      await client.query('ROLLBACK TO SAVEPOINT allocation_arrival_plan_upd');
      allocationPlanHasUpdatedByColumn = false;
      const r = await client.query(UPDATE_SHIPMENT_PLAN_ARRIVAL_NO_UPDATED_BY, paramsWithoutUpdatedBy);
      await client.query('RELEASE SAVEPOINT allocation_arrival_plan_upd');
      return r;
    }
    await client.query('ROLLBACK TO SAVEPOINT allocation_arrival_plan_upd');
    throw e;
  }
}

const UPDATE_ARRIVAL_WITH_UPDATED_BY = `UPDATE operations SET
         eta = $1,
         ta = $2,
         etb = $3,
         pob = $4,
         tb = $5,
         docking_start_time = COALESCE($5, docking_start_time),
         status = CASE
           WHEN $5 IS NOT NULL AND COALESCE(status, '') IN ('PENDING', 'ALLOCATED', '') THEN 'DOCKED'
           ELSE status
         END,
         sob = $6,
         nor_tendered_at = $7,
         nor_accepted_at = $8,
         demurrage_liability_from_at = CASE
           WHEN $9::boolean THEN $10::timestamptz
           ELSE demurrage_liability_from_at
         END,
         remark = COALESCE($11, remark),
         priority = COALESCE($12, priority),
         no_pkk = COALESCE($13, no_pkk),
         jetty_id = COALESCE($14, jetty_id),
         estimated_completion_time = $15,
         actual_completion_time = $16,
         updated_at = NOW(),
         updated_by = $17
       WHERE id = $18 AND deleted_at IS NULL`;

const UPDATE_ARRIVAL_NO_UPDATED_BY = `UPDATE operations SET
         eta = $1,
         ta = $2,
         etb = $3,
         pob = $4,
         tb = $5,
         docking_start_time = COALESCE($5, docking_start_time),
         status = CASE
           WHEN $5 IS NOT NULL AND COALESCE(status, '') IN ('PENDING', 'ALLOCATED', '') THEN 'DOCKED'
           ELSE status
         END,
         sob = $6,
         nor_tendered_at = $7,
         nor_accepted_at = $8,
         demurrage_liability_from_at = CASE
           WHEN $9::boolean THEN $10::timestamptz
           ELSE demurrage_liability_from_at
         END,
         remark = COALESCE($11, remark),
         priority = COALESCE($12, priority),
         no_pkk = COALESCE($13, no_pkk),
         jetty_id = COALESCE($14, jetty_id),
         estimated_completion_time = $15,
         actual_completion_time = $16,
         updated_at = NOW()
       WHERE id = $17 AND deleted_at IS NULL`;

async function runArrivalOperationUpdate(client, paramsWithUpdatedBy, paramsWithoutUpdatedBy) {
  if (allocationOpsHasUpdatedByColumn === false) {
    return client.query(UPDATE_ARRIVAL_NO_UPDATED_BY, paramsWithoutUpdatedBy);
  }
  // SAVEPOINT: first UPDATE may fail (e.g. missing updated_by); without this, the tx stays aborted
  // and the fallback UPDATE hits 25P02 "current transaction is aborted".
  await client.query('SAVEPOINT allocation_arrival_op_upd');
  try {
    const r = await client.query(UPDATE_ARRIVAL_WITH_UPDATED_BY, paramsWithUpdatedBy);
    allocationOpsHasUpdatedByColumn = true;
    await client.query('RELEASE SAVEPOINT allocation_arrival_op_upd');
    return r;
  } catch (e) {
    const msg = String(e?.message || '');
    if (e?.code === '42703' && msg.includes('updated_by')) {
      await client.query('ROLLBACK TO SAVEPOINT allocation_arrival_op_upd');
      allocationOpsHasUpdatedByColumn = false;
      const r = await client.query(UPDATE_ARRIVAL_NO_UPDATED_BY, paramsWithoutUpdatedBy);
      await client.query('RELEASE SAVEPOINT allocation_arrival_op_upd');
      return r;
    }
    await client.query('ROLLBACK TO SAVEPOINT allocation_arrival_op_upd');
    throw e;
  }
}

const BERTHING_ARRIVAL_BODY_KEYS = [
  'taDateTime',
  'tbDateTime',
  'pobDateTime',
  'sobDateTime',
  'estimatedCompletionDateTime',
  'actualCompletionDateTime',
];

function bodyHasBerthingArrivalFields(b) {
  return BERTHING_ARRIVAL_BODY_KEYS.some(
    (k) => Object.prototype.hasOwnProperty.call(b, k) && b[k] != null && String(b[k]).trim() !== ''
  );
}

const PLAN_BERTHING_GATE_MSG =
  'Shipment plan must be approved and have at least one shipping instruction before berthing.';

async function loadBerthingAllowedByPlanId(portId) {
  const r = await pool.query(
    `SELECT sp.id AS plan_id,
            COUNT(si.id)::int AS si_count,
            sp.approval_status
     FROM shipment_plans sp
     LEFT JOIN shipping_instructions si
       ON si.shipment_plan_id = sp.id AND si.deleted_at IS NULL
     WHERE sp.port_id = $1 AND sp.deleted_at IS NULL
     GROUP BY sp.id, sp.approval_status`,
    [portId]
  );
  const map = new Map();
  for (const row of r.rows) {
    const pid = Number(row.plan_id);
    const c = Number(row.si_count) || 0;
    map.set(pid, row.approval_status === 'Approved' && c > 0);
  }
  return map;
}

function attachBerthingEligibility(row, berthingByPlan) {
  const pid = row.shipmentPlanId != null ? Number(row.shipmentPlanId) : null;
  let berthingAllowed = false;
  if (pid != null && Number.isFinite(pid)) {
    berthingAllowed = berthingByPlan.get(pid) === true;
  }
  return {
    ...row,
    siStatus: row.siStatus ?? row.status ?? null,
    berthingAllowed,
    lateSiPending: pid != null && !berthingAllowed,
  };
}

/**
 * Insert a new operation for an SI on an Approved shipment plan.
 * @returns {{ id: number, shipping_instruction_id: number, jetty_id: unknown } | null}
 */
async function insertOperationForApprovedPlanSi(client, shippingInstructionId, selectedPortId, userId) {
  const si = await client.query(
    `SELECT si.id, sp.approval_status, spp.code AS purpose
     FROM shipping_instructions si
     JOIN shipment_plans sp ON sp.id = si.shipment_plan_id AND sp.deleted_at IS NULL
     LEFT JOIN si_purposes spp ON spp.id = sp.purpose_id AND spp.deleted_at IS NULL
     WHERE si.id = $1 AND si.deleted_at IS NULL AND sp.approval_status = 'Approved'`,
    [shippingInstructionId]
  );
  if (si.rows.length === 0) return null;
  let ins;
  await client.query('SAVEPOINT allocation_arrival_plan_si_ins');
  try {
    ins = await client.query(
      `INSERT INTO operations (shipping_instruction_id, jetty_id, purpose, status, port_id, updated_by)
       VALUES ($1, NULL, $2, 'PENDING', $3, $4)
       RETURNING id, shipping_instruction_id, jetty_id`,
      [shippingInstructionId, si.rows[0].purpose, selectedPortId, userId ?? null]
    );
    allocationOpsHasUpdatedByColumn = true;
    await client.query('RELEASE SAVEPOINT allocation_arrival_plan_si_ins');
  } catch (e) {
    const msg = String(e?.message || '');
    if (e?.code === '42703' && msg.includes('updated_by')) {
      await client.query('ROLLBACK TO SAVEPOINT allocation_arrival_plan_si_ins');
      allocationOpsHasUpdatedByColumn = false;
      ins = await client.query(
        `INSERT INTO operations (shipping_instruction_id, jetty_id, purpose, status, port_id)
         VALUES ($1, NULL, $2, 'PENDING', $3)
         RETURNING id, shipping_instruction_id, jetty_id`,
        [shippingInstructionId, si.rows[0].purpose, selectedPortId]
      );
      await client.query('RELEASE SAVEPOINT allocation_arrival_plan_si_ins');
    } else {
      await client.query('ROLLBACK TO SAVEPOINT allocation_arrival_plan_si_ins');
      throw e;
    }
  }
  return ins.rows[0] ?? null;
}

async function userHasAllocationPlanEdit(userId) {
  if (userId == null) return false;
  return userHasPageEdit(userId, 'allocation-plan');
}

const SI_COMMODITY = `COALESCE(
  (SELECT sc.name FROM public.shipping_instruction_breakdown b
   JOIN public.si_commodities sc ON sc.id = b.commodity_id AND sc.deleted_at IS NULL
   WHERE b.shipping_instruction_id = si.id AND b.deleted_at IS NULL
   ORDER BY b.line_order, b.id LIMIT 1),
  si.commodity
)`;

function jettyShortName(name) {
  if (!name) return null;
  return String(name).replace(/^Jetty\s+/i, '').trim();
}

/** Normalise pg `timestamptz` / ISO strings for JSON (always ISO string or null). */
function pgTimestampToIsoString(val) {
  if (val == null || val === '') return null;
  if (val instanceof Date) {
    const t = val.getTime();
    return Number.isNaN(t) ? null : val.toISOString();
  }
  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** After COMMIT: read operations.updated_at and editor display (uses pool to avoid ROLLBACK after COMMIT on the tx client). */
async function selectOperationRecordStamp(operationId) {
  try {
    const r = await pool.query(
      `SELECT o.updated_at,
              NULLIF(TRIM(COALESCE(u.display_name, u.username, '')), '') AS record_last_updated_by_display_name
       FROM operations o
       LEFT JOIN users u ON u.id = o.updated_by AND u.deleted_at IS NULL
       WHERE o.id = $1 AND o.deleted_at IS NULL`,
      [operationId]
    );
    const row = r.rows[0];
    return {
      recordLastUpdatedAt: pgTimestampToIsoString(row?.updated_at),
      recordLastUpdatedByDisplayName: row?.record_last_updated_by_display_name ?? null,
    };
  } catch (e) {
    const msg = String(e?.message || '');
    if (e?.code === '42703' && msg.includes('updated_by')) {
      const r = await pool.query(
        `SELECT o.updated_at FROM operations o WHERE o.id = $1 AND o.deleted_at IS NULL`,
        [operationId]
      );
      return {
        recordLastUpdatedAt: pgTimestampToIsoString(r.rows[0]?.updated_at),
        recordLastUpdatedByDisplayName: null,
      };
    }
    throw e;
  }
}

function formatListRow(r) {
  // Keep a shape similar to existing Allocation.jsx expectations.
  return {
    id: String(r.row_id),
    jettyOperationCode: r.jetty_operation_code ?? undefined,
    sequence: r.sequence != null ? Number(r.sequence) : null,
    vesselId: r.vessel_id,
    vesselName: r.vessel_name,
    shippingInstruction: r.reference_number || (r.shipping_instruction_id ? `SI-${r.shipping_instruction_id}` : '—'),
    priority: r.priority || null,
    purpose: r.purpose || null,
    commodity: r.commodity_display || r.commodity || null,
    commodityDisplay: r.commodity_display || r.commodity || null,
    totalQtyDisplay: r.total_qty_display || null,
    cargoBreakdownSummary: Array.isArray(r.cargo_breakdown_summary) ? r.cargo_breakdown_summary : [],
    norDocuments: r.nor_documents ?? [],
    noPkk: r.no_pkk || null,
    shipper: r.shipper_name || null,
    tradeTerm: r.trade_term_code ?? null,
    loadingPort: r.loading_port_name ?? null,
    agent: r.agent_name || null,
    surveyor: r.surveyor_name || null,
    remark: r.remark ?? null,
    remarks: r.remark ?? null,
    eta: r.eta_display || null,
    etb: r.etb_display || null,
    jetty: r.jetty_display || null,
    etaDateTime: r.eta_datetime || null,
    taDateTime: r.ta_datetime || null,
    etbDateTime: r.etb_datetime || null,
    pobDateTime: r.pob_datetime || null,
    sobDateTime: r.sob_datetime || null,
    norTenderedDateTime: r.nor_tendered_datetime || null,
    norAcceptedDateTime: r.nor_accepted_datetime || null,
    demurrageLiabilityFromDateTime: r.demurrage_liability_from_datetime || null,
    plannedEtbDateTime: r.planned_etb_datetime || null,
    tbDateTime: r.tb_datetime || null,
    estimatedCompletionDateTime: r.estimated_completion_datetime || null,
    operationsCompletedDateTime: r.operations_completed_datetime || null,
    operationalStartDateTime: r.operational_start_datetime || null,
    actualCompletionDateTime: r.actual_completion_datetime || null,
    castOffDateTime: r.cast_off_datetime || null,
    status: r.source_status || null,
    shiftingOut: Boolean(r.shifting_out),
    shiftingOutAt: r.shifting_out_at || null,
    completionPercent: r.completion_percent != null ? Number(r.completion_percent) : 0,
    source: r.source_kind,
    operationId: r.operation_id != null ? Number(r.operation_id) : null,
    shippingInstructionId: r.shipping_instruction_id != null ? Number(r.shipping_instruction_id) : null,
    shipmentPlanId: r.shipment_plan_id != null ? Number(r.shipment_plan_id) : null,
    planReference: r.plan_reference ?? null,
    planPurposeLabel: r.plan_purpose_label ?? null,
    recordLastUpdatedAt: pgTimestampToIsoString(
      r.record_last_updated_at ?? r.recordLastUpdatedAt ?? null
    ),
    recordLastUpdatedByDisplayName:
      r.record_last_updated_by_display_name ?? r.recordLastUpdatedByDisplayName ?? null,
  };
}

/** Rank for choosing one occupant when several operations share the same shipment plan on one jetty. */
const OCCUPANT_STATUS_RANK = {
  SIGNOFF_APPROVED: 6,
  SIGNOFF_REQUESTED: 5,
  POST_OPS: 4,
  IN_PROGRESS: 3,
  DOCKED: 2,
  ALLOCATED: 1,
  PENDING: 0,
};

function occupantStatusRank(status) {
  const s = status == null ? '' : String(status);
  return OCCUPANT_STATUS_RANK[s] ?? 0;
}

/**
 * Slot occupancy is one physical berth per shipment plan. Test data (or edge cases) may have
 * multiple non-sailed operations tied to the same plan; without merging, the same vessel appears
 * in 2A-01 and 2A-02, etc.
 */
function dedupeBerthOccupantsByShipmentPlan(occList) {
  if (!Array.isArray(occList) || occList.length <= 1) return occList || [];
  const byPlan = new Map();
  const unlinked = [];
  for (const o of occList) {
    const pid = o.shipmentPlanId != null ? Number(o.shipmentPlanId) : null;
    if (pid == null || Number.isNaN(pid)) {
      unlinked.push(o);
      continue;
    }
    const cur = byPlan.get(pid);
    if (!cur) {
      byPlan.set(pid, o);
      continue;
    }
    const rNew = occupantStatusRank(o.status);
    const rCur = occupantStatusRank(cur.status);
    if (rNew > rCur) {
      byPlan.set(pid, o);
    } else if (rNew === rCur) {
      const oid = o.operationId != null ? Number(o.operationId) : 0;
      const cid = cur.operationId != null ? Number(cur.operationId) : 0;
      if (oid > cid) byPlan.set(pid, o);
    }
  }
  return [...byPlan.values(), ...unlinked];
}

function operationsOverviewSql(includeUpdatedByJoin, includeSailedForSchedule = false) {
  const bySelect = includeUpdatedByJoin
    ? `NULLIF(TRIM(COALESCE(u.display_name, u.username, '')), '') AS record_last_updated_by_display_name`
    : `NULL::text AS record_last_updated_by_display_name`;
  const joinUsers = includeUpdatedByJoin
    ? `LEFT JOIN users u ON u.id = o.updated_by AND u.deleted_at IS NULL`
    : '';
  const statusFilter = includeSailedForSchedule
    ? `AND (
         o.status <> 'SAILED'
         OR COALESCE(o.cast_off_at, o.actual_completion_time, o.updated_at) >= (NOW() - ($3::int * INTERVAL '1 day'))
       )`
    : `AND o.status <> 'SAILED'`;
  return `
    SELECT
        ('op-' || o.id)::text AS vessel_id,
        o.id AS operation_id,
        o.jetty_operation_code AS jetty_operation_code,
        o.shipping_instruction_id,
        o.purpose,
        o.status AS source_status,
        COALESCE(sp.shifting_out, o.shifting_out) AS shifting_out,
        COALESCE(sp.shifting_out_at, o.shifting_out_at) AS shifting_out_at,
        o.completion_percent AS completion_percent,
        COALESCE(sp.sequence, o.sequence) AS sequence,
        si.shipment_plan_id::bigint AS shipment_plan_id,
        sp.plan_reference AS plan_reference,
        spur.label AS plan_purpose_label,
        COALESCE(sp.priority, o.priority) AS priority,
        COALESCE(sp.remark, o.remark) AS remark,
        sp.vessel_name,
        si.reference_number,
        ${SI_COMMODITY} AS commodity,
        COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', d.id,
            'name', d.original_name,
            'url', ('/api/v1/operation-documents/' || d.id::text || '/download')
          ) ORDER BY d.created_at DESC, d.id DESC)
          FROM public.operation_documents d
          WHERE d.operation_id = o.id AND d.deleted_at IS NULL AND d.kind = 'NOR'
        ), '[]'::jsonb) AS nor_documents,
        COALESCE(sp.no_pkk, o.no_pkk) AS no_pkk,
        (SELECT STRING_AGG(DISTINCT sh2.name, ', ' ORDER BY sh2.name)
         FROM public.shipping_instruction_breakdown b2
         JOIN public.si_shippers sh2 ON sh2.id = b2.shipper_id AND sh2.deleted_at IS NULL
         WHERE b2.shipping_instruction_id = si.id AND b2.deleted_at IS NULL) AS shipper_name,
        ag.name AS agent_name,
        sv.name AS surveyor_name,
        tt.code AS trade_term_code,
        lp.name AS loading_port_name,
        COALESCE(sp.eta, o.eta, (si.eta_to::timestamptz), (si.eta_from::timestamptz)) AS eta_datetime,
        COALESCE(sp.ta, o.ta) AS ta_datetime,
        COALESCE(sp.etb, o.etb) AS planned_etb_datetime,
        COALESCE(sp.etb, sp.tb, sp.docking_start_time, o.etb, o.tb, o.docking_start_time) AS etb_datetime,
        COALESCE(sp.pob, o.pob) AS pob_datetime,
        COALESCE(sp.sob, o.sob) AS sob_datetime,
        COALESCE(sp.tb, o.tb, sp.docking_start_time, o.docking_start_time) AS tb_datetime,
        COALESCE(sp.estimated_completion_time, o.estimated_completion_time) AS estimated_completion_datetime,
        COALESCE(sp.operations_completed_at, o.operations_completed_at) AS operations_completed_datetime,
        (SELECT MIN(oa.start_at)
         FROM operation_operational_activities oa
         WHERE oa.operation_id = o.id
           AND oa.deleted_at IS NULL
           AND oa.entry_type = 'activity'
           AND oa.milestone_key IN ('opening_hatch', 'cargo_pre_conditioning', 'cargo_operations')
           AND oa.start_at IS NOT NULL
        ) AS operational_start_datetime,
        COALESCE(sp.actual_completion_time, o.actual_completion_time) AS actual_completion_datetime,
        COALESCE(sp.cast_off_at, o.cast_off_at) AS cast_off_datetime,
        COALESCE(sp.nor_tendered_at, o.nor_tendered_at) AS nor_tendered_datetime,
        COALESCE(sp.nor_accepted_at, o.nor_accepted_at) AS nor_accepted_datetime,
        COALESCE(sp.demurrage_liability_from_at, o.demurrage_liability_from_at) AS demurrage_liability_from_datetime,
        GREATEST(o.updated_at, sp.updated_at) AS record_last_updated_at,
        ${bySelect},
        (to_char(COALESCE(sp.eta, o.eta, (si.eta_to::timestamptz), (si.eta_from::timestamptz)) AT TIME ZONE 'UTC', 'DD/MM HH24:MI'))::text AS eta_display,
        CASE WHEN COALESCE(sp.etb, sp.docking_start_time, o.etb, o.docking_start_time) IS NULL THEN NULL
             ELSE (to_char(COALESCE(sp.etb, sp.docking_start_time, o.etb, o.docking_start_time) AT TIME ZONE 'UTC', 'DD/MM HH24:MI'))
        END AS etb_display,
        $1::text AS source_kind,
        (regexp_replace(j.name, '^Jetty\\s+', '', 'i'))::text AS jetty_display,
        o.id::text AS row_id
     FROM operations o
     JOIN shipping_instructions si ON si.id = o.shipping_instruction_id AND si.deleted_at IS NULL
     LEFT JOIN shipment_plans sp ON sp.id = si.shipment_plan_id AND sp.deleted_at IS NULL
     LEFT JOIN si_purposes spur ON spur.id = sp.purpose_id AND spur.deleted_at IS NULL
     ${joinUsers}
     LEFT JOIN si_agents ag ON ag.id = COALESCE(si.agent_id, sp.agent_id) AND ag.deleted_at IS NULL
     LEFT JOIN si_surveyors sv ON sv.id = si.surveyor_id AND sv.deleted_at IS NULL
     LEFT JOIN si_trade_terms tt ON tt.id = si.trade_term_id AND tt.deleted_at IS NULL
     LEFT JOIN si_loading_ports lp ON lp.id = si.loading_port_id AND lp.deleted_at IS NULL
     LEFT JOIN jetties j ON j.id = COALESCE(sp.jetty_id, o.jetty_id) AND j.deleted_at IS NULL
     LEFT JOIN ports p ON p.id = COALESCE(o.port_id, j.port_id) AND p.deleted_at IS NULL
     WHERE o.deleted_at IS NULL
       AND COALESCE(o.port_id, p.id) = $2
       ${statusFilter}
     ORDER BY COALESCE(COALESCE(sp.sequence, o.sequence)) ASC NULLS LAST,
              COALESCE(o.docking_start_time, sp.eta, o.eta, si.eta_from::timestamptz) ASC NULLS LAST, o.id ASC`;
}

async function buildAllocationOverviewPayload(selectedPortId) {
  const jettiesRes = await pool.query(
    `SELECT j.id, j.name, j.status, j.capacity, p.name AS port_name
     FROM jetties j
     JOIN ports p ON p.id = j.port_id AND p.deleted_at IS NULL
     WHERE j.deleted_at IS NULL
       AND p.id = $1
     ORDER BY j.order_no ASC, j.name ASC`
    ,
    [selectedPortId]
  );

  let activeOpsRes;
  let scheduleOpsRes;
  try {
    activeOpsRes = await pool.query(operationsOverviewSql(true, false), ['operation', selectedPortId]);
    scheduleOpsRes = await pool.query(operationsOverviewSql(true, true), [
      'operation',
      selectedPortId,
      SCHEDULE_SAILED_LOOKBACK_DAYS,
    ]);
  } catch (e) {
    const msg = String(e?.message || '');
    const missingUpdatedBy =
      e?.code === '42703' || (msg.includes('updated_by') && msg.includes('does not exist'));
    if (missingUpdatedBy) {
      activeOpsRes = await pool.query(operationsOverviewSql(false, false), ['operation', selectedPortId]);
      scheduleOpsRes = await pool.query(operationsOverviewSql(false, true), [
        'operation',
        selectedPortId,
        SCHEDULE_SAILED_LOOKBACK_DAYS,
      ]);
    } else {
      throw e;
    }
  }

  const incomingSiRes = await pool.query(
    `SELECT
        ('si-' || si.id)::text AS vessel_id,
        NULL::bigint AS operation_id,
        si.id AS shipping_instruction_id,
        spur.code AS purpose,
        si.status AS source_status,
        COALESCE(sp.shifting_out, false) AS shifting_out,
        sp.shifting_out_at AS shifting_out_at,
        sp.sequence AS sequence,
        si.shipment_plan_id::bigint AS shipment_plan_id,
        sp.plan_reference AS plan_reference,
        spur.label AS plan_purpose_label,
        sp.priority AS priority,
        sp.remark AS remark,
        sp.vessel_name,
        si.reference_number,
        ${SI_COMMODITY} AS commodity,
        sp.no_pkk AS no_pkk,
        (SELECT STRING_AGG(DISTINCT sh2.name, ', ' ORDER BY sh2.name)
         FROM public.shipping_instruction_breakdown b2
         JOIN public.si_shippers sh2 ON sh2.id = b2.shipper_id AND sh2.deleted_at IS NULL
         WHERE b2.shipping_instruction_id = si.id AND b2.deleted_at IS NULL) AS shipper_name,
        ag.name AS agent_name,
        sv.name AS surveyor_name,
        tt.code AS trade_term_code,
        lp.name AS loading_port_name,
        COALESCE(sp.eta, (si.eta_to::timestamptz), (si.eta_from::timestamptz)) AS eta_datetime,
        sp.ta AS ta_datetime,
        sp.etb AS planned_etb_datetime,
        COALESCE(sp.etb, sp.tb, sp.docking_start_time) AS etb_datetime,
        sp.pob AS pob_datetime,
        sp.sob AS sob_datetime,
        COALESCE(sp.tb, sp.docking_start_time) AS tb_datetime,
        sp.estimated_completion_time AS estimated_completion_datetime,
        sp.operations_completed_at AS operations_completed_datetime,
        sp.actual_completion_time AS actual_completion_datetime,
        sp.cast_off_at AS cast_off_datetime,
        sp.nor_tendered_at AS nor_tendered_datetime,
        sp.nor_accepted_at AS nor_accepted_datetime,
        sp.demurrage_liability_from_at AS demurrage_liability_from_datetime,
        GREATEST(si.updated_at, sp.updated_at) AS record_last_updated_at,
        NULL::text AS record_last_updated_by_display_name,
        (to_char(COALESCE(sp.eta, (si.eta_to::timestamptz), (si.eta_from::timestamptz)) AT TIME ZONE 'UTC', 'DD/MM HH24:MI'))::text AS eta_display,
        CASE WHEN COALESCE(sp.etb, sp.docking_start_time) IS NULL THEN NULL
             ELSE (to_char(COALESCE(sp.etb, sp.docking_start_time) AT TIME ZONE 'UTC', 'DD/MM HH24:MI'))
        END AS etb_display,
        $1::text AS source_kind,
        (regexp_replace(j.name, '^Jetty\\s+', '', 'i'))::text AS jetty_display,
        si.id::text AS row_id
     FROM shipping_instructions si
     LEFT      JOIN shipment_plans sp ON sp.id = si.shipment_plan_id AND sp.deleted_at IS NULL
     LEFT JOIN si_purposes spur ON spur.id = sp.purpose_id AND spur.deleted_at IS NULL
     LEFT JOIN si_agents ag ON ag.id = COALESCE(si.agent_id, sp.agent_id) AND ag.deleted_at IS NULL
     LEFT JOIN si_surveyors sv ON sv.id = si.surveyor_id AND sv.deleted_at IS NULL
     LEFT JOIN si_trade_terms tt ON tt.id = si.trade_term_id AND tt.deleted_at IS NULL
     LEFT JOIN si_loading_ports lp ON lp.id = si.loading_port_id AND lp.deleted_at IS NULL
     LEFT JOIN jetties j ON j.id = sp.jetty_id AND j.deleted_at IS NULL
     LEFT JOIN ports p ON p.id = COALESCE(sp.port_id, j.port_id) AND p.deleted_at IS NULL
     WHERE si.deleted_at IS NULL
       AND COALESCE(sp.port_id, p.id) = $2
       AND NOT EXISTS (
         SELECT 1 FROM operations o
         WHERE o.deleted_at IS NULL AND o.shipping_instruction_id = si.id
       )
     ORDER BY sp.sequence ASC NULLS LAST,
              COALESCE(sp.eta, (si.eta_to::timestamptz), (si.eta_from::timestamptz)) ASC NULLS LAST, si.id ASC`,
    ['incoming-si', selectedPortId]
  );

  const incomingPlanOnlyRes = await pool.query(
    `SELECT
        ('plan-' || sp.id)::text AS vessel_id,
        NULL::bigint AS operation_id,
        NULL::bigint AS shipping_instruction_id,
        spur.code AS purpose,
        NULL::text AS source_status,
        COALESCE(sp.shifting_out, false) AS shifting_out,
        sp.shifting_out_at AS shifting_out_at,
        sp.sequence AS sequence,
        sp.id::bigint AS shipment_plan_id,
        sp.plan_reference AS plan_reference,
        spur.label AS plan_purpose_label,
        sp.priority AS priority,
        sp.remark AS remark,
        sp.vessel_name,
        NULL::text AS reference_number,
        NULL::text AS commodity,
        sp.no_pkk AS no_pkk,
        NULL::text AS shipper_name,
        ag.name AS agent_name,
        NULL::text AS surveyor_name,
        NULL::text AS trade_term_code,
        NULL::text AS loading_port_name,
        sp.eta AS eta_datetime,
        sp.ta AS ta_datetime,
        sp.etb AS planned_etb_datetime,
        COALESCE(sp.etb, sp.docking_start_time) AS etb_datetime,
        sp.pob AS pob_datetime,
        sp.sob AS sob_datetime,
        sp.tb AS tb_datetime,
        sp.estimated_completion_time AS estimated_completion_datetime,
        sp.operations_completed_at AS operations_completed_datetime,
        sp.actual_completion_time AS actual_completion_datetime,
        sp.cast_off_at AS cast_off_datetime,
        sp.nor_tendered_at AS nor_tendered_datetime,
        sp.nor_accepted_at AS nor_accepted_datetime,
        sp.demurrage_liability_from_at AS demurrage_liability_from_datetime,
        sp.updated_at AS record_last_updated_at,
        NULL::text AS record_last_updated_by_display_name,
        (to_char(sp.eta AT TIME ZONE 'UTC', 'DD/MM HH24:MI'))::text AS eta_display,
        CASE WHEN COALESCE(sp.etb, sp.docking_start_time) IS NULL THEN NULL
             ELSE (to_char(COALESCE(sp.etb, sp.docking_start_time) AT TIME ZONE 'UTC', 'DD/MM HH24:MI'))
        END AS etb_display,
        $1::text AS source_kind,
        (regexp_replace(j.name, '^Jetty\\s+', '', 'i'))::text AS jetty_display,
        sp.id::text AS row_id
     FROM shipment_plans sp
     LEFT JOIN si_purposes spur ON spur.id = sp.purpose_id AND spur.deleted_at IS NULL
     LEFT JOIN si_agents ag ON ag.id = sp.agent_id AND ag.deleted_at IS NULL
     LEFT JOIN jetties j ON j.id = sp.jetty_id AND j.deleted_at IS NULL
     LEFT JOIN ports p ON p.id = COALESCE(sp.port_id, j.port_id) AND p.deleted_at IS NULL
     WHERE sp.deleted_at IS NULL
       AND COALESCE(sp.port_id, p.id) = $2
       AND NOT EXISTS (
         SELECT 1 FROM shipping_instructions si
         WHERE si.shipment_plan_id = sp.id AND si.deleted_at IS NULL
       )
       AND NOT EXISTS (
         SELECT 1 FROM shipping_instructions si2
         JOIN operations o ON o.shipping_instruction_id = si2.id AND o.deleted_at IS NULL
         WHERE si2.shipment_plan_id = sp.id AND si2.deleted_at IS NULL
       )
     ORDER BY sp.sequence ASC NULLS LAST, sp.eta ASC NULLS LAST, sp.id ASC`,
    ['incoming-plan', selectedPortId]
  );

  const berthingByPlan = await loadBerthingAllowedByPlanId(selectedPortId);

  // Build berths occupancy from active operations.
  // Occupied when status is operational OR when TB has been recorded.
  const occupiedStatuses = new Set([
    'DOCKED',
    'IN_PROGRESS',
    'POST_OPS',
    'SIGNOFF_REQUESTED',
    'SIGNOFF_APPROVED',
  ]);
  const ops = activeOpsRes.rows;
  const occupantsByJetty = new Map();
  for (const o of ops) {
    if (o.shifting_out) continue;
    const hasTb = o.tb_datetime != null;
    if (!hasTb && !occupiedStatuses.has(o.source_status)) continue;
    const jettyId = o.jetty_display;
    if (!jettyId) continue;
    const arr = occupantsByJetty.get(jettyId) || [];
    arr.push({
      vesselId: o.vessel_id,
      vesselName: o.vessel_name,
      operationId: o.operation_id != null ? Number(o.operation_id) : null,
      shipmentPlanId: o.shipment_plan_id != null ? Number(o.shipment_plan_id) : null,
      status: o.source_status || null,
      taDateTime: o.ta_datetime || null,
      tbDateTime: o.tb_datetime || null,
      estimatedCompletionDateTime: o.estimated_completion_datetime || null,
      actualCompletionDateTime: o.actual_completion_datetime || null,
      castOffDateTime: o.cast_off_datetime || null,
    });
    occupantsByJetty.set(jettyId, arr);
  }

  const berths = jettiesRes.rows.map((j) => {
    const id = jettyShortName(j.name);
    const occList = dedupeBerthOccupantsByShipmentPlan(occupantsByJetty.get(id) || []);
    const occ0 = occList[0] || null;
    return {
      id,
      name: j.name,
      status: j.status,
      capacity: j.capacity != null ? Number(j.capacity) : 1,
      portName: j.port_name,
      occupants: occList,
      occupiedCount: occList.length,
      // Backward-compat (single-vessel UI)
      currentVesselId: occ0 ? occ0.vesselId : null,
      currentVesselName: occ0 ? occ0.vesselName : null,
      currentOperationId: occ0?.operationId != null ? Number(occ0.operationId) : null,
    };
  });

  const scheduleOps = scheduleOpsRes?.rows || [];
  const incomingPlanOnly = incomingPlanOnlyRes?.rows || [];
  const [enrichedOps, enrichedScheduleOps, enrichedIncomingSi, enrichedIncomingPlan] = await Promise.all([
    enrichRowsWithCargoDisplay(pool, ops),
    enrichRowsWithCargoDisplay(pool, scheduleOps),
    enrichRowsWithCargoDisplay(pool, incomingSiRes.rows),
    Promise.resolve(incomingPlanOnly),
  ]);
  const enrichedIncoming = [...enrichedIncomingSi, ...enrichedIncomingPlan];
  const mapRow = (r) => attachBerthingEligibility(formatListRow(r), berthingByPlan);
  const queue = [...enrichedOps, ...enrichedIncoming].map(mapRow);
  const scheduleQueue = [...enrichedScheduleOps, ...enrichedIncoming].map(mapRow);
  return { queue, berths, scheduleQueue };
}

router.get('/overview', ...requirePageView('allocation-plan'), async (req, res) => {
  // Same payload as legacy; now gated by `allocation-plan` view (mirrored from retired `allocation` in migration 068).
  const selectedPortId = Number(req.selectedPortId);
  const payload = await buildAllocationOverviewPayload(selectedPortId);
  res.json(payload);
});

router.get('/plan-overview', ...requirePageView('allocation-plan'), async (req, res) => {
  const selectedPortId = Number(req.selectedPortId);
  const payload = await buildAllocationOverviewPayload(selectedPortId);
  res.json(payload);
});

/**
 * Swap `shipment_plans.sequence` between two plans (same port). Used by plan-centric
 * Allocation & Berthing queue ↑/↓ only — does not touch `operations.sequence`.
 */
router.post('/shipment-plans/swap-berthing-sequence', async (req, res) => {
  if (!(await userHasAllocationPlanEdit(req.userId))) {
    return res.status(403).json({ error: 'Forbidden: allocation edit permission required' });
  }
  const selectedPortId = Number(req.selectedPortId);
  const b = req.body || {};
  const idA = parseInt(b.shipment_plan_id_a ?? b.shipmentPlanIdA, 10);
  const idB = parseInt(b.shipment_plan_id_b ?? b.shipmentPlanIdB, 10);
  if (Number.isNaN(idA) || Number.isNaN(idB) || idA === idB) {
    return res.status(400).json({ error: 'Two distinct shipment_plan_id values are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const sel = await client.query(
      `SELECT id, sequence, vessel_name FROM shipment_plans
       WHERE id = ANY($1::bigint[]) AND port_id = $2 AND deleted_at IS NULL`,
      [[idA, idB], selectedPortId]
    );
    if (sel.rows.length !== 2) {
      await client.query('ROLLBACK').catch(() => {});
      return res.status(404).json({ error: 'One or both shipment plans not found for this port' });
    }
    const rowA = sel.rows.find((x) => Number(x.id) === idA);
    const rowB = sel.rows.find((x) => Number(x.id) === idB);
    const sa = rowA?.sequence ?? null;
    const sb = rowB?.sequence ?? null;

    const earlierRaw = b.earlier_plan_id ?? b.earlierPlanId;
    const earlierId =
      earlierRaw != null && String(earlierRaw).trim() !== '' ? parseInt(String(earlierRaw), 10) : NaN;
    const hasEarlier = Number.isFinite(earlierId) && (earlierId === idA || earlierId === idB);

    let newSeqA;
    let newSeqB;

    if (sa == null && sb == null) {
      if (!hasEarlier) {
        await client.query('ROLLBACK').catch(() => {});
        return res.status(400).json({
          error:
            'earlier_plan_id is required when both shipment plans have no berthing sequence yet (so order can be applied)',
        });
      }
      const laterId = earlierId === idA ? idB : idA;
      const maxRes = await client.query(
        `SELECT COALESCE(MAX(sequence), 0)::int AS m FROM shipment_plans WHERE port_id = $1 AND deleted_at IS NULL`,
        [selectedPortId]
      );
      const m = Number(maxRes.rows[0]?.m) || 0;
      const lo = m + 1;
      const hi = m + 2;
      await client.query(
        `UPDATE shipment_plans
         SET sequence = CASE id WHEN $1::bigint THEN $3::int WHEN $2::bigint THEN $4::int END,
             updated_at = NOW(), updated_by = $5
         WHERE id IN ($1::bigint, $2::bigint) AND port_id = $6 AND deleted_at IS NULL`,
        [earlierId, laterId, lo, hi, req.userId ?? null, selectedPortId]
      );
      newSeqA = idA === earlierId ? lo : hi;
      newSeqB = idB === earlierId ? lo : hi;
    } else {
      await client.query(
        `UPDATE shipment_plans
         SET sequence = $1, updated_at = NOW(), updated_by = $2
         WHERE id = $3 AND port_id = $4 AND deleted_at IS NULL`,
        [sb, req.userId ?? null, idA, selectedPortId]
      );
      await client.query(
        `UPDATE shipment_plans
         SET sequence = $1, updated_at = NOW(), updated_by = $2
         WHERE id = $3 AND port_id = $4 AND deleted_at IS NULL`,
        [sa, req.userId ?? null, idB, selectedPortId]
      );
      newSeqA = sb;
      newSeqB = sa;
    }
    await client.query('COMMIT');

    const activityPageKey = 'allocation-plan';
    writeActivityLog({
      pageKey: activityPageKey,
      action: 'update',
      entityType: 'ShipmentPlan',
      entityId: String(idA),
      entityLabel: rowA?.vessel_name || `Shipment plan #${idA}`,
      summary:
        sa == null && sb == null
          ? 'Set berthing sequence for shipment plans (first explicit order)'
          : 'Swapped berthing sequence between shipment plans',
      changes: [
        { field: `Plan ${idA} sequence`, from: sa, to: newSeqA },
        { field: `Plan ${idB} sequence`, from: sb, to: newSeqB },
      ],
      meta: { shipmentPlanIdA: idA, shipmentPlanIdB: idB },
      actorUserId: req.userId ?? null,
    }).catch(() => {});

    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    return res.status(500).json({ error: String(e?.message || e || 'Swap failed') });
  } finally {
    client.release();
  }
});

/**
 * Persist "Log arrival update" into operations and/or shipment_plans.
 *
 * Plan-only (shipmentPlanId): planning fields on the plan (jetty, ETA, ETB, etc.) — no operation.
 * SI/op path: creates operation when plan is Approved; berthing timestamps require Approved plan + SIs.
 */
router.put('/arrival', async (req, res) => {
  const selectedPortId = Number(req.selectedPortId);
  if (!(await userHasAllocationPlanEdit(req.userId))) {
    return res.status(403).json({ error: 'Forbidden: allocation edit permission required' });
  }
  const b = req.body || {};
  const shippingInstructionId = b.shippingInstructionId != null ? parseInt(b.shippingInstructionId, 10) : null;
  const operationId = b.operationId != null ? parseInt(b.operationId, 10) : null;
  const shipmentPlanIdRaw = b.shipmentPlanId ?? b.shipment_plan_id;
  const shipmentPlanIdDirect =
    shipmentPlanIdRaw != null && shipmentPlanIdRaw !== ''
      ? parseInt(shipmentPlanIdRaw, 10)
      : null;

  const hasOp = operationId != null && !Number.isNaN(operationId);
  const hasSi = shippingInstructionId != null && !Number.isNaN(shippingInstructionId);
  const hasPlanOnly =
    shipmentPlanIdDirect != null &&
    !Number.isNaN(shipmentPlanIdDirect) &&
    !hasOp &&
    !hasSi;

  if (!hasOp && !hasSi && !hasPlanOnly) {
    return res.status(400).json({
      error: 'Provide shipmentPlanId, shippingInstructionId, or operationId',
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (hasPlanOnly) {
      if (bodyHasBerthingArrivalFields(b)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: PLAN_BERTHING_GATE_MSG });
      }
      const planRes = await client.query(
        `SELECT id, vessel_name, plan_reference, eta, etb, jetty_id, priority, remark, no_pkk,
                approval_status,
                (SELECT COUNT(*)::int FROM shipping_instructions si
                 WHERE si.shipment_plan_id = shipment_plans.id AND si.deleted_at IS NULL) AS si_count
         FROM shipment_plans
         WHERE id = $1 AND port_id = $2 AND deleted_at IS NULL`,
        [shipmentPlanIdDirect, selectedPortId]
      );
      if (planRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Shipment plan not found' });
      }
      const planBefore = planRes.rows[0];
      let jettyId = planBefore.jetty_id;
      if (b.jetty != null && String(b.jetty).trim()) {
        const short = String(b.jetty).trim();
        const full = /^jetty\s+/i.test(short) ? short : `Jetty ${short}`;
        const jr = await client.query(
          `SELECT id, status FROM jetties
           WHERE deleted_at IS NULL AND port_id = $3 AND (name = $1 OR name = $2)
           ORDER BY id LIMIT 1`,
          [short, full, selectedPortId]
        );
        jettyId = jr.rows[0]?.id ?? null;
        if (jr.rows[0]?.status === JETTY_OUT_OF_SERVICE) {
          await client.query('ROLLBACK');
          return res.status(409).json({
            error:
              'Jetty is out of service. Select another jetty or restore service in Master – Jetty.',
          });
        }
      }
      const parseTsPlan = (v) => {
        if (!v) return null;
        const d = new Date(v);
        return Number.isNaN(d.getTime()) ? null : d.toISOString();
      };
      const eta = Object.prototype.hasOwnProperty.call(b, 'etaDateTime')
        ? parseTsPlan(b.etaDateTime)
        : planBefore.eta;
      const etb = Object.prototype.hasOwnProperty.call(b, 'etbDateTime')
        ? parseTsPlan(b.etbDateTime)
        : planBefore.etb;
      const remark = b.remark != null ? String(b.remark).trim() : planBefore.remark;
      const priority = b.priority != null ? String(b.priority).trim() : planBefore.priority;
      const noPkk = b.noPkk != null ? String(b.noPkk).trim() : planBefore.no_pkk;
      const planUpdParams = [
        eta,
        etb,
        jettyId,
        priority || null,
        remark || null,
        noPkk || null,
        req.userId ?? null,
        shipmentPlanIdDirect,
        selectedPortId,
      ];
      try {
        await client.query(
          `UPDATE shipment_plans SET
             eta = COALESCE($1, eta),
             etb = COALESCE($2, etb),
             jetty_id = COALESCE($3, jetty_id),
             priority = COALESCE($4, priority),
             remark = COALESCE($5, remark),
             no_pkk = COALESCE($6, no_pkk),
             updated_at = NOW(),
             updated_by = $7
           WHERE id = $8 AND port_id = $9 AND deleted_at IS NULL`,
          planUpdParams
        );
      } catch (e) {
        if (e?.code === '42703' && String(e?.message || '').includes('updated_by')) {
          await client.query(
            `UPDATE shipment_plans SET
               eta = COALESCE($1, eta),
               etb = COALESCE($2, etb),
               jetty_id = COALESCE($3, jetty_id),
               priority = COALESCE($4, priority),
               remark = COALESCE($5, remark),
               no_pkk = COALESCE($6, no_pkk),
               updated_at = NOW()
             WHERE id = $7 AND port_id = $8 AND deleted_at IS NULL`,
            planUpdParams.slice(0, 6).concat(planUpdParams.slice(7))
          );
        } else {
          throw e;
        }
      }
      await client.query('COMMIT');
      writeActivityLog({
        pageKey: 'allocation-plan',
        action: 'update',
        entityType: 'ShipmentPlan',
        entityId: String(shipmentPlanIdDirect),
        entityLabel: planBefore.plan_reference || planBefore.vessel_name || `Plan #${shipmentPlanIdDirect}`,
        summary: 'Saved plan scheduling update (late SI — no operation yet)',
        changes: [
          { field: 'ETA', from: planBefore.eta, to: eta },
          { field: 'ETB', from: planBefore.etb, to: etb },
          { field: 'Jetty ID', from: planBefore.jetty_id, to: jettyId },
        ].filter((c) => c.from !== c.to),
        meta: { shipmentPlanId: shipmentPlanIdDirect, planOnly: true },
        actorUserId: req.userId ?? null,
      }).catch(() => {});
      return res.json({
        ok: true,
        shipmentPlanId: shipmentPlanIdDirect,
        operationId: null,
      });
    }

    let opRow = null;
    if (operationId != null && !Number.isNaN(operationId)) {
      const op = await client.query(
        `SELECT o.id, o.shipping_instruction_id, o.jetty_id, p.id AS port_id
         FROM operations o
         LEFT JOIN jetties j ON j.id = o.jetty_id AND j.deleted_at IS NULL
         LEFT JOIN ports p ON p.id = COALESCE(o.port_id, j.port_id) AND p.deleted_at IS NULL
         WHERE o.id = $1 AND o.deleted_at IS NULL`,
        [operationId]
      );
      opRow = op.rows[0] ?? null;
      if (!opRow) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Operation not found' });
      }
      if (opRow.port_id != null && Number(opRow.port_id) !== selectedPortId) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Operation not found' });
      }
    } else {
      // Find existing op for SI or create one.
      let createdNewOperation = false;
      const ex = await client.query(
        `SELECT o.id, o.shipping_instruction_id, o.jetty_id
         FROM operations o
         WHERE o.shipping_instruction_id = $1 AND o.deleted_at IS NULL
         ORDER BY o.id DESC
         LIMIT 1`,
        [shippingInstructionId]
      );
      opRow = ex.rows[0] ?? null;
      if (!opRow) {
        const insRow = await insertOperationForApprovedPlanSi(
          client,
          shippingInstructionId,
          selectedPortId,
          req.userId
        );
        if (!insRow) {
          await client.query('ROLLBACK');
          return res.status(404).json({
            error: 'Shipping instruction not found or shipment plan not approved for berthing',
          });
        }
        opRow = insRow;
        createdNewOperation = true;
      }
      if (createdNewOperation) {
        await assignJettyOperationCode(client, opRow.id);
      }
    }

    const siDetails = await client.query(
      `SELECT si.eta_from, si.eta_to, sp.eta AS plan_eta, sp.approval_status AS plan_approval_status,
              (SELECT COUNT(*)::int FROM shipping_instructions si2
               WHERE si2.shipment_plan_id = sp.id AND si2.deleted_at IS NULL) AS si_count
       FROM shipping_instructions si
       LEFT JOIN shipment_plans sp ON sp.id = si.shipment_plan_id AND sp.deleted_at IS NULL
       WHERE si.id = $1 AND si.deleted_at IS NULL`,
      [opRow.shipping_instruction_id]
    );
    const si = siDetails.rows[0] ?? {};
    const planBerthingOk =
      si.plan_approval_status === 'Approved' && Number(si.si_count) > 0;
    if (bodyHasBerthingArrivalFields(b) && !planBerthingOk) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: PLAN_BERTHING_GATE_MSG });
    }
    const opBeforeRes = await client.query(
      `SELECT
         status, eta, ta, etb, pob, tb, sob,
         nor_tendered_at, nor_accepted_at, demurrage_liability_from_at,
         no_pkk, priority, remark, jetty_id, estimated_completion_time, actual_completion_time
       FROM operations
       WHERE id = $1 AND deleted_at IS NULL`,
      [opRow.id]
    );
    const opBefore = opBeforeRes.rows[0] ?? null;

    const spiRes = await client.query(
      `SELECT shipment_plan_id FROM shipping_instructions WHERE id = $1 AND deleted_at IS NULL`,
      [opRow.shipping_instruction_id]
    );
    const shipmentPlanId = spiRes.rows[0]?.shipment_plan_id ?? null;
    let planBefore = null;
    if (shipmentPlanId != null) {
      const pbr = await client.query(
        `SELECT eta, ta, etb, pob, tb, sob,
                nor_tendered_at, nor_accepted_at, demurrage_liability_from_at,
                no_pkk, priority, remark, jetty_id, estimated_completion_time, actual_completion_time
         FROM shipment_plans WHERE id = $1 AND deleted_at IS NULL`,
        [shipmentPlanId]
      );
      planBefore = pbr.rows[0] ?? null;
    }

    const scheduleTz = await loadOperationScheduleTimezone(client, opRow.id);

    const parseTs = (v) => {
      if (!v) return null;
      const out = parseScheduleInstantToIso(v, scheduleTz);
      return out === undefined ? null : out;
    };

    const colToIso = (v) => {
      if (v == null) return null;
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) return null;
      return d.toISOString();
    };

    /** If JSON body omits a key, keep existing DB value (partial client updates). */
    const tsOrKeep = (bodyKey, bodyVal, existingCol) =>
      Object.prototype.hasOwnProperty.call(b, bodyKey) ? parseTs(bodyVal) : colToIso(existingCol);

    const derivedEta =
      colToIso(si.plan_eta) ??
      (si.eta_to ? new Date(`${String(si.eta_to).slice(0, 10)}T12:00:00Z`).toISOString() : null) ??
      (si.eta_from ? new Date(`${String(si.eta_from).slice(0, 10)}T12:00:00Z`).toISOString() : null);

    const eta = Object.prototype.hasOwnProperty.call(b, 'etaDateTime')
      ? parseTs(b.etaDateTime) ?? derivedEta
      : colToIso(opBefore?.eta) ?? derivedEta;
    const ta = tsOrKeep('taDateTime', b.taDateTime, opBefore?.ta);
    const etb = tsOrKeep('etbDateTime', b.etbDateTime, opBefore?.etb);
    const pob = tsOrKeep('pobDateTime', b.pobDateTime, opBefore?.pob);
    const tb = tsOrKeep('tbDateTime', b.tbDateTime, opBefore?.tb);
    const sob = tsOrKeep('sobDateTime', b.sobDateTime, opBefore?.sob);
    const estimatedCompletion = tsOrKeep(
      'estimatedCompletionDateTime',
      b.estimatedCompletionDateTime,
      opBefore?.estimated_completion_time
    );
    const opStatusUpper = String(opBefore?.status || opRow.source_status || '').toUpperCase();
    const actualCompletionExplicit = Object.prototype.hasOwnProperty.call(b, 'actualCompletionDateTime');
    const actualCompletion =
      opStatusUpper === 'SAILED' && actualCompletionExplicit
        ? parseTs(b.actualCompletionDateTime)
        : colToIso(opBefore?.actual_completion_time ?? null);
    const norTendered = tsOrKeep('norTenderedDateTime', b.norTenderedDateTime, opBefore?.nor_tendered_at);
    const norAccepted = tsOrKeep('norAcceptedDateTime', b.norAcceptedDateTime, opBefore?.nor_accepted_at);
    const demurrageLiabilityFromExplicit = Object.prototype.hasOwnProperty.call(
      b,
      'demurrageLiabilityFromDateTime'
    );
    const demurrageLiabilityFrom = demurrageLiabilityFromExplicit
      ? parseTs(b.demurrageLiabilityFromDateTime)
      : null;
    const remark = b.remark != null ? String(b.remark).trim() : null;
    const priority = b.priority != null ? String(b.priority).trim() : null;
    const noPkk = b.noPkk != null ? String(b.noPkk).trim() : null;

    // Jetty: store as FK (operations.jetty_id) by resolving "1A" or "Jetty 1A" to jetties.id
    let jettyId = null;
    if (b.jetty != null && String(b.jetty).trim()) {
      const short = String(b.jetty).trim();
      const full = /^jetty\s+/i.test(short) ? short : `Jetty ${short}`;
      const jr = await client.query(
        `SELECT id FROM jetties
         WHERE deleted_at IS NULL
           AND port_id = $3
           AND (name = $1 OR name = $2)
         ORDER BY id LIMIT 1`,
        [short, full, selectedPortId]
      );
      jettyId = jr.rows[0]?.id ?? null;
    }

    if (jettyId != null) {
      const jst = await client.query(
        `SELECT status FROM jetties WHERE id = $1 AND deleted_at IS NULL`,
        [jettyId]
      );
      const st = jst.rows[0]?.status;
      if (st === JETTY_OUT_OF_SERVICE) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error:
            'Jetty is out of service. Select another jetty or restore service in Master – Jetty.',
        });
      }
    }

    const arrivalUpdateParamsBase = [
      eta,
      ta,
      etb,
      pob,
      tb,
      sob,
      norTendered,
      norAccepted,
      demurrageLiabilityFromExplicit,
      demurrageLiabilityFrom,
      remark,
      priority,
      noPkk,
      jettyId,
      estimatedCompletion,
      actualCompletion,
    ];
    if (shipmentPlanId != null) {
      const planUpd = await runArrivalShipmentPlanUpdate(
        client,
        [...arrivalUpdateParamsBase, req.userId ?? null, shipmentPlanId],
        [...arrivalUpdateParamsBase, shipmentPlanId]
      );
      if (planUpd.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Shipment plan not found' });
      }
    }
    const updRes = await runArrivalOperationUpdate(
      client,
      [...arrivalUpdateParamsBase, req.userId ?? null, opRow.id],
      [...arrivalUpdateParamsBase, opRow.id]
    );
    if (updRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Operation not found' });
    }

    if (shipmentPlanId != null && tb != null) {
      const planSis = await client.query(
        `SELECT si.id
         FROM shipping_instructions si
         JOIN shipment_plans sp ON sp.id = si.shipment_plan_id AND sp.deleted_at IS NULL
         WHERE si.shipment_plan_id = $1
           AND si.deleted_at IS NULL
           AND sp.approval_status = 'Approved'`,
        [shipmentPlanId]
      );
      for (const row of planSis.rows) {
        const siId = Number(row.id);
        if (siId === Number(opRow.shipping_instruction_id)) continue;

        const exSib = await client.query(
          `SELECT o.id, o.shipping_instruction_id
           FROM operations o
           WHERE o.shipping_instruction_id = $1 AND o.deleted_at IS NULL
           ORDER BY o.id DESC
           LIMIT 1`,
          [siId]
        );
        let sibOpRow = exSib.rows[0] ?? null;
        let sibCreated = false;
        if (!sibOpRow) {
          const insRow = await insertOperationForApprovedPlanSi(client, siId, selectedPortId, req.userId);
          if (!insRow) continue;
          sibOpRow = insRow;
          sibCreated = true;
        }
        if (sibCreated) {
          await assignJettyOperationCode(client, sibOpRow.id);
        }

        const stRes = await client.query(
          `SELECT status, actual_completion_time FROM operations WHERE id = $1 AND deleted_at IS NULL`,
          [sibOpRow.id]
        );
        const stRow = stRes.rows[0];
        if (!stRow || stRow.status === 'SAILED') continue;

        const actualCompletionSibling = actualCompletionExplicit
          ? actualCompletion
          : colToIso(stRow.actual_completion_time ?? null);

        const siblingParams = [...arrivalUpdateParamsBase.slice(0, 15), actualCompletionSibling];
        const sibUpd = await runArrivalOperationUpdate(
          client,
          [...siblingParams, req.userId ?? null, sibOpRow.id],
          [...siblingParams, sibOpRow.id]
        );
        if (sibUpd.rowCount === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Operation not found' });
        }
      }
    }

    const shouldUpsertNorMeta =
      norTendered !== undefined ||
      norAccepted !== undefined ||
      demurrageLiabilityFromExplicit;
    if (shouldUpsertNorMeta) {
      const norMetaPayload = {
        norStage: 'pre_berth',
        norSource: 'allocation_log_arrival',
        updatedVia: 'allocation.arrival',
      };
      const norEx = await client.query(
        `SELECT id, payload_json
         FROM operation_nor_details
         WHERE operation_id = $1 AND deleted_at IS NULL
         ORDER BY id DESC
         LIMIT 1`,
        [opRow.id]
      );
      if (norEx.rows.length > 0) {
        const current = norEx.rows[0].payload_json && typeof norEx.rows[0].payload_json === 'object'
          ? norEx.rows[0].payload_json
          : {};
        await client.query(
          `UPDATE operation_nor_details
           SET payload_json = $1::jsonb, updated_at = NOW()
           WHERE id = $2`,
          [JSON.stringify({ ...current, ...norMetaPayload }), norEx.rows[0].id]
        );
      } else {
        await client.query(
          `INSERT INTO operation_nor_details (operation_id, remark, payload_json)
           VALUES ($1, NULL, $2::jsonb)`,
          [opRow.id, JSON.stringify(norMetaPayload)]
        );
      }
    }

    await client.query('COMMIT');
    let stamp = { recordLastUpdatedAt: null, recordLastUpdatedByDisplayName: null };
    try {
      stamp = await selectOperationRecordStamp(opRow.id);
    } catch (stampErr) {
      console.error('allocation.arrival stamp read failed', stampErr);
    }
    const changes = [
      { field: 'ETA', from: opBefore?.eta ?? null, to: eta ?? null },
      { field: 'TA', from: opBefore?.ta ?? null, to: ta ?? null },
      { field: 'ETB', from: opBefore?.etb ?? null, to: etb ?? null },
      { field: 'POB', from: opBefore?.pob ?? null, to: pob ?? null },
      { field: 'TB', from: opBefore?.tb ?? null, to: tb ?? null },
      { field: 'SOB', from: opBefore?.sob ?? null, to: sob ?? null },
      { field: 'NOR Tendered', from: opBefore?.nor_tendered_at ?? null, to: norTendered ?? null },
      { field: 'NOR Accepted', from: opBefore?.nor_accepted_at ?? null, to: norAccepted ?? null },
      ...(demurrageLiabilityFromExplicit
        ? [
            {
              field: 'Demurrage liability from',
              from: opBefore?.demurrage_liability_from_at ?? null,
              to: demurrageLiabilityFrom ?? null,
            },
          ]
        : []),
      { field: 'No PKK', from: opBefore?.no_pkk ?? null, to: noPkk ?? null },
      { field: 'Priority', from: opBefore?.priority ?? null, to: priority ?? null },
      { field: 'Jetty ID', from: opBefore?.jetty_id ?? null, to: jettyId ?? null },
      { field: 'Estimated Completion', from: opBefore?.estimated_completion_time ?? null, to: estimatedCompletion ?? null },
      { field: 'Actual Completion', from: opBefore?.actual_completion_time ?? null, to: actualCompletion ?? null },
      { field: 'Remark', from: opBefore?.remark ?? null, to: remark ?? null },
    ].filter((c) => c.from !== c.to);

    const planChanges =
      shipmentPlanId != null && planBefore
        ? [
            { field: 'Plan ETA', from: planBefore?.eta ?? null, to: eta ?? null },
            { field: 'Plan TA', from: planBefore?.ta ?? null, to: ta ?? null },
            { field: 'Plan ETB', from: planBefore?.etb ?? null, to: etb ?? null },
            { field: 'Plan Jetty ID', from: planBefore?.jetty_id ?? null, to: jettyId ?? null },
          ].filter((c) => c.from !== c.to)
        : [];

    const activityPageKey = 'allocation-plan';

    writeActivityLog({
      pageKey: activityPageKey,
      action: 'update',
      entityType: 'Operation',
      entityId: String(opRow.id),
      entityLabel: `Operation #${opRow.id}`,
      summary: 'Saved arrival / allocation update',
      changes: [...planChanges, ...changes],
      meta: {
        operationId: opRow.id,
        shipmentPlanId: shipmentPlanId ?? undefined,
        ...(b.source === 'active_vessel_detail' ? { source: 'active_vessel_detail' } : {}),
        norTenderedSet: norTendered != null,
        norAcceptedSet: norAccepted != null,
        demurrageLiabilityFromSet:
          demurrageLiabilityFromExplicit && demurrageLiabilityFrom != null,
      },
      actorUserId: req.userId ?? null,
    }).catch(() => {});
    res.json({
      ok: true,
      operationId: opRow.id,
      recordLastUpdatedAt: stamp.recordLastUpdatedAt,
      recordLastUpdatedByDisplayName: stamp.recordLastUpdatedByDisplayName,
    });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});

export default router;

