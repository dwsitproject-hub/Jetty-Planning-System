/**
 * Shipping instructions CRUD + breakdown lines (commodity per line, qty + metric).
 */
import express from 'express';
import { pool } from '../db.js';
import { writeActivityLog } from '../lib/activity-log.js';
import { requireAuth } from '../middleware/auth.js';
import { userHasPageApprove, userHasPageDelete } from '../middleware/permissions.js';

const FREIGHT_TERMS = ['PREPAID', 'COLLECT', 'AS_PER_CHARTER_PARTY', 'OTHER'];
const SI_APPROVE_PAGE_KEY = 'shipment-plan';

function generateApprovalId() {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const time = now.toTimeString().slice(0, 8).replace(/:/g, '');
  const r = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `JPS-${date}-${time}-${r}`;
}

/** @param {unknown} v @param {number} max */
function trimText(v, max = 4000) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

function normalizeFreightTerms(v) {
  if (v == null || v === '') return { value: null };
  const s = String(v).trim().toUpperCase();
  if (!FREIGHT_TERMS.includes(s)) return { error: 'freight_terms must be PREPAID, COLLECT, AS_PER_CHARTER_PARTY, or OTHER' };
  return { value: s };
}

const router = express.Router();

const COMMODITY_DISPLAY = `COALESCE(
  (SELECT sc.name FROM public.shipping_instruction_breakdown b
   JOIN public.si_commodities sc ON sc.id = b.commodity_id AND sc.deleted_at IS NULL
   WHERE b.shipping_instruction_id = si.id AND b.deleted_at IS NULL
   ORDER BY b.line_order, b.id LIMIT 1),
  si.commodity
)`;

const SI_SHIPPER_NAMES = `(SELECT STRING_AGG(DISTINCT shs.name, ', ' ORDER BY shs.name)
  FROM public.shipping_instruction_breakdown bs
  JOIN public.si_shippers shs ON shs.id = bs.shipper_id AND shs.deleted_at IS NULL
  WHERE bs.shipping_instruction_id = si.id AND bs.deleted_at IS NULL)`;

const SI_FROM = `
  FROM shipping_instructions si
  LEFT JOIN shipment_plans spl ON spl.id = si.shipment_plan_id AND spl.deleted_at IS NULL
  LEFT JOIN si_trade_terms tt ON si.trade_term_id = tt.id AND tt.deleted_at IS NULL
  LEFT JOIN si_purposes spp ON spp.id = spl.purpose_id AND spp.deleted_at IS NULL
  LEFT JOIN jetties j ON j.id = spl.jetty_id AND j.deleted_at IS NULL
  LEFT JOIN ports p ON p.id = COALESCE(spl.port_id, j.port_id) AND p.deleted_at IS NULL
  LEFT JOIN si_loading_ports lp ON si.loading_port_id = lp.id AND lp.deleted_at IS NULL
  LEFT JOIN si_surveyors sv ON si.surveyor_id = sv.id AND sv.deleted_at IS NULL
  LEFT JOIN si_agents ag ON si.agent_id = ag.id AND ag.deleted_at IS NULL
  LEFT JOIN users si_approver ON si_approver.id = spl.approved_by_user_id AND si_approver.deleted_at IS NULL
`;

const SI_SELECT = `
  SELECT si.id, si.reference_number, spl.vessel_name, si.commodity, spp.code AS purpose, spl.eta,
    si.eta_from::text AS eta_from, si.eta_to::text AS eta_to, si.status,
    si.shipment_plan_id,
    spl.approval_id,
    si.created_at, si.updated_at,
    si.note,
    spl.port_id,
    si.commodity_id, si.trade_term_id, spl.purpose_id, spl.jetty_id AS preferred_jetty_id,
    si.loading_port_id, si.surveyor_id, si.agent_id,
    spl.voyage_no, si.destination_text, si.freight_terms, si.bill_of_lading_clause, si.consignee_text,
    si.notify_party_text, si.bl_split_text, si.bl_indicated, si.document_date::text AS document_date,
    spl.approved_by_user_id, spl.approved_at, si.approver_name_snapshot, si.approver_title_snapshot,
    ${COMMODITY_DISPLAY} AS commodity_display,
    ${SI_SHIPPER_NAMES} AS shipper_names,
    tt.code AS trade_term_code,
    spp.code AS purpose_code,
    j.name AS preferred_jetty_name,
    COALESCE(spl.port_id, p.id) AS preferred_port_id,
    lp.name AS loading_port_name,
    sv.name AS surveyor_name,
    ag.name AS agent_name,
    si_approver.display_name AS approver_display_name,
    si_approver.username AS approver_username
  ${SI_FROM}
`;

async function assertActiveRow(table, id, label) {
  if (id == null) return true;
  const n = parseInt(id, 10);
  if (Number.isNaN(n)) throw new Error(`bad_${label}`);
  const r = await pool.query(
    `SELECT 1 FROM ${table} WHERE id = $1 AND deleted_at IS NULL`,
    [n]
  );
  return r.rows.length > 0;
}

function rejectHeaderShipperId(body, res) {
  if (body?.shipper_id != null && body.shipper_id !== '') {
    res.status(400).json({
      error: 'shipper_id must be set on each breakdown row, not on the shipping instruction header',
    });
    return true;
  }
  return false;
}

function parseBreakdownShipperId(row) {
  const raw = row.shipper_id ?? row.shipperId;
  if (raw == null || raw === '') return null;
  const n = parseInt(raw, 10);
  return Number.isNaN(n) || n < 1 ? null : n;
}

async function validateSiFks(body) {
  const checks = [
    ['si_trade_terms', body.trade_term_id, 'trade_term_id'],
    ['si_purposes', body.purpose_id, 'purpose_id'],
    ['jetties', body.preferred_jetty_id, 'preferred_jetty_id'],
    ['si_loading_ports', body.loading_port_id, 'loading_port_id'],
    ['si_surveyors', body.surveyor_id, 'surveyor_id'],
    ['si_agents', body.agent_id, 'agent_id'],
  ];
  for (const [table, id, label] of checks) {
    if (id == null || id === '') continue;
    const ok = await assertActiveRow(table, id, label);
    if (!ok) return { error: `Invalid or inactive ${label.replace(/_/g, ' ')}` };
  }
  return null;
}

