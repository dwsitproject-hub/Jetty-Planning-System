/**
 * Allocation & Berthing overview (DB-backed).
 *
 * - Queue rows come from:
 *   1) Operations that are not SAILED (already allocated / at-berth)
 *   2) Approved Shipping Instructions that don't have an operation yet (incoming vessels)
 *
 * Base path: /api/v1/allocation
 */
import express from 'express';
import { pool } from '../db.js';
import { writeActivityLog } from '../lib/activity-log.js';
import { userHasPageEdit } from '../middleware/permissions.js';
import { JETTY_OUT_OF_SERVICE } from '../lib/jetty-blocking.js';

const router = express.Router();

/** null = unknown; set false if DB has no operations.updated_by (migration 044 not applied). */
let allocationOpsHasUpdatedByColumn = null;

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
    sequence: r.sequence != null ? Number(r.sequence) : null,
    vesselId: r.vessel_id,
    vesselName: r.vessel_name,
    shippingInstruction: r.reference_number || (r.shipping_instruction_id ? `SI-${r.shipping_instruction_id}` : '—'),
    priority: r.priority || null,
    purpose: r.purpose || null,
    commodity: r.commodity || null,
    norDocuments: r.nor_documents ?? [],
    noPkk: r.no_pkk || null,
    shipper: r.shipper_name || null,
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
    actualCompletionDateTime: r.actual_completion_datetime || null,
    castOffDateTime: r.cast_off_datetime || null,
    status: r.source_status || null,
    shiftingOut: Boolean(r.shifting_out),
    shiftingOutAt: r.shifting_out_at || null,
    completionPercent: r.completion_percent != null ? Number(r.completion_percent) : 0,
    source: r.source_kind,
    operationId: r.operation_id != null ? Number(r.operation_id) : null,
    shippingInstructionId: r.shipping_instruction_id != null ? Number(r.shipping_instruction_id) : null,
    recordLastUpdatedAt: pgTimestampToIsoString(
      r.record_last_updated_at ?? r.recordLastUpdatedAt ?? null
    ),
    recordLastUpdatedByDisplayName:
      r.record_last_updated_by_display_name ?? r.recordLastUpdatedByDisplayName ?? null,
  };
}

function activeOperationsOverviewSql(includeUpdatedByJoin) {
  const bySelect = includeUpdatedByJoin
    ? `NULLIF(TRIM(COALESCE(u.display_name, u.username, '')), '') AS record_last_updated_by_display_name`
    : `NULL::text AS record_last_updated_by_display_name`;
  const joinUsers = includeUpdatedByJoin
    ? `LEFT JOIN users u ON u.id = o.updated_by AND u.deleted_at IS NULL`
    : '';
  return `
    SELECT
        ('op-' || o.id)::text AS vessel_id,
        o.id AS operation_id,
        o.shipping_instruction_id,
        o.purpose,
        o.status AS source_status,
        o.shifting_out AS shifting_out,
        o.shifting_out_at AS shifting_out_at,
        o.completion_percent AS completion_percent,
        NULL::int AS sequence,
        o.priority AS priority,
        o.remark AS remark,
        si.vessel_name,
        si.reference_number,
        ${SI_COMMODITY} AS commodity,
        COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', d.id,
            'name', d.original_name,
            'url', ('/uploads/' || replace(d.stored_path, '\\\\', '/'))
          ) ORDER BY d.created_at DESC, d.id DESC)
          FROM public.operation_documents d
          WHERE d.operation_id = o.id AND d.deleted_at IS NULL AND d.kind = 'NOR'
        ), '[]'::jsonb) AS nor_documents,
        o.no_pkk AS no_pkk,
        sh.name AS shipper_name,
        ag.name AS agent_name,
        sv.name AS surveyor_name,
        COALESCE(o.eta, si.eta, (si.eta_to::timestamptz), (si.eta_from::timestamptz)) AS eta_datetime,
        o.ta AS ta_datetime,
        o.etb AS planned_etb_datetime,
        COALESCE(o.etb, o.tb, o.docking_start_time) AS etb_datetime,
        o.pob AS pob_datetime,
        o.sob AS sob_datetime,
        COALESCE(o.tb, o.docking_start_time) AS tb_datetime,
        o.estimated_completion_time AS estimated_completion_datetime,
        o.actual_completion_time AS actual_completion_datetime,
        o.cast_off_at AS cast_off_datetime,
        o.nor_tendered_at AS nor_tendered_datetime,
        o.nor_accepted_at AS nor_accepted_datetime,
        o.demurrage_liability_from_at AS demurrage_liability_from_datetime,
        o.updated_at AS record_last_updated_at,
        ${bySelect},
        (to_char(COALESCE(o.eta, si.eta, (si.eta_to::timestamptz), (si.eta_from::timestamptz)) AT TIME ZONE 'UTC', 'DD/MM HH24:MI'))::text AS eta_display,
        CASE WHEN COALESCE(o.etb, o.docking_start_time) IS NULL THEN NULL
             ELSE (to_char(COALESCE(o.etb, o.docking_start_time) AT TIME ZONE 'UTC', 'DD/MM HH24:MI'))
        END AS etb_display,
        $1::text AS source_kind,
        (regexp_replace(j.name, '^Jetty\\s+', '', 'i'))::text AS jetty_display,
        o.id::text AS row_id
     FROM operations o
     JOIN shipping_instructions si ON si.id = o.shipping_instruction_id AND si.deleted_at IS NULL
     ${joinUsers}
     LEFT JOIN si_shippers sh ON sh.id = si.shipper_id AND sh.deleted_at IS NULL
     LEFT JOIN si_agents ag ON ag.id = si.agent_id AND ag.deleted_at IS NULL
     LEFT JOIN si_surveyors sv ON sv.id = si.surveyor_id AND sv.deleted_at IS NULL
     LEFT JOIN jetties j ON j.id = o.jetty_id AND j.deleted_at IS NULL
     LEFT JOIN ports p ON p.id = COALESCE(o.port_id, j.port_id) AND p.deleted_at IS NULL
     WHERE o.deleted_at IS NULL
       AND COALESCE(o.port_id, p.id) = $2
       AND o.status <> 'SAILED'
     ORDER BY COALESCE(o.docking_start_time, si.eta, si.eta_from::timestamptz) ASC NULLS LAST, o.id ASC`;
}

