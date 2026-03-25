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
import { optionalAuth } from '../middleware/auth.js';

const router = express.Router();

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
    remark: r.remark || null,
    remarks: r.remark || null,
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
    plannedEtbDateTime: r.planned_etb_datetime || null,
    tbDateTime: r.tb_datetime || null,
    estimatedCompletionDateTime: r.estimated_completion_datetime || null,
    actualCompletionDateTime: r.actual_completion_datetime || null,
    castOffDateTime: r.cast_off_datetime || null,
    status: r.source_status || null,
    completionPercent: r.completion_percent != null ? Number(r.completion_percent) : 0,
    source: r.source_kind,
    operationId: r.operation_id != null ? Number(r.operation_id) : null,
    shippingInstructionId: r.shipping_instruction_id != null ? Number(r.shipping_instruction_id) : null,
  };
}

router.get('/overview', async (req, res) => {
  // NOTE: Allocation page is already hidden by frontend RBAC, but we still keep API auth optional for now.
  // If you want server-side enforcement, add requireAuth + requirePageView('allocation') here.

  const jettiesRes = await pool.query(
    `SELECT j.id, j.name, j.status, p.name AS port_name
     FROM jetties j
     JOIN ports p ON p.id = j.port_id AND p.deleted_at IS NULL
     WHERE j.deleted_at IS NULL
     ORDER BY j.order_no ASC, j.name ASC`
  );

  const activeOpsRes = await pool.query(
    `SELECT
        ('op-' || o.id)::text AS vessel_id,
        o.id AS operation_id,
        o.shipping_instruction_id,
        o.purpose,
        o.status AS source_status,
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
        (to_char(COALESCE(o.eta, si.eta, (si.eta_to::timestamptz), (si.eta_from::timestamptz)) AT TIME ZONE 'UTC', 'DD/MM HH24:MI'))::text AS eta_display,
        CASE WHEN COALESCE(o.etb, o.docking_start_time) IS NULL THEN NULL
             ELSE (to_char(COALESCE(o.etb, o.docking_start_time) AT TIME ZONE 'UTC', 'DD/MM HH24:MI'))
        END AS etb_display,
        $1::text AS source_kind,
        (regexp_replace(j.name, '^Jetty\\s+', '', 'i'))::text AS jetty_display,
        o.id::text AS row_id
     FROM operations o
     JOIN shipping_instructions si ON si.id = o.shipping_instruction_id AND si.deleted_at IS NULL
     LEFT JOIN si_shippers sh ON sh.id = si.shipper_id AND sh.deleted_at IS NULL
     LEFT JOIN si_agents ag ON ag.id = si.agent_id AND ag.deleted_at IS NULL
     LEFT JOIN si_surveyors sv ON sv.id = si.surveyor_id AND sv.deleted_at IS NULL
     LEFT JOIN jetties j ON j.id = o.jetty_id AND j.deleted_at IS NULL
     WHERE o.deleted_at IS NULL
       AND o.status <> 'SAILED'
     ORDER BY COALESCE(o.docking_start_time, si.eta, si.eta_from::timestamptz) ASC NULLS LAST, o.id ASC`,
    ['operation']
  );

  const incomingSiRes = await pool.query(
    `SELECT
        ('si-' || si.id)::text AS vessel_id,
        NULL::bigint AS operation_id,
        si.id AS shipping_instruction_id,
        si.purpose,
        si.status AS source_status,
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
     WHERE si.deleted_at IS NULL
       AND si.status = 'Approved'
       AND NOT EXISTS (
         SELECT 1 FROM operations o
         WHERE o.deleted_at IS NULL AND o.shipping_instruction_id = si.id
       )
     ORDER BY COALESCE(si.eta, (si.eta_to::timestamptz), (si.eta_from::timestamptz)) ASC NULLS LAST, si.id ASC`,
    ['shipping-instruction']
  );

  // Build berths occupancy from active operations.
  // Occupied when status is operational OR when TB has been recorded.
  const occupiedStatuses = new Set(['DOCKED', 'IN_PROGRESS', 'COMPLETED']);
  const ops = activeOpsRes.rows;
  const occupiedByJetty = new Map();
  for (const o of ops) {
    const hasTb = o.tb_datetime != null;
    if (!hasTb && !occupiedStatuses.has(o.source_status)) continue;
    const jettyId = o.jetty_display;
    if (!jettyId) continue;
    if (!occupiedByJetty.has(jettyId)) {
      occupiedByJetty.set(jettyId, { vesselId: o.vessel_id, vesselName: o.vessel_name, operationId: o.operation_id });
    }
  }

  const berths = jettiesRes.rows.map((j) => {
    const id = jettyShortName(j.name);
    const occ = occupiedByJetty.get(id);
    return {
      id,
      name: j.name,
      status: j.status,
      portName: j.port_name,
      currentVesselId: occ ? occ.vesselId : null,
      currentVesselName: occ ? occ.vesselName : null,
      currentOperationId: occ ? Number(occ.operationId) : null,
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
router.put('/arrival', optionalAuth, async (req, res) => {
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
        `SELECT o.id, o.shipping_instruction_id, o.jetty_id
         FROM operations o
         WHERE o.id = $1 AND o.deleted_at IS NULL`,
        [operationId]
      );
      opRow = op.rows[0] ?? null;
      if (!opRow) {
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
        const ins = await client.query(
          `INSERT INTO operations (shipping_instruction_id, jetty_id, purpose, status)
           VALUES ($1, NULL, $2, 'PENDING')
           RETURNING id, shipping_instruction_id, jetty_id`,
          [shippingInstructionId, si.rows[0].purpose]
        );
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
         nor_tendered_at, nor_accepted_at,
         no_pkk, priority, remark, jetty_id, estimated_completion_time
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

    const derivedEta =
      si.eta ??
      (si.eta_to ? new Date(si.eta_to).toISOString() : null) ??
      (si.eta_from ? new Date(si.eta_from).toISOString() : null);

    const eta = parseTs(b.etaDateTime) ?? derivedEta;
    const ta = parseTs(b.taDateTime);
    const etb = parseTs(b.etbDateTime);
    const pob = parseTs(b.pobDateTime);
    const tb = parseTs(b.tbDateTime);
    const sob = parseTs(b.sobDateTime);
    const estimatedCompletion = parseTs(b.estimatedCompletionDateTime);
    const norTendered = parseTs(b.norTenderedDateTime);
    const norAccepted = parseTs(b.norAcceptedDateTime);
    const remark = b.remark != null ? String(b.remark).trim() : null;
    const priority = b.priority != null ? String(b.priority).trim() : null;
    const noPkk = b.noPkk != null ? String(b.noPkk).trim() : null;

    // Jetty: store as FK (operations.jetty_id) by resolving "1A" or "Jetty 1A" to jetties.id
    let jettyId = null;
    if (b.jetty != null && String(b.jetty).trim()) {
      const short = String(b.jetty).trim();
      const full = /^jetty\s+/i.test(short) ? short : `Jetty ${short}`;
      const jr = await client.query(
        `SELECT id FROM jetties WHERE deleted_at IS NULL AND (name = $1 OR name = $2) ORDER BY id LIMIT 1`,
        [short, full]
      );
      jettyId = jr.rows[0]?.id ?? null;
    }

    await client.query(
      `UPDATE operations SET
         eta = $1,
         ta = $2,
         etb = $3,
         pob = $4,
         tb = $5,
         -- Keep legacy column in sync while clearance module still references it.
         docking_start_time = COALESCE($5, docking_start_time),
         -- If TB is set from allocation flow, move operation into occupied state unless it already advanced.
         status = CASE
           WHEN $5 IS NOT NULL AND COALESCE(status, '') IN ('PENDING', 'ALLOCATED', '') THEN 'DOCKED'
           ELSE status
         END,
         sob = $6,
         nor_tendered_at = $7,
         nor_accepted_at = $8,
         remark = COALESCE($9, remark),
         priority = COALESCE($10, priority),
         no_pkk = COALESCE($11, no_pkk),
         jetty_id = COALESCE($12, jetty_id),
         estimated_completion_time = $13,
         updated_at = NOW()
       WHERE id = $14 AND deleted_at IS NULL`,
      [eta, ta, etb, pob, tb, sob, norTendered, norAccepted, remark, priority, noPkk, jettyId, estimatedCompletion, opRow.id]
    );

    const shouldUpsertNorMeta =
      norTendered !== undefined ||
      norAccepted !== undefined;
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
    const changes = [
      { field: 'ETA', from: opBefore?.eta ?? null, to: eta ?? null },
      { field: 'TA', from: opBefore?.ta ?? null, to: ta ?? null },
      { field: 'ETB', from: opBefore?.etb ?? null, to: etb ?? null },
      { field: 'POB', from: opBefore?.pob ?? null, to: pob ?? null },
      { field: 'TB', from: opBefore?.tb ?? null, to: tb ?? null },
      { field: 'SOB', from: opBefore?.sob ?? null, to: sob ?? null },
      { field: 'NOR Tendered', from: opBefore?.nor_tendered_at ?? null, to: norTendered ?? null },
      { field: 'NOR Accepted', from: opBefore?.nor_accepted_at ?? null, to: norAccepted ?? null },
      { field: 'No PKK', from: opBefore?.no_pkk ?? null, to: noPkk ?? null },
      { field: 'Priority', from: opBefore?.priority ?? null, to: priority ?? null },
      { field: 'Jetty ID', from: opBefore?.jetty_id ?? null, to: jettyId ?? null },
      { field: 'Estimated Completion', from: opBefore?.estimated_completion_time ?? null, to: estimatedCompletion ?? null },
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
        norTenderedSet: norTendered != null,
        norAcceptedSet: norAccepted != null,
      },
      actorUserId: req.userId ?? null,
    }).catch(() => {});
    res.json({ ok: true, operationId: opRow.id });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});

export default router;