async function loadBreakdown(siId) {
  const r = await pool.query(
    `SELECT b.id, b.shipping_instruction_id, b.commodity_id, b.metric_id, b.qty,
            b.contract_no, b.po_no, b.so_no, b.remarks, b.shipper_id, b.line_order,
            c.name AS commodity_name, m.code AS metric_code, m.label AS metric_label,
            sh.name AS shipper_name
     FROM public.shipping_instruction_breakdown b
     JOIN public.si_commodities c ON c.id = b.commodity_id AND c.deleted_at IS NULL
     JOIN public.metric m ON m.id = b.metric_id AND m.deleted_at IS NULL
     LEFT JOIN public.si_shippers sh ON sh.id = b.shipper_id AND sh.deleted_at IS NULL
     WHERE b.shipping_instruction_id = $1 AND b.deleted_at IS NULL
     ORDER BY b.line_order, b.id`,
    [siId]
  );
  return r.rows.map((row) => ({
    id: row.id,
    commodityId: row.commodity_id,
    commodityName: row.commodity_name,
    metricId: row.metric_id,
    metricCode: row.metric_code,
    metricLabel: row.metric_label,
    qty: row.qty != null ? Number(row.qty) : 0,
    contractNo: row.contract_no ?? null,
    poNo: row.po_no ?? null,
    soNo: row.so_no ?? null,
    remarks: row.remarks ?? null,
    shipperId: row.shipper_id ?? null,
    shipperName: row.shipper_name ?? null,
    lineOrder: row.line_order,
  }));
}

/** Validate breakdown rows; returns error string or null */
function validateBreakdownPayload(breakdown) {
  if (!Array.isArray(breakdown) || breakdown.length === 0) {
    return 'breakdown must be a non-empty array';
  }
  for (let i = 0; i < breakdown.length; i += 1) {
    const row = breakdown[i] || {};
    const cid = parseInt(row.commodity_id ?? row.commodityId, 10);
    const mid = parseInt(row.metric_id ?? row.metricId, 10);
    const qty = row.qty != null && row.qty !== '' ? Number(row.qty) : NaN;
    if (Number.isNaN(cid) || cid < 1) return `breakdown[${i}]: commodity_id required`;
    if (Number.isNaN(mid) || mid < 1) return `breakdown[${i}]: metric_id required`;
    if (Number.isNaN(qty) || qty < 0) return `breakdown[${i}]: qty must be a non-negative number`;
  }
  return null;
}

/** All breakdown lines must reference commodities with the same commodity_type (Solid | Liquid). */
async function validateBreakdownCommodityTypes(client, breakdown) {
  if (!Array.isArray(breakdown) || breakdown.length === 0) return null;
  const ids = [
    ...new Set(
      breakdown
        .map((row) => parseInt(row.commodity_id ?? row.commodityId, 10))
        .filter((id) => !Number.isNaN(id) && id > 0)
    ),
  ];
  if (ids.length === 0) return 'breakdown: valid commodity_id required';
  const r = await client.query(
    `SELECT id, commodity_type FROM public.si_commodities WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL`,
    [ids]
  );
  if (r.rows.length !== ids.length) {
    return 'breakdown: invalid or inactive commodity_id';
  }
  const types = [...new Set(r.rows.map((x) => x.commodity_type))];
  if (types.length > 1) {
    return 'All commodities on one shipping instruction must be the same type (Solid or Liquid).';
  }
  return null;
}