router.get('/overview', async (req, res) => {
  const selectedPortId = Number(req.selectedPortId);
  // NOTE: Allocation page is already hidden by frontend RBAC, but we still keep API auth optional for now.
  // If you want server-side enforcement, add requireAuth + requirePageView('allocation') here.

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
  try {
    activeOpsRes = await pool.query(activeOperationsOverviewSql(true), ['operation', selectedPortId]);
  } catch (e) {
    const msg = String(e?.message || '');
    const missingUpdatedBy =
      e?.code === '42703' || (msg.includes('updated_by') && msg.includes('does not exist'));
    if (missingUpdatedBy) {
      activeOpsRes = await pool.query(activeOperationsOverviewSql(false), ['operation', selectedPortId]);
    } else {
      throw e;
    }
  }

  const incomingSiRes = await pool.query(
    `SELECT
        ('si-' || si.id)::text AS vessel_id,
        NULL::bigint AS operation_id,
        si.id AS shipping_instruction_id,
        si.purpose,
        si.status AS source_status,
        NULL::boolean AS shifting_out,
        NULL::timestamptz AS shifting_out_at,
        NULL::int AS sequence,
        NULL::text AS priority,
        NULL::text AS remark,
        si.vessel_name,
        si.reference_number,
        ${SI_COMMODITY} AS commodity,
        NULL::text AS no_pkk,
        sh.name AS shipper_name,
        ag.name AS agent_name,
        sv.name AS surveyor_name,
        COALESCE(si.eta, (si.eta_to::timestamptz), (si.eta_from::timestamptz)) AS eta_datetime,
        NULL::timestamptz AS ta_datetime,
        NULL::timestamptz AS etb_datetime,
        NULL::timestamptz AS pob_datetime,
        NULL::timestamptz AS sob_datetime,
        NULL::timestamptz AS nor_tendered_datetime,
        NULL::timestamptz AS nor_accepted_datetime,
        NULL::timestamptz AS demurrage_liability_from_datetime,
        si.updated_at AS record_last_updated_at,
        NULL::text AS record_last_updated_by_display_name,
        (to_char(COALESCE(si.eta, (si.eta_to::timestamptz), (si.eta_from::timestamptz)) AT TIME ZONE 'UTC', 'DD/MM HH24:MI'))::text AS eta_display,
        NULL::text AS etb_display,
        $1::text AS source_kind,
        (regexp_replace(j.name, '^Jetty\\s+', '', 'i'))::text AS jetty_display,
        si.id::text AS row_id
     FROM shipping_instructions si
     LEFT JOIN si_shippers sh ON sh.id = si.shipper_id AND sh.deleted_at IS NULL
     LEFT JOIN si_agents ag ON ag.id = si.agent_id AND ag.deleted_at IS NULL
     LEFT JOIN si_surveyors sv ON sv.id = si.surveyor_id AND sv.deleted_at IS NULL
     LEFT JOIN jetties j ON j.id = si.preferred_jetty_id AND j.deleted_at IS NULL
     LEFT JOIN ports p ON p.id = COALESCE(si.port_id, j.port_id) AND p.deleted_at IS NULL
     WHERE si.deleted_at IS NULL
       AND si.status = 'Approved'
       AND COALESCE(si.port_id, p.id) = $2
       AND NOT EXISTS (
         SELECT 1 FROM operations o
         WHERE o.deleted_at IS NULL AND o.shipping_instruction_id = si.id
       )
     ORDER BY COALESCE(si.eta, (si.eta_to::timestamptz), (si.eta_from::timestamptz)) ASC NULLS LAST, si.id ASC`,
    ['shipping-instruction', selectedPortId]
  );

  // Build berths occupancy from active operations.
  // Occupied when status is operational OR when TB has been recorded.
  const occupiedStatuses = new Set(['DOCKED', 'IN_PROGRESS', 'COMPLETED']);
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
    const occList = occupantsByJetty.get(id) || [];
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

  const queue = [...ops, ...incomingSiRes.rows].map(formatListRow);
  res.json({ queue, berths });
});