async function replaceBreakdown(client, siId, breakdown) {
  const typeErr = await validateBreakdownCommodityTypes(client, breakdown);
  if (typeErr) throw new Error(typeErr);
  await client.query(
    `UPDATE public.shipping_instruction_breakdown SET deleted_at = NOW(), updated_at = NOW()
     WHERE shipping_instruction_id = $1 AND deleted_at IS NULL`,
    [siId]
  );
  let ord = 0;
  for (const row of breakdown) {
    const cid = parseInt(row.commodity_id ?? row.commodityId, 10);
    const mid = parseInt(row.metric_id ?? row.metricId, 10);
    const qty = Number(row.qty);
    const sid = parseBreakdownShipperId(row);
    const cOk = await client.query(`SELECT 1 FROM public.si_commodities WHERE id = $1 AND deleted_at IS NULL`, [cid]);
    const mOk = await client.query(`SELECT 1 FROM public.metric WHERE id = $1 AND deleted_at IS NULL`, [mid]);
    if (cOk.rows.length === 0) throw new Error(`Invalid commodity_id ${cid}`);
    if (mOk.rows.length === 0) throw new Error(`Invalid metric_id ${mid}`);
    if (sid != null) {
      const sOk = await client.query(`SELECT 1 FROM public.si_shippers WHERE id = $1 AND deleted_at IS NULL`, [sid]);
      if (sOk.rows.length === 0) throw new Error(`Invalid shipper_id ${sid}`);
    }
    await client.query(
      `INSERT INTO public.shipping_instruction_breakdown (
         shipping_instruction_id, commodity_id, metric_id, qty, contract_no, po_no, so_no, remarks, shipper_id, line_order
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        siId,
        cid,
        mid,
        qty,
        row.contract_no != null ? String(row.contract_no).trim() || null : row.contractNo?.trim() || null,
        row.po_no != null ? String(row.po_no).trim() || null : row.poNo?.trim() || null,
        row.so_no != null ? String(row.so_no).trim() || null : row.soNo?.trim() || null,
        row.remarks != null ? String(row.remarks).trim() || null : null,
        sid,
        ord++,
      ]
    );
  }
}

function summarizeBreakdown(breakdownRows) {
  const r = Array.isArray(breakdownRows) ? breakdownRows : [];
  if (r.length === 0) return '—';
  return `${r.length} line(s)`;
}

function summarizeShippers(breakdownRows) {
  const names = [
    ...new Set(
      (Array.isArray(breakdownRows) ? breakdownRows : [])
        .map((b) => (b.shipperName || '').trim())
        .filter(Boolean)
    ),
  ];
  return names.length ? names.join(', ') : null;
}

function diffFields(before, after) {
  const changes = [];
  const add = (field, from, to) => {
    const f = from ?? null;
    const t = to ?? null;
    if (String(f ?? '') === String(t ?? '')) return;
    changes.push({ field, from: f, to: t });
  };
  add('Vessel', before.vesselName, after.vesselName);
  add('Reference', before.referenceNumber, after.referenceNumber);
  add('Purpose', before.purpose, after.purpose);
  add('Term', before.tradeTermCode, after.tradeTermCode);
  add('Preferred jetty', before.preferredJettyName, after.preferredJettyName);
  add('Shipper', summarizeShippers(before.breakdown), summarizeShippers(after.breakdown));
  add('Loading port', before.loadingPortName, after.loadingPortName);
  add('Surveyor', before.surveyorName, after.surveyorName);
  add('Agent', before.agentName, after.agentName);
  add('ETA From', before.etaFrom, after.etaFrom);
  add('ETA To', before.etaTo, after.etaTo);
  add('Note', before.note, after.note);
  add('Voyage', before.voyageNo, after.voyageNo);
  add('Destination', before.destinationText, after.destinationText);
  add('Freight terms', before.freightTerms, after.freightTerms);
  add('Bill of lading', before.billOfLadingClause, after.billOfLadingClause);
  add('Consignee', before.consigneeText, after.consigneeText);
  add('Notify party', before.notifyPartyText, after.notifyPartyText);
  add('BL indicated', before.blIndicated, after.blIndicated);
  add('Document date', before.documentDate, after.documentDate);
  add('Breakdown', summarizeBreakdown(before.breakdown), summarizeBreakdown(after.breakdown));
  return changes;
}

router.get('/', async (req, res) => {
  const selectedPortId = Number(req.selectedPortId);
  const { purpose, status } = req.query;
  let query = `${SI_SELECT} WHERE si.deleted_at IS NULL`;
  const params = [];
  let i = 1;
  query += ` AND COALESCE(spl.port_id, p.id) = $${i++}`;
  params.push(selectedPortId);
  if (purpose) {
    query += ` AND spp.code = $${i++}`;
    params.push(purpose);
  }
  if (status) {
    query += ` AND si.status = $${i++}`;
    params.push(status);
  }
  query += ` ORDER BY si.created_at DESC`;
  const result = await pool.query(query, params);
  res.json(result.rows.map(toSIList));
});

/**
 * Candidates list for Demurrage Risk Calculator.
 * Returns SIs within a date range (ETA overlap), plus linked operation (if any).
 *
 * Port scope (selected port from request context):
 * - COALESCE(spl.port_id, preferred_jetty.port_id) matches, OR
 * - a non-SAILED operation exists for this SI with operations.port_id matching (allocation path).
 * SIs without jetty are included when the linked plan's port_id matches the selected port (same as main SI list).
 *
 * Excludes SIs whose only operations are SAILED (so sailed voyages do not appear as "open").
 *
 * Berthing plan status (aligned with Allocation `getBerthingPlanStatus`):
 * - incoming: no operation row, OR shifting_out, OR (op exists, no TB, status not in at-berth set)
 * - berthed: op exists, not shifting_out, and (TB set OR status in DOCKED/IN_PROGRESS/POST_OPS/SIGNOFF_*)
 *
 * Query:
 * - from: ISO date or datetime (inclusive)
 * - to: ISO date or datetime (inclusive)
 * - include_incoming: '1'|'0' (default 1)
 * - include_berthed: '1'|'0' (default 1)
 */
router.get('/candidates', async (req, res) => {
  const selectedPortId = Number(req.selectedPortId);
  const {
    from,
    to,
    include_incoming = '1',
    include_berthed = '1',
  } = req.query || {};

  const fromDt = from ? new Date(String(from)) : null;
  const toDt = to ? new Date(String(to)) : null;
  if (fromDt && Number.isNaN(fromDt.getTime())) return res.status(400).json({ error: 'Invalid from' });
  if (toDt && Number.isNaN(toDt.getTime())) return res.status(400).json({ error: 'Invalid to' });

  const incIncoming = String(include_incoming) !== '0';
  const incBerthed = String(include_berthed) !== '0';
  if (!incIncoming && !incBerthed) return res.json([]);

  let query = `
    SELECT
      si.id,
      si.reference_number,
      spl.vessel_name,
      spp.code AS purpose,
      si.status AS si_status,
      si.eta_from,
      si.eta_to,
      ${COMMODITY_DISPLAY} AS commodity_display,
      o.id AS operation_id,
      o.status AS operation_status,
      o.docking_start_time,
      o.estimated_completion_time,
      si.created_at,
      oj.name AS operation_jetty_name,
      CASE
        WHEN o.id IS NULL THEN 'incoming'
        WHEN COALESCE(o.shifting_out, false) THEN 'incoming'
        WHEN o.tb IS NOT NULL
          OR UPPER(TRIM(COALESCE(o.status, ''))) IN (
            'DOCKED', 'IN_PROGRESS', 'POST_OPS', 'SIGNOFF_REQUESTED', 'SIGNOFF_APPROVED'
          )
          THEN 'berthed'
        ELSE 'incoming'
      END AS berthing_plan_status
    FROM shipping_instructions si
    LEFT JOIN shipment_plans spl ON spl.id = si.shipment_plan_id AND spl.deleted_at IS NULL
    LEFT JOIN si_purposes spp ON spp.id = spl.purpose_id AND spp.deleted_at IS NULL
    LEFT JOIN jetties j ON j.id = spl.jetty_id AND j.deleted_at IS NULL
    LEFT JOIN ports p ON p.id = COALESCE(spl.port_id, j.port_id) AND p.deleted_at IS NULL
    LEFT JOIN operations o ON o.shipping_instruction_id = si.id AND o.deleted_at IS NULL AND o.status <> 'SAILED'
    LEFT JOIN jetties oj ON oj.id = o.jetty_id AND oj.deleted_at IS NULL
    WHERE si.deleted_at IS NULL
      AND (
        COALESCE(spl.port_id, p.id) = $1
        OR EXISTS (
          SELECT 1 FROM operations o_port
          WHERE o_port.shipping_instruction_id = si.id
            AND o_port.deleted_at IS NULL
            AND o_port.status <> 'SAILED'
            AND o_port.port_id = $1
        )
      )
      AND (
        NOT EXISTS (
          SELECT 1 FROM operations o_any
          WHERE o_any.shipping_instruction_id = si.id AND o_any.deleted_at IS NULL
        )
        OR EXISTS (
          SELECT 1 FROM operations o_live
          WHERE o_live.shipping_instruction_id = si.id
            AND o_live.deleted_at IS NULL
            AND o_live.status <> 'SAILED'
        )
      )
  `;
  const params = [selectedPortId];
  let i = 2;

  // ETA overlap filter: [eta_from, eta_to] overlaps [from, to]
  if (fromDt) {
    query += ` AND (si.eta_to IS NULL OR si.eta_to >= $${i++})`;
    params.push(fromDt);
  }
  if (toDt) {
    query += ` AND (si.eta_from IS NULL OR si.eta_from <= $${i++})`;
    params.push(toDt);
  }

  const planIncomingSql = `(
      o.id IS NULL
      OR COALESCE(o.shifting_out, false) = true
      OR (
        o.id IS NOT NULL
        AND o.tb IS NULL
        AND UPPER(TRIM(COALESCE(o.status, ''))) NOT IN (
          'DOCKED', 'IN_PROGRESS', 'POST_OPS', 'SIGNOFF_REQUESTED', 'SIGNOFF_APPROVED'
        )
      )
    )`;
  const planBerthedSql = `(
      o.id IS NOT NULL
      AND COALESCE(o.shifting_out, false) = false
      AND (
        o.tb IS NOT NULL
        OR UPPER(TRIM(COALESCE(o.status, ''))) IN (
          'DOCKED', 'IN_PROGRESS', 'POST_OPS', 'SIGNOFF_REQUESTED', 'SIGNOFF_APPROVED'
        )
      )
    )`;

  if (!incIncoming) {
    query += ` AND ${planBerthedSql}`;
  } else if (!incBerthed) {
    query += ` AND ${planIncomingSql}`;
  }

  query += ` ORDER BY COALESCE(si.eta_from, si.created_at) DESC, si.id DESC LIMIT 300`;
  const result = await pool.query(query, params);
  res.json(
    result.rows.map((r) => ({
      siId: r.id,
      referenceNumber: r.reference_number,
      vesselName: r.vessel_name,
      purpose: r.purpose,
      siStatus: r.si_status,
      etaFrom: r.eta_from ?? null,
      etaTo: r.eta_to ?? null,
      commodity: r.commodity_display ?? r.commodity ?? null,
      berthingPlanStatus: r.berthing_plan_status === 'berthed' ? 'berthed' : 'incoming',
      jettyName: r.operation_jetty_name ?? null,
      operation: r.operation_id
        ? {
            id: r.operation_id,
            status: r.operation_status ?? null,
            dockingStartTime: r.docking_start_time ?? null,
            estimatedCompletionTime: r.estimated_completion_time ?? null,
          }
        : null,
    }))
  );
});

/**
 * Master NPWP for the selected port (or ?port_id= if user has access to that port).
 * Used by SI form (read-only), SI View, SI Approval.
 */
router.get('/npwp-master', async (req, res) => {
  const selectedPortId = Number(req.selectedPortId);
  let portId = selectedPortId;
  const raw = req.query.port_id;
  if (raw != null && raw !== '') {
    const pid = parseInt(String(raw), 10);
    if (!Number.isNaN(pid)) {
      const allowed = Array.isArray(req.assignedPortIds) && req.assignedPortIds.includes(pid);
      if (!allowed) {
        return res.status(403).json({ error: 'Selected port is not assigned to this user' });
      }
      portId = pid;
    }
  }
  const r = await pool.query(
    `SELECT npwp FROM si_port_npwp WHERE port_id = $1 AND deleted_at IS NULL`,
    [portId]
  );
  res.json({ npwp: r.rows[0]?.npwp ?? null, portId });
});

router.get('/:id', async (req, res) => {
  const selectedPortId = Number(req.selectedPortId);
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const result = await pool.query(`${SI_SELECT} WHERE si.id = $1 AND si.deleted_at IS NULL`, [id]);
  if (result.rows.length === 0) return res.status(404).json({ error: 'Shipping instruction not found' });
  const row = result.rows[0];
  if (row.preferred_port_id != null && Number(row.preferred_port_id) !== selectedPortId) {
    return res.status(404).json({ error: 'Shipping instruction not found' });
  }
  const breakdown = await loadBreakdown(id);
  const docRes = await pool.query(
    `SELECT id, original_name, mime_type, size_bytes
     FROM shipping_instruction_documents
     WHERE shipping_instruction_id = $1 AND deleted_at IS NULL
     ORDER BY created_at ASC, id ASC`,
    [id]
  );
  const opRes = await pool.query(
    `SELECT
       o.id,
       o.status,
       o.eta,
       o.etb,
       o.tb,
       o.estimated_completion_time,
       o.actual_completion_time,
       o.updated_at
     FROM operations o
     WHERE o.shipping_instruction_id = $1
       AND o.deleted_at IS NULL
     ORDER BY
       CASE WHEN UPPER(TRIM(COALESCE(o.status, ''))) = 'SAILED' THEN 1 ELSE 0 END ASC,
       o.updated_at DESC,
       o.id DESC
     LIMIT 1`,
    [id]
  );
  const op = opRes.rows[0] || null;
  res.json({
    ...toSIList(row),
    breakdown,
    documents: docRes.rows.map((d) => ({
      id: d.id,
      documentId: d.id,
      name: d.original_name,
      mimeType: d.mime_type,
      sizeBytes: d.size_bytes != null ? Number(d.size_bytes) : null,
      downloadUrl: `/api/v1/si-documents/${d.id}/download`,
    })),
    operationId: op?.id ?? null,
    operationStatus: op?.status ?? null,
    etaDateTime: op?.eta ?? null,
    etbDateTime: op?.etb ?? null,
    tbDateTime: op?.tb ?? null,
    estimatedCompletionDateTime: op?.estimated_completion_time ?? null,
    actualCompletionDateTime: op?.actual_completion_time ?? null,
  });
});

router.post('/', requireAuth, async (req, res) => {
  const selectedPortId = Number(req.selectedPortId);
  const b = req.body || {};
  if (rejectHeaderShipperId(b, res)) return;
  const {
    shipment_plan_id: shipment_plan_id_raw,
    reference_number,
    vessel_name,
    voyage_no,
    trade_term_id,
    purpose,
    purpose_id,
    eta,
    eta_from,
    eta_to,
    status,
    approval_id,
    preferred_jetty_id,
    loading_port_id,
    surveyor_id,
    agent_id,
    note,
    breakdown,
    destination_text,
    freight_terms,
    bill_of_lading_clause,
    consignee_text,
    notify_party_text,
    bl_split_text,
    bl_indicated,
    document_date,
  } = b;

  if (!reference_number || typeof reference_number !== 'string' || !reference_number.trim()) {
    return res.status(400).json({ error: 'reference_number is required (Shipping Instructions No.)' });
  }

  let shipmentPlanIdFromBody = null;
  /** @type {{ id: number, approval_status: string, vessel_name: string, eta: Date | null, purpose_id: number | null, voyage_no: string | null } | null} */
  let planRowForLink = null;
  if (shipment_plan_id_raw != null && shipment_plan_id_raw !== '') {
    const pid = parseInt(shipment_plan_id_raw, 10);
    if (Number.isNaN(pid)) {
      return res.status(400).json({ error: 'Invalid shipment_plan_id' });
    }
    const pr = await pool.query(
      `SELECT id, approval_status, vessel_name, eta, purpose_id, voyage_no, agent_id
       FROM shipment_plans WHERE id = $1 AND port_id = $2 AND deleted_at IS NULL`,
      [pid, selectedPortId]
    );
    if (pr.rows.length === 0) {
      return res.status(400).json({ error: 'shipment_plan_id not found for selected port' });
    }
    const pst = pr.rows[0].approval_status;
    if (pst !== 'Draft' && pst !== 'Rejected') {
      return res.status(400).json({
        error: 'New shipping instructions can only be linked to a plan in Draft or Rejected approval state',
      });
    }
    planRowForLink = pr.rows[0];
    shipmentPlanIdFromBody = pid;
  }

  let bodyAgentParsed =
    agent_id != null && agent_id !== '' ? parseInt(agent_id, 10) : null;
  if (bodyAgentParsed != null && Number.isNaN(bodyAgentParsed)) bodyAgentParsed = null;
  const planAgentForInsert =
    planRowForLink?.agent_id != null ? Number(planRowForLink.agent_id) : null;
  const insertAgentId =
    shipmentPlanIdFromBody != null && planRowForLink
      ? bodyAgentParsed ?? planAgentForInsert
      : bodyAgentParsed;

  const vesselForSi =
    (planRowForLink?.vessel_name && String(planRowForLink.vessel_name).trim()) ||
    (typeof vessel_name === 'string' && vessel_name.trim() ? vessel_name.trim() : '');
  if (!vesselForSi) {
    return res.status(400).json({ error: 'vessel_name is required' });
  }

  let etaFromIn = eta_from != null && eta_from !== '' ? String(eta_from).trim() : '';
  let etaToIn = eta_to != null && eta_to !== '' ? String(eta_to).trim() : '';
  let documentDateIn =
    document_date != null && document_date !== '' ? String(document_date).trim().slice(0, 10) : '';

  if (shipmentPlanIdFromBody != null && planRowForLink) {
    if (!planRowForLink.eta || Number.isNaN(new Date(planRowForLink.eta).getTime())) {
      return res.status(400).json({ error: 'Shipment plan must have an ETA before adding shipping instructions' });
    }
    if (planRowForLink.purpose_id == null) {
      return res.status(400).json({ error: 'Shipment plan must have a purpose before adding shipping instructions' });
    }
    const planEta = new Date(planRowForLink.eta);
    const ymd = planEta.toISOString().slice(0, 10);
    etaFromIn = ymd;
    etaToIn = ymd;
    if (!documentDateIn) documentDateIn = ymd;
  } else {
    if (!etaFromIn) return res.status(400).json({ error: 'eta_from is required' });
    if (!etaToIn) return res.status(400).json({ error: 'eta_to is required' });
  }
  if (!documentDateIn) {
    return res.status(400).json({ error: 'document_date is required' });
  }

  const ft = normalizeFreightTerms(freight_terms);
  if (ft?.error) return res.status(400).json({ error: ft.error });

  const bdErr = validateBreakdownPayload(breakdown);
  if (bdErr) return res.status(400).json({ error: bdErr });

  let purposeVal = purpose;
  let purposeIdVal = purpose_id != null ? parseInt(purpose_id, 10) : null;

  if (shipmentPlanIdFromBody != null && planRowForLink) {
    purposeIdVal = Number(planRowForLink.purpose_id);
    const prp = await pool.query(`SELECT code FROM si_purposes WHERE id = $1 AND deleted_at IS NULL`, [purposeIdVal]);
    if (prp.rows.length === 0) return res.status(400).json({ error: 'Invalid purpose_id on shipment plan' });
    purposeVal = prp.rows[0].code;
  } else if (purposeIdVal && !Number.isNaN(purposeIdVal)) {
    const pr = await pool.query(`SELECT code FROM si_purposes WHERE id = $1 AND deleted_at IS NULL`, [
      purposeIdVal,
    ]);
    if (pr.rows.length === 0) return res.status(400).json({ error: 'Invalid purpose_id' });
    purposeVal = pr.rows[0].code;
  } else if (!purpose || !['Loading', 'Unloading'].includes(purpose)) {
    return res.status(400).json({ error: 'purpose must be Loading or Unloading, or provide valid purpose_id' });
  } else {
    const pr = await pool.query(`SELECT id FROM si_purposes WHERE code = $1 AND deleted_at IS NULL`, [purpose]);
    purposeIdVal = pr.rows[0]?.id ?? null;
  }

  const fkErr = await validateSiFks({
    trade_term_id,
    purpose_id: purposeIdVal,
    preferred_jetty_id,
    loading_port_id,
    surveyor_id,
    agent_id: insertAgentId,
  });
  if (fkErr) return res.status(400).json(fkErr);
  if (preferred_jetty_id != null && preferred_jetty_id !== '') {
    const preferredJettyId = parseInt(preferred_jetty_id, 10);
    const portMatch = await pool.query(
      `SELECT 1 FROM jetties WHERE id = $1 AND port_id = $2 AND deleted_at IS NULL`,
      [preferredJettyId, selectedPortId]
    );
    if (portMatch.rows.length === 0) {
      return res.status(400).json({ error: 'preferred_jetty_id is not in selected port' });
    }
  }

  let statusVal = status && ['Draft', 'Submitted', 'Approved'].includes(status) ? status : 'Draft';
  if (statusVal === 'Approved') {
    return res.status(400).json({ error: 'New shipping instructions cannot be created as Approved' });
  }

  const preferredJettyIdParsed =
    preferred_jetty_id != null && preferred_jetty_id !== '' ? parseInt(preferred_jetty_id, 10) : null;
  const voyageForSi =
    shipmentPlanIdFromBody != null && planRowForLink
      ? trimText(planRowForLink.voyage_no, 64)
      : trimText(voyage_no, 64);
  const etaInstant =
    shipmentPlanIdFromBody != null && planRowForLink?.eta
      ? new Date(planRowForLink.eta)
      : eta
        ? new Date(eta)
        : etaFromIn
          ? new Date(`${etaFromIn}T12:00:00Z`)
          : null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let shipmentPlanId;
    if (shipmentPlanIdFromBody != null) {
      shipmentPlanId = shipmentPlanIdFromBody;
      const voyageOverride =
        voyage_no != null && String(voyage_no).trim() !== '' ? trimText(voyage_no, 64) : null;
      const aid = typeof approval_id === 'string' ? approval_id.trim() || null : null;
      await client.query(
        `UPDATE shipment_plans SET
           vessel_name = COALESCE(NULLIF(TRIM($1::text), ''), vessel_name),
           voyage_no = COALESCE($2, voyage_no),
           jetty_id = COALESCE($3, jetty_id),
           approval_id = COALESCE(NULLIF(TRIM($4::text), ''), approval_id),
           updated_at = NOW()
         WHERE id = $5 AND port_id = $6 AND deleted_at IS NULL`,
        [
          typeof vessel_name === 'string' ? vessel_name : '',
          voyageOverride,
          preferredJettyIdParsed,
          aid ?? '',
          shipmentPlanId,
          selectedPortId,
        ]
      );
    } else {
      const planIns = await client.query(
        `INSERT INTO shipment_plans (port_id, vessel_name, jetty_id, eta, purpose_id, voyage_no, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         RETURNING id`,
        [
          selectedPortId,
          vessel_name.trim(),
          preferredJettyIdParsed,
          etaInstant,
          purposeIdVal,
          trimText(voyage_no, 64),
        ]
      );
      shipmentPlanId = planIns.rows[0].id;
      const ref = `SP-${String(shipmentPlanId).padStart(5, '0')}`;
      await client.query(`UPDATE shipment_plans SET plan_reference = COALESCE(plan_reference, $1) WHERE id = $2`, [
        ref,
        shipmentPlanId,
      ]);
      const aid = typeof approval_id === 'string' ? approval_id.trim() || null : null;
      if (aid) {
        await client.query(`UPDATE shipment_plans SET approval_id = $1, updated_at = NOW() WHERE id = $2`, [
          aid,
          shipmentPlanId,
        ]);
      }
    }

    const result = await client.query(
      `INSERT INTO shipping_instructions (
         reference_number, commodity, trade_term_id, eta_from, eta_to, status,
         destination_text, freight_terms, bill_of_lading_clause, consignee_text, notify_party_text, bl_split_text, bl_indicated, document_date,
         loading_port_id, surveyor_id, agent_id, note,
         shipment_plan_id
       ) VALUES ($1,NULL,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING id`,
      [
        reference_number?.trim() ?? null,
        trade_term_id != null && trade_term_id !== '' ? parseInt(trade_term_id, 10) : null,
        etaFromIn ? String(etaFromIn).slice(0, 10) : null,
        etaToIn ? String(etaToIn).slice(0, 10) : etaFromIn ? String(etaFromIn).slice(0, 10) : null,
        statusVal,
        trimText(destination_text, 4000),
        ft?.value ?? null,
        trimText(bill_of_lading_clause, 4000),
        trimText(consignee_text, 4000),
        trimText(notify_party_text, 4000),
        trimText(bl_split_text, 4000),
        trimText(bl_indicated, 4000),
        documentDateIn,
        loading_port_id != null && loading_port_id !== '' ? parseInt(loading_port_id, 10) : null,
        surveyor_id != null && surveyor_id !== '' ? parseInt(surveyor_id, 10) : null,
        insertAgentId,
        typeof note === 'string' ? note.trim() || null : null,
        shipmentPlanId,
      ]
    );
    const newId = result.rows[0].id;
    await replaceBreakdown(client, newId, breakdown);
    await client.query('COMMIT');
    const row = await pool.query(`${SI_SELECT} WHERE si.id = $1`, [newId]);
    const bd = await loadBreakdown(newId);
    const response = { ...toSIList(row.rows[0]), breakdown: bd };
    // Best-effort activity log (append-only)
    writeActivityLog({
      pageKey: 'shipment-plan',
      action: 'add',
      entityType: 'Shipping Instruction',
      entityId: newId,
      entityLabel: response.referenceNumber || `SI-${newId}`,
      summary: 'Created Draft SI',
      changes: [
        { field: 'Vessel', from: null, to: response.vesselName },
        { field: 'Purpose', from: null, to: response.purpose },
        { field: 'Breakdown', from: null, to: summarizeBreakdown(response.breakdown) },
      ],
      actorUserId: req.userId ?? null,
    }).catch(() => {});
    res.status(201).json(response);
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.message?.startsWith('Invalid')) return res.status(400).json({ error: e.message });
    if (
      e.message?.includes('All commodities on one shipping instruction') ||
      e.message?.includes('breakdown:')
    ) {
      return res.status(400).json({ error: e.message });
    }
    throw e;
  } finally {
    client.release();
  }
});

router.put('/:id', requireAuth, async (req, res) => {
  const selectedPortId = Number(req.selectedPortId);
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const b = req.body || {};
  if (rejectHeaderShipperId(b, res)) return;
  const {
    reference_number,
    vessel_name,
    voyage_no,
    trade_term_id,
    purpose,
    purpose_id,
    eta,
    eta_from,
    eta_to,
    status,
    approval_id,
    preferred_jetty_id,
    loading_port_id,
    surveyor_id,
    agent_id,
    note,
    breakdown,
    destination_text,
    freight_terms,
    bill_of_lading_clause,
    consignee_text,
    notify_party_text,
    bl_split_text,
    bl_indicated,
    document_date,
  } = b;

  const ftIn = normalizeFreightTerms(freight_terms);
  if (ftIn?.error) return res.status(400).json({ error: ftIn.error });

  const cur = await pool.query(`${SI_SELECT} WHERE si.id = $1 AND si.deleted_at IS NULL`, [id]);
  if (cur.rows.length === 0) return res.status(404).json({ error: 'Shipping instruction not found' });
  const beforeRow = cur.rows[0];
  if (beforeRow.preferred_port_id != null && Number(beforeRow.preferred_port_id) !== selectedPortId) {
    return res.status(404).json({ error: 'Shipping instruction not found' });
  }
  const beforeBd = await loadBreakdown(id);

  let planRowBound = null;
  if (beforeRow.shipment_plan_id != null) {
    const prPlan = await pool.query(
      `SELECT vessel_name, eta, purpose_id, voyage_no, jetty_id, approval_id, approved_at, approved_by_user_id, agent_id
       FROM shipment_plans WHERE id = $1 AND port_id = $2 AND deleted_at IS NULL`,
      [beforeRow.shipment_plan_id, selectedPortId]
    );
    planRowBound = prPlan.rows[0] ?? null;
  }

  if (beforeRow.shipment_plan_id == null) {
    return res.status(400).json({
      error: 'Shipping instruction must be linked to a shipment plan before it can be updated',
    });
  }

  if (!vessel_name || typeof vessel_name !== 'string' || !vessel_name.trim()) {
    if (!(planRowBound?.vessel_name && String(planRowBound.vessel_name).trim())) {
      return res.status(400).json({ error: 'vessel_name is required' });
    }
  }

  let purposeVal = purpose ?? beforeRow.purpose;
  let purposeIdVal = purpose_id != null ? parseInt(purpose_id, 10) : beforeRow.purpose_id;

  if (planRowBound?.purpose_id != null) {
    purposeIdVal = Number(planRowBound.purpose_id);
    const prp = await pool.query(`SELECT code FROM si_purposes WHERE id = $1 AND deleted_at IS NULL`, [
      purposeIdVal,
    ]);
    if (prp.rows.length === 0) return res.status(400).json({ error: 'Invalid purpose_id on shipment plan' });
    purposeVal = prp.rows[0].code;
  } else if (purpose_id != null && purpose_id !== '') {
    const pr = await pool.query(`SELECT code FROM si_purposes WHERE id = $1 AND deleted_at IS NULL`, [
      parseInt(purpose_id, 10),
    ]);
    if (pr.rows.length === 0) return res.status(400).json({ error: 'Invalid purpose_id' });
    purposeVal = pr.rows[0].code;
    purposeIdVal = parseInt(purpose_id, 10);
  } else if (purpose && !['Loading', 'Unloading'].includes(purpose)) {
    return res.status(400).json({ error: 'purpose must be Loading or Unloading' });
  } else if (purpose) {
    const pr = await pool.query(`SELECT id FROM si_purposes WHERE code = $1 AND deleted_at IS NULL`, [purpose]);
    purposeIdVal = pr.rows[0]?.id ?? purposeIdVal;
  }

  if (purposeVal && !['Loading', 'Unloading'].includes(purposeVal)) {
    return res.status(400).json({ error: 'purpose must be Loading or Unloading' });
  }

  const fkErr = await validateSiFks({
    trade_term_id,
    purpose_id: purposeIdVal,
    preferred_jetty_id,
    loading_port_id,
    surveyor_id,
    agent_id: planRowBound?.agent_id != null ? Number(planRowBound.agent_id) : null,
  });
  if (fkErr) return res.status(400).json(fkErr);
  const preferredJettyIdForScope =
    preferred_jetty_id != null && preferred_jetty_id !== ''
      ? parseInt(preferred_jetty_id, 10)
      : beforeRow.preferred_jetty_id != null
        ? parseInt(beforeRow.preferred_jetty_id, 10)
        : null;
  if (preferredJettyIdForScope != null && Number.isFinite(preferredJettyIdForScope)) {
    const portMatch = await pool.query(
      `SELECT 1 FROM jetties WHERE id = $1 AND port_id = $2 AND deleted_at IS NULL`,
      [preferredJettyIdForScope, selectedPortId]
    );
    if (portMatch.rows.length === 0) {
      return res.status(400).json({ error: 'preferred_jetty_id is not in selected port' });
    }
  }

  if (breakdown !== undefined) {
    const bdErr = validateBreakdownPayload(breakdown);
    if (bdErr) return res.status(400).json({ error: bdErr });
  }

  const requestedStatus =
    status !== undefined && status !== null && ['Draft', 'Submitted', 'Approved'].includes(String(status))
      ? String(status)
      : beforeRow.status;
  const transitioningToApproved = requestedStatus === 'Approved' && beforeRow.status !== 'Approved';

  if (transitioningToApproved) {
    const ok = await userHasPageApprove(req.userId, SI_APPROVE_PAGE_KEY);
    if (!ok) {
      return res.status(403).json({ error: 'Forbidden: shipping instruction approval permission required' });
    }
    if (beforeRow.status !== 'Submitted') {
      return res.status(400).json({ error: 'Shipping instruction must be Submitted before approval' });
    }
  }

  let nextApprovalId = beforeRow.approval_id ?? null;
  let nextApprovedBy = beforeRow.approved_by_user_id ?? null;
  let nextApprovedAt = beforeRow.approved_at ?? null;
  let nextApproverName = beforeRow.approver_name_snapshot ?? null;
  let nextApproverTitle = beforeRow.approver_title_snapshot ?? null;

  if (transitioningToApproved) {
    const uid = req.userId;
    const urow = await pool.query(
      `SELECT display_name, username, job_title FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [uid]
    );
    const ur = urow.rows[0];
    nextApproverName = ur?.display_name?.trim() || ur?.username || '—';
    nextApproverTitle = ur?.job_title?.trim() || 'OPERATION HEAD';
    nextApprovedBy = uid;
    nextApprovedAt = new Date();
    const incomingId = typeof approval_id === 'string' ? approval_id.trim() : '';
    nextApprovalId = incomingId || generateApprovalId();
  } else if (requestedStatus === 'Approved' && beforeRow.status === 'Approved') {
    const incomingId = typeof approval_id === 'string' ? approval_id.trim() : '';
    if (incomingId) nextApprovalId = incomingId;
  } else if (typeof approval_id === 'string' && approval_id.trim()) {
    nextApprovalId = approval_id.trim();
  }

  const freightVal = freight_terms !== undefined ? ftIn?.value ?? null : beforeRow.freight_terms;

  function optInt(v, beforeVal) {
    if (v === undefined) return beforeVal;
    if (v === null || v === '') return null;
    const n = parseInt(v, 10);
    return Number.isNaN(n) ? beforeVal : n;
  }

  const nextRef =
    reference_number !== undefined ? reference_number?.trim() || null : beforeRow.reference_number;
  const nextTradeTermId = optInt(trade_term_id, beforeRow.trade_term_id);
  const nextPreferredJetty = optInt(preferred_jetty_id, beforeRow.preferred_jetty_id);
  const nextLoadingPort = optInt(loading_port_id, beforeRow.loading_port_id);
  const nextSurveyor = optInt(surveyor_id, beforeRow.surveyor_id);
  const nextAgent =
    beforeRow.shipment_plan_id != null && planRowBound
      ? planRowBound.agent_id != null
        ? Number(planRowBound.agent_id)
        : null
      : optInt(agent_id, beforeRow.agent_id);
  const nextNote = note !== undefined ? (typeof note === 'string' ? note.trim() || null : null) : beforeRow.note;
  const nextBlSplitText =
    bl_split_text !== undefined ? trimText(bl_split_text, 4000) : beforeRow.bl_split_text;

  const nextEta =
    eta !== undefined || eta_from !== undefined
      ? eta
        ? new Date(eta)
        : eta_from
          ? new Date(`${eta_from}T12:00:00Z`)
          : null
      : beforeRow.eta;
  const nextEtaFrom =
    eta_from !== undefined
      ? eta_from
        ? String(eta_from).slice(0, 10)
        : null
      : beforeRow.eta_from;
  const nextEtaTo =
    eta_to !== undefined
      ? eta_to
        ? String(eta_to).slice(0, 10)
        : eta_from
          ? String(eta_from).slice(0, 10)
          : null
      : beforeRow.eta_to;
  let nextEtaFinal = nextEta;
  let nextEtaFromFinal = nextEtaFrom;
  let nextEtaToFinal = nextEtaTo;
  const etaTouchedInBody = eta !== undefined || eta_from !== undefined || eta_to !== undefined;
  if (!etaTouchedInBody && planRowBound?.eta && !Number.isNaN(new Date(planRowBound.eta).getTime())) {
    const ymd = new Date(planRowBound.eta).toISOString().slice(0, 10);
    nextEtaFinal = new Date(planRowBound.eta);
    nextEtaFromFinal = ymd;
    nextEtaToFinal = ymd;
  }
  const nextDocDate =
    document_date !== undefined
      ? document_date
        ? String(document_date).slice(0, 10)
        : null
      : beforeRow.document_date;
  const nextVoyageNo =
    voyage_no !== undefined && voyage_no !== null && String(voyage_no).trim() !== ''
      ? trimText(voyage_no, 64)
      : trimText(planRowBound?.voyage_no ?? beforeRow.voyage_no, 64);
  const nextVesselName =
    vessel_name && String(vessel_name).trim()
      ? String(vessel_name).trim()
      : String(planRowBound?.vessel_name || '').trim();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const planId = beforeRow.shipment_plan_id;
    if (planId != null) {
      await client.query(
        `UPDATE shipment_plans SET
           vessel_name = $1,
           eta = $2,
           voyage_no = $3,
           jetty_id = $4,
           purpose_id = $5,
           approval_id = $6,
           approved_at = $7,
           approved_by_user_id = $8,
           updated_at = NOW()
         WHERE id = $9 AND port_id = $10 AND deleted_at IS NULL`,
        [
          nextVesselName,
          nextEtaFinal,
          nextVoyageNo,
          nextPreferredJetty,
          purposeIdVal,
          nextApprovalId,
          nextApprovedAt,
          nextApprovedBy,
          planId,
          selectedPortId,
        ]
      );
    }
    const up = await client.query(
      `UPDATE shipping_instructions SET
         reference_number = $1,
         trade_term_id = $2,
         eta_from = $3,
         eta_to = $4,
         status = $5,
         destination_text = $6,
         freight_terms = $7,
         bill_of_lading_clause = $8,
         consignee_text = $9,
         notify_party_text = $10,
         bl_split_text = $11,
         bl_indicated = $12,
         document_date = $13,
         approver_name_snapshot = $14,
         approver_title_snapshot = $15,
         loading_port_id = $16,
         surveyor_id = $17,
         agent_id = $18,
         note = $19,
         updated_at = NOW()
       WHERE id = $20 AND deleted_at IS NULL`,
      [
        nextRef,
        nextTradeTermId,
        nextEtaFromFinal,
        nextEtaToFinal,
        requestedStatus,
        destination_text !== undefined ? trimText(destination_text, 4000) : beforeRow.destination_text,
        freightVal,
        bill_of_lading_clause !== undefined ? trimText(bill_of_lading_clause, 4000) : beforeRow.bill_of_lading_clause,
        consignee_text !== undefined ? trimText(consignee_text, 4000) : beforeRow.consignee_text,
        notify_party_text !== undefined ? trimText(notify_party_text, 4000) : beforeRow.notify_party_text,
        nextBlSplitText,
        bl_indicated !== undefined ? trimText(bl_indicated, 4000) : beforeRow.bl_indicated,
        nextDocDate,
        nextApproverName,
        nextApproverTitle,
        nextLoadingPort,
        nextSurveyor,
        nextAgent,
        nextNote,
        id,
      ]
    );
    if (up.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Shipping instruction not found' });
    }
    if (breakdown !== undefined) await replaceBreakdown(client, id, breakdown);
    await client.query('COMMIT');
    const row = await pool.query(`${SI_SELECT} WHERE si.id = $1`, [id]);
    const bd = await loadBreakdown(id);
    const response = { ...toSIList(row.rows[0]), breakdown: bd };
    const before = { ...toSIList(beforeRow), breakdown: beforeBd };
    const changes = diffFields(before, response);
    writeActivityLog({
      pageKey: 'shipment-plan',
      action: 'update',
      entityType: 'Shipping Instruction',
      entityId: id,
      entityLabel: response.referenceNumber || `SI-${id}`,
      summary: transitioningToApproved ? 'Approved Shipping Instruction' : 'Updated Shipping Instruction',
      changes: transitioningToApproved
        ? [...changes, { field: 'Approval ID', from: null, to: response.approvalId }]
        : changes,
      actorUserId: req.userId ?? null,
    }).catch(() => {});
    res.json(response);
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.message?.startsWith('Invalid')) return res.status(400).json({ error: e.message });
    if (
      e.message?.includes('All commodities on one shipping instruction') ||
      e.message?.includes('breakdown:')
    ) {
      return res.status(400).json({ error: e.message });
    }
    throw e;
  } finally {
    client.release();
  }
});

router.delete('/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const siCheck = await pool.query(
    `SELECT reference_number FROM shipping_instructions WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  if (siCheck.rows.length === 0) {
    return res.status(404).json({ error: 'Shipping instruction not found' });
  }
  const op = await pool.query(
    `SELECT 1 FROM operations WHERE shipping_instruction_id = $1 AND deleted_at IS NULL LIMIT 1`,
    [id]
  );
  if (op.rows.length > 0) {
    return res.status(409).json({ error: 'Cannot delete shipping instruction while operations reference it' });
  }
  const entityLabel = siCheck.rows[0].reference_number?.trim() || `SI-${id}`;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE public.shipping_instruction_breakdown SET deleted_at = NOW(), updated_at = NOW()
       WHERE shipping_instruction_id = $1 AND deleted_at IS NULL`,
      [id]
    );
    const del = await client.query(
      `UPDATE shipping_instructions SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
      [id]
    );
    if (del.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Shipping instruction not found' }); // race: row removed concurrently
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  writeActivityLog({
    pageKey: 'shipment-plan',
    action: 'delete',
    entityType: 'Shipping Instruction',
    entityId: id,
    entityLabel,
    summary: 'Deleted Shipping Instruction',
    changes: [],
    actorUserId: req.userId ?? null,
  }).catch(() => {});
  res.status(204).send();
});

function toSIList(row) {
  return {
    id: row.id,
    referenceNumber: row.reference_number ?? null,
    vesselName: row.vessel_name,
    voyageNo: row.voyage_no ?? null,
    commodity: row.commodity_display ?? null,
    commodityId: null,
    tradeTermId: row.trade_term_id ?? null,
    tradeTermCode: row.trade_term_code ?? null,
    purpose: row.purpose_code ?? row.purpose,
    purposeId: row.purpose_id ?? null,
    eta: row.eta ?? null,
    etaFrom: row.eta_from ?? null,
    etaTo: row.eta_to ?? null,
    status: row.status,
    approvalId: row.approval_id ?? null,
    destinationText: row.destination_text ?? null,
    freightTerms: row.freight_terms ?? null,
    billOfLadingClause: row.bill_of_lading_clause ?? null,
    blSplitText: row.bl_split_text ?? null,
    consigneeText: row.consignee_text ?? null,
    notifyPartyText: row.notify_party_text ?? null,
    blIndicated: row.bl_indicated ?? null,
    documentDate: row.document_date ?? null,
    approvedByUserId: row.approved_by_user_id ?? null,
    approvedAt: row.approved_at ?? null,
    approverNameSnapshot: row.approver_name_snapshot ?? null,
    approverTitleSnapshot: row.approver_title_snapshot ?? null,
    approverDisplayName: row.approver_display_name ?? row.approver_username ?? null,
    note: row.note ?? null,
    preferredJettyId: row.preferred_jetty_id ?? null,
    preferredJettyName: row.preferred_jetty_name ?? null,
    shipperNames: row.shipper_names ?? null,
    loadingPortId: row.loading_port_id ?? null,
    loadingPortName: row.loading_port_name ?? null,
    surveyorId: row.surveyor_id ?? null,
    surveyorName: row.surveyor_name ?? null,
    agentId: row.agent_id ?? null,
    agentName: row.agent_name ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedPortId: row.preferred_port_id != null ? Number(row.preferred_port_id) : null,
    shipmentPlanId: row.shipment_plan_id != null ? Number(row.shipment_plan_id) : null,
  };
}

export default router;