/**
 * Persist "Log arrival update" into operations.
 *
 * If operation doesn't exist yet for an Approved SI, we create it (jetty_id nullable).
 * ETA rule: client can send ETA; if empty, we derive from SI.eta_to (or eta/eta_from).
 */
router.put('/arrival', async (req, res) => {
  const selectedPortId = Number(req.selectedPortId);
  if (!(await userHasPageEdit(req.userId, 'allocation'))) {
    return res.status(403).json({ error: 'Forbidden: allocation edit permission required' });
  }
  const b = req.body || {};
  const shippingInstructionId = b.shippingInstructionId != null ? parseInt(b.shippingInstructionId, 10) : null;
  const operationId = b.operationId != null ? parseInt(b.operationId, 10) : null;

  if ((shippingInstructionId == null || Number.isNaN(shippingInstructionId)) && (operationId == null || Number.isNaN(operationId))) {
    return res.status(400).json({ error: 'Provide shippingInstructionId or operationId' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

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
        const si = await client.query(
          `SELECT id, purpose
           FROM shipping_instructions
           WHERE id = $1 AND deleted_at IS NULL AND status = 'Approved'`,
          [shippingInstructionId]
        );
        if (si.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Approved shipping instruction not found' });
        }
        let ins;
        await client.query('SAVEPOINT allocation_arrival_op_ins');
        try {
          ins = await client.query(
            `INSERT INTO operations (shipping_instruction_id, jetty_id, purpose, status, port_id, updated_by)
             VALUES ($1, NULL, $2, 'PENDING', $3, $4)
             RETURNING id, shipping_instruction_id, jetty_id`,
            [shippingInstructionId, si.rows[0].purpose, selectedPortId, req.userId ?? null]
          );
          allocationOpsHasUpdatedByColumn = true;
          await client.query('RELEASE SAVEPOINT allocation_arrival_op_ins');
        } catch (e) {
          const msg = String(e?.message || '');
          if (e?.code === '42703' && msg.includes('updated_by')) {
            await client.query('ROLLBACK TO SAVEPOINT allocation_arrival_op_ins');
            allocationOpsHasUpdatedByColumn = false;
            ins = await client.query(
              `INSERT INTO operations (shipping_instruction_id, jetty_id, purpose, status, port_id)
               VALUES ($1, NULL, $2, 'PENDING', $3)
               RETURNING id, shipping_instruction_id, jetty_id`,
              [shippingInstructionId, si.rows[0].purpose, selectedPortId]
            );
            await client.query('RELEASE SAVEPOINT allocation_arrival_op_ins');
          } else {
            await client.query('ROLLBACK TO SAVEPOINT allocation_arrival_op_ins');
            throw e;
          }
        }
        opRow = ins.rows[0];
      }
    }

    const siDetails = await client.query(
      `SELECT eta, eta_from, eta_to
       FROM shipping_instructions
       WHERE id = $1 AND deleted_at IS NULL`,
      [opRow.shipping_instruction_id]
    );
    const si = siDetails.rows[0] ?? {};
    const opBeforeRes = await client.query(
      `SELECT
         eta, ta, etb, pob, tb, sob,
         nor_tendered_at, nor_accepted_at, demurrage_liability_from_at,
         no_pkk, priority, remark, jetty_id, estimated_completion_time, actual_completion_time
       FROM operations
       WHERE id = $1 AND deleted_at IS NULL`,
      [opRow.id]
    );
    const opBefore = opBeforeRes.rows[0] ?? null;

    const parseTs = (v) => {
      if (!v) return null;
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) return null;
      return d.toISOString();
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
      si.eta ??
      (si.eta_to ? new Date(si.eta_to).toISOString() : null) ??
      (si.eta_from ? new Date(si.eta_from).toISOString() : null);

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
    const actualCompletionExplicit = Object.prototype.hasOwnProperty.call(b, 'actualCompletionDateTime');
    const actualCompletion = actualCompletionExplicit
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
            'Jetty is out of service. Select another jetty or restore service in Master – Preferred Jetty.',
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
    const updRes = await runArrivalOperationUpdate(
      client,
      [...arrivalUpdateParamsBase, req.userId ?? null, opRow.id],
      [...arrivalUpdateParamsBase, opRow.id]
    );
    if (updRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Operation not found' });
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

    writeActivityLog({
      pageKey: 'allocation',
      action: 'update',
      entityType: 'Operation',
      entityId: String(opRow.id),
      entityLabel: `Operation #${opRow.id}`,
      summary: 'Saved arrival / allocation update',
      changes,
      meta: {
        operationId: opRow.id,
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

