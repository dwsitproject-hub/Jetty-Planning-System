/**
 * Shipment Plan aggregate routes (multi-SI vessel call): list, shell CRUD, plan approval, depart.
 */
import express from 'express';
import { pool } from '../db.js';
import { writeActivityLog } from '../lib/activity-log.js';
import { departShipmentPlanInTransaction } from '../lib/shipment-plan-depart.js';
import { requireAuth } from '../middleware/auth.js';
import { userHasPageApprove, userHasPageDelete, userHasPageEdit } from '../middleware/permissions.js';
import { loadOperationJoined, toOp } from './operations.js';
import { getPublicAppBaseUrl, triggerNotificationDeferred } from '../lib/notifications.js';

const router = express.Router();
const PAGE_KEY = 'shipment-plan';

function buildPlanReference(planId) {
  const d = new Date();
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `SP-${yy}-${mm}-${String(planId).padStart(5, '0')}`;
}

/** @param {unknown} v */
function timestampToIso(v) {
  if (v == null || v === '') return null
  if (typeof v === 'string') return v
  if (typeof v.toISOString === 'function') return v.toISOString()
  return null
}

function parseSiBreakdownLiteJson(val) {
  if (val == null) return [];
  try {
    const arr = Array.isArray(val) ? val : typeof val === 'string' ? JSON.parse(val) : [];
    if (!Array.isArray(arr)) return [];
    return arr.map((r) => ({
      commodityId: r.commodity_id != null ? Number(r.commodity_id) : null,
      commodityName: r.commodity_name ?? null,
      commodityType: r.commodity_type ?? null,
      shipperId: r.shipper_id != null ? Number(r.shipper_id) : null,
      shipperName: r.shipper_name ?? null,
    }));
  } catch {
    return [];
  }
}

function parseSiChildrenJson(val) {
  if (val == null) return [];
  try {
    const arr = Array.isArray(val) ? val : typeof val === 'string' ? JSON.parse(val) : [];
    if (!Array.isArray(arr)) return [];
    return arr.map((r) => ({
      id: Number(r.id),
      referenceNumber: r.reference_number ?? null,
      vesselName: r.vessel_name ?? null,
      purpose: r.purpose ?? null,
      status: r.status ?? null,
      etaFrom: r.eta_from ?? null,
      etaTo: r.eta_to ?? null,
      loadingPortId: r.loading_port_id != null ? Number(r.loading_port_id) : null,
      breakdown: parseSiBreakdownLiteJson(r.breakdown),
    }));
  } catch {
    return [];
  }
}

function toPlanListRow(row) {
  const shippingInstructions = parseSiChildrenJson(row.si_children_json);
  const siCount = row.si_count != null ? Number(row.si_count) : shippingInstructions.length;
  return {
    id: Number(row.id),
    portId: Number(row.port_id),
    planReference: row.plan_reference ?? null,
    vesselName: row.vessel_name,
    jettyId: row.jetty_id != null ? Number(row.jetty_id) : null,
    jettyName: row.jetty_name ?? null,
    eta: row.eta != null ? row.eta.toISOString?.() ?? row.eta : null,
    ta: timestampToIso(row.ta),
    etb: timestampToIso(row.etb),
    tb: timestampToIso(row.tb),
    dockingStartTime: timestampToIso(row.docking_start_time),
    pob: timestampToIso(row.pob),
    sob: timestampToIso(row.sob),
    estimatedCompletionTime: timestampToIso(row.estimated_completion_time),
    actualCompletionTime: timestampToIso(row.actual_completion_time),
    castOffAt: timestampToIso(row.cast_off_at),
    sailedAt: timestampToIso(row.sailed_at),
    purposeId: row.purpose_id != null ? Number(row.purpose_id) : null,
    purposeCode: row.purpose_code ?? null,
    voyageNo: row.voyage_no ?? null,
    agentId: row.agent_id != null ? Number(row.agent_id) : null,
    agentName: row.agent_name ?? null,
    approvalStatus: row.approval_status,
    siCount,
    shippingInstructions,
    submittedAt: row.submitted_at != null ? row.submitted_at.toISOString?.() ?? row.submitted_at : null,
    approvedAt: row.approved_at != null ? row.approved_at.toISOString?.() ?? row.approved_at : null,
    rejectedAt: row.rejected_at != null ? row.rejected_at.toISOString?.() ?? row.rejected_at : null,
    rejectionReason: row.rejection_reason ?? null,
    createdAt: row.created_at != null ? row.created_at.toISOString?.() ?? row.created_at : null,
    updatedAt: row.updated_at != null ? row.updated_at.toISOString?.() ?? row.updated_at : null,
  };
}

function parseSiBreakdownJson(val) {
  if (val == null) return [];
  try {
    const arr = Array.isArray(val) ? val : typeof val === 'string' ? JSON.parse(val) : [];
    if (!Array.isArray(arr)) return [];
    return arr.map((r) => ({
      commodityName: r.commodity_name ?? null,
      qty: r.qty != null ? Number(r.qty) : null,
      metricCode: r.metric_code ?? null,
      contractNo: r.contract_no ?? null,
      poNo: r.po_no ?? null,
      soNo: r.so_no ?? null,
      remarks: r.remarks ?? null,
      shipperId: r.shipper_id != null ? Number(r.shipper_id) : null,
      shipperName: r.shipper_name ?? null,
    }));
  } catch {
    return [];
  }
}

function toSiChildRow(row) {
  const breakdown = parseSiBreakdownJson(row.breakdown_json);
  return {
    id: Number(row.id),
    referenceNumber: row.reference_number ?? null,
    vesselName: row.vessel_name,
    commodity: row.commodity ?? null,
    purpose: row.purpose,
    status: row.status,
    eta: row.eta != null ? row.eta.toISOString?.() ?? row.eta : null,
    etaFrom: row.eta_from ?? null,
    etaTo: row.eta_to ?? null,
    loadingPortId: row.loading_port_id != null ? Number(row.loading_port_id) : null,
    breakdown,
  };
}

/** @param {import('pg').PoolClient} client */
async function loadPlan(client, planId, portId) {
  const r = await client.query(
    `SELECT sp.*, j.name AS jetty_name, u.display_name AS approver_display_name,
            spp.code AS purpose_code
     FROM shipment_plans sp
     LEFT JOIN jetties j ON j.id = sp.jetty_id AND j.deleted_at IS NULL
     LEFT JOIN users u ON u.id = sp.approved_by_user_id AND u.deleted_at IS NULL
     LEFT JOIN si_purposes spp ON spp.id = sp.purpose_id AND spp.deleted_at IS NULL
     WHERE sp.id = $1 AND sp.port_id = $2 AND sp.deleted_at IS NULL`,
    [planId, portId]
  );
  return r.rows[0] ?? null;
}

/** Keep child SI document ETA window aligned when plan ETA changes (vessel call lives on shipment_plans). */
async function syncChildShippingInstructions(planId, portId) {
  await pool.query(
    `UPDATE shipping_instructions si SET
       eta_from = CASE
         WHEN sp.eta IS NOT NULL THEN (sp.eta AT TIME ZONE 'UTC')::date
         ELSE si.eta_from
       END,
       eta_to = CASE
         WHEN sp.eta IS NOT NULL THEN (sp.eta AT TIME ZONE 'UTC')::date
         ELSE si.eta_to
       END,
       updated_at = NOW()
     FROM shipment_plans sp
     WHERE si.shipment_plan_id = sp.id AND sp.id = $1 AND sp.port_id = $2
       AND si.deleted_at IS NULL AND sp.deleted_at IS NULL`,
    [planId, portId]
  );
}

router.get('/', async (req, res) => {
  const selectedPortId = Number(req.selectedPortId);
  const { approval_status: approvalStatus, q, purpose_id: purposeIdRaw } = req.query;
  let sql = `
    SELECT sp.*, j.name AS jetty_name, spp.code AS purpose_code,
           agp.name AS agent_name,
           (SELECT COUNT(*)::int FROM shipping_instructions si
            WHERE si.shipment_plan_id = sp.id AND si.deleted_at IS NULL) AS si_count,
           (SELECT COALESCE(
              json_agg(
                json_build_object(
                  'id', si.id,
                  'reference_number', si.reference_number,
                  'status', si.status,
                  'purpose', spp.code,
                  'vessel_name', sp.vessel_name,
                  'eta_from', si.eta_from,
                  'eta_to', si.eta_to,
                  'loading_port_id', si.loading_port_id,
                  'breakdown', (
                    SELECT COALESCE(
                      json_agg(
                        json_build_object(
                          'commodity_id', c.id,
                          'commodity_name', c.name,
                          'commodity_type', c.commodity_type,
                          'shipper_id', b.shipper_id,
                          'shipper_name', sh.name
                        ) ORDER BY b.line_order
                      ),
                      '[]'::json
                    )
                    FROM shipping_instruction_breakdown b
                    JOIN si_commodities c ON c.id = b.commodity_id AND c.deleted_at IS NULL
                    LEFT JOIN si_shippers sh ON sh.id = b.shipper_id AND sh.deleted_at IS NULL
                    WHERE b.shipping_instruction_id = si.id AND b.deleted_at IS NULL
                  )
                ) ORDER BY si.id
              ),
              '[]'::json
            )
            FROM shipping_instructions si
            WHERE si.shipment_plan_id = sp.id AND si.deleted_at IS NULL
           ) AS si_children_json
    FROM shipment_plans sp
    LEFT JOIN jetties j ON j.id = sp.jetty_id AND j.deleted_at IS NULL
    LEFT JOIN si_purposes spp ON spp.id = sp.purpose_id AND spp.deleted_at IS NULL
    LEFT JOIN si_agents agp ON agp.id = sp.agent_id AND agp.deleted_at IS NULL
    WHERE sp.port_id = $1 AND sp.deleted_at IS NULL`;
  const params = [selectedPortId];
  let i = 2;
  if (approvalStatus && typeof approvalStatus === 'string') {
    const s = approvalStatus.trim();
    if (['Draft', 'Submitted', 'Approved', 'Rejected'].includes(s)) {
      sql += ` AND sp.approval_status = $${i++}`;
      params.push(s);
    }
  }
  if (q && typeof q === 'string' && q.trim()) {
    sql += ` AND sp.vessel_name ILIKE $${i++}`;
    params.push(`%${q.trim()}%`);
  }
  if (purposeIdRaw != null && purposeIdRaw !== '') {
    const pid = parseInt(String(purposeIdRaw), 10);
    if (!Number.isNaN(pid) && pid > 0) {
      sql += ` AND sp.purpose_id = $${i++}`;
      params.push(pid);
    }
  }
  const { start_date: startDate, end_date: endDate } = req.query;
  // Plans with eta IS NULL have not been scheduled yet; include them in any date-filtered
  // query so that Draft/Submitted plans without an ETA are always visible.
  if (startDate && typeof startDate === 'string' && startDate.trim()) {
    const d = new Date(startDate.trim());
    if (!Number.isNaN(d.getTime())) {
      sql += ` AND (sp.eta IS NULL OR sp.eta >= $${i++}::timestamptz)`;
      params.push(d.toISOString());
    }
  }
  if (endDate && typeof endDate === 'string' && endDate.trim()) {
    const d = new Date(endDate.trim());
    if (!Number.isNaN(d.getTime())) {
      d.setDate(d.getDate() + 1);
      sql += ` AND (sp.eta IS NULL OR sp.eta < $${i++}::timestamptz)`;
      params.push(d.toISOString());
    }
  }
  sql += ` ORDER BY sp.updated_at DESC NULLS LAST, sp.id DESC`;
  const result = await pool.query(sql, params);
  res.json(result.rows.map(toPlanListRow));
});

router.post('/', requireAuth, async (req, res) => {
  if (!(await userHasPageEdit(req.userId, PAGE_KEY))) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const selectedPortId = Number(req.selectedPortId);
  const b = req.body || {};
  const vesselName = typeof b.vessel_name === 'string' ? b.vessel_name.trim() : '';
  if (!vesselName) return res.status(400).json({ error: 'vessel_name is required' });

  let purposeId = null;
  if (b.purpose_id != null && b.purpose_id !== '') {
    purposeId = parseInt(b.purpose_id, 10);
    if (Number.isNaN(purposeId)) return res.status(400).json({ error: 'Invalid purpose_id' });
    const pm = await pool.query(`SELECT 1 FROM si_purposes WHERE id = $1 AND deleted_at IS NULL`, [purposeId]);
    if (pm.rows.length === 0) return res.status(400).json({ error: 'Invalid purpose_id' });
  } else {
    return res.status(400).json({ error: 'purpose_id is required' });
  }

  let jettyId = null;
  if (b.jetty_id != null && b.jetty_id !== '') {
    jettyId = parseInt(b.jetty_id, 10);
    if (Number.isNaN(jettyId)) return res.status(400).json({ error: 'Invalid jetty_id' });
    const jm = await pool.query(
      `SELECT 1 FROM jetties WHERE id = $1 AND port_id = $2 AND deleted_at IS NULL`,
      [jettyId, selectedPortId]
    );
    if (jm.rows.length === 0) return res.status(400).json({ error: 'jetty_id is not in selected port' });
  }

  let eta = null;
  if (b.eta != null && b.eta !== '') {
    eta = new Date(b.eta);
    if (Number.isNaN(eta.getTime())) return res.status(400).json({ error: 'Invalid eta' });
  } else {
    return res.status(400).json({ error: 'eta is required' });
  }

  const voyageNo =
    b.voyage_no != null && typeof b.voyage_no === 'string' && b.voyage_no.trim()
      ? b.voyage_no.trim().slice(0, 64)
      : null;

  let agentId = null;
  if (b.agent_id != null && b.agent_id !== '') {
    agentId = parseInt(b.agent_id, 10);
    if (Number.isNaN(agentId)) return res.status(400).json({ error: 'Invalid agent_id' });
    const am = await pool.query(`SELECT 1 FROM si_agents WHERE id = $1 AND deleted_at IS NULL`, [agentId]);
    if (am.rows.length === 0) return res.status(400).json({ error: 'Invalid agent_id' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ins = await client.query(
      `INSERT INTO shipment_plans (port_id, vessel_name, jetty_id, eta, purpose_id, voyage_no, agent_id, created_at, updated_at, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW(), $8)
       RETURNING id`,
      [selectedPortId, vesselName, jettyId, eta, purposeId, voyageNo, agentId, req.userId ?? null]
    );
    const planId = ins.rows[0].id;
    const ref = buildPlanReference(planId);
    await client.query(`UPDATE shipment_plans SET plan_reference = $1 WHERE id = $2`, [ref, planId]);
    await client.query('COMMIT');
    const row = await loadPlan(client, planId, selectedPortId);
    writeActivityLog({
      pageKey: PAGE_KEY,
      action: 'add',
      entityType: 'ShipmentPlan',
      entityId: String(planId),
      entityLabel: ref,
      summary: 'Created shipment plan (Draft)',
      changes: [
        { field: 'Vessel', from: null, to: vesselName },
        { field: 'Plan ref', from: null, to: ref },
      ],
      actorUserId: req.userId ?? null,
    }).catch(() => {});
    res.status(201).json(toPlanListRow({ ...row, si_count: 0, jetty_name: row.jetty_name }));
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});

router.get('/:id', async (req, res) => {
  const selectedPortId = Number(req.selectedPortId);
  const planId = parseInt(req.params.id, 10);
  if (Number.isNaN(planId)) return res.status(400).json({ error: 'Invalid id' });

  const plan = await loadPlan(pool, planId, selectedPortId);
  if (!plan) return res.status(404).json({ error: 'Shipment plan not found' });

  const sis = await pool.query(
    `SELECT si.id, si.reference_number, spl.vessel_name, si.commodity, spp2.code AS purpose, si.status, spl.eta, si.eta_from, si.eta_to,
            si.loading_port_id,
            (
              SELECT COALESCE(
                json_agg(
                  json_build_object(
                    'commodity_name', c.name,
                    'qty', b.qty,
                    'metric_code', m.code,
                    'contract_no', b.contract_no,
                    'po_no', b.po_no,
                    'so_no', b.so_no,
                    'remarks', b.remarks,
                    'shipper_id', b.shipper_id,
                    'shipper_name', sh.name
                  ) ORDER BY b.line_order, b.id
                ),
                '[]'::json
              )
              FROM shipping_instruction_breakdown b
              JOIN si_commodities c ON c.id = b.commodity_id AND c.deleted_at IS NULL
              JOIN metric m ON m.id = b.metric_id AND m.deleted_at IS NULL
              LEFT JOIN si_shippers sh ON sh.id = b.shipper_id AND sh.deleted_at IS NULL
              WHERE b.shipping_instruction_id = si.id AND b.deleted_at IS NULL
            ) AS breakdown_json
     FROM shipping_instructions si
     JOIN shipment_plans spl ON spl.id = si.shipment_plan_id AND spl.deleted_at IS NULL
     LEFT JOIN si_purposes spp2 ON spp2.id = spl.purpose_id AND spp2.deleted_at IS NULL
     WHERE si.shipment_plan_id = $1 AND si.deleted_at IS NULL
     ORDER BY si.id ASC`,
    [planId]
  );

  res.json({
    ...toPlanListRow({ ...plan, si_count: sis.rows.length }),
    approverDisplayName: plan.approver_display_name ?? null,
    shippingInstructions: sis.rows.map(toSiChildRow),
  });
});

router.patch('/:id', requireAuth, async (req, res) => {
  if (!(await userHasPageEdit(req.userId, PAGE_KEY))) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const selectedPortId = Number(req.selectedPortId);
  const planId = parseInt(req.params.id, 10);
  if (Number.isNaN(planId)) return res.status(400).json({ error: 'Invalid id' });
  const b = req.body || {};

  const cur = await pool.query(
    `SELECT id, approval_status, vessel_name, jetty_id, eta FROM shipment_plans WHERE id = $1 AND port_id = $2 AND deleted_at IS NULL`,
    [planId, selectedPortId]
  );
  if (cur.rows.length === 0) return res.status(404).json({ error: 'Shipment plan not found' });
  const st = cur.rows[0].approval_status;
  if (st !== 'Draft' && st !== 'Rejected') {
    return res.status(400).json({ error: 'Plan can only be edited in Draft or Rejected state' });
  }

  const vesselName =
    b.vessel_name != null && typeof b.vessel_name === 'string' ? b.vessel_name.trim() : null;
  if (vesselName === '') return res.status(400).json({ error: 'vessel_name cannot be empty' });

  let jettyId = undefined;
  if ('jetty_id' in b) {
    if (b.jetty_id == null || b.jetty_id === '') jettyId = null;
    else {
      jettyId = parseInt(b.jetty_id, 10);
      if (Number.isNaN(jettyId)) return res.status(400).json({ error: 'Invalid jetty_id' });
      const jm = await pool.query(
        `SELECT 1 FROM jetties WHERE id = $1 AND port_id = $2 AND deleted_at IS NULL`,
        [jettyId, selectedPortId]
      );
      if (jm.rows.length === 0) return res.status(400).json({ error: 'jetty_id is not in selected port' });
    }
  }

  let eta = undefined;
  if ('eta' in b) {
    if (b.eta == null || b.eta === '') eta = null;
    else {
      eta = new Date(b.eta);
      if (Number.isNaN(eta.getTime())) return res.status(400).json({ error: 'Invalid eta' });
    }
  }

  let purposeId = undefined;
  if ('purpose_id' in b) {
    if (b.purpose_id == null || b.purpose_id === '') purposeId = null;
    else {
      purposeId = parseInt(b.purpose_id, 10);
      if (Number.isNaN(purposeId)) return res.status(400).json({ error: 'Invalid purpose_id' });
      const pm = await pool.query(`SELECT 1 FROM si_purposes WHERE id = $1 AND deleted_at IS NULL`, [purposeId]);
      if (pm.rows.length === 0) return res.status(400).json({ error: 'Invalid purpose_id' });
    }
  }

  let voyageNo = undefined;
  if ('voyage_no' in b) {
    voyageNo =
      b.voyage_no == null || b.voyage_no === '' ? null : String(b.voyage_no).trim().slice(0, 64);
  }

  let agentId = undefined;
  if ('agent_id' in b) {
    if (b.agent_id == null || b.agent_id === '') agentId = null;
    else {
      agentId = parseInt(b.agent_id, 10);
      if (Number.isNaN(agentId)) return res.status(400).json({ error: 'Invalid agent_id' });
      const am = await pool.query(`SELECT 1 FROM si_agents WHERE id = $1 AND deleted_at IS NULL`, [agentId]);
      if (am.rows.length === 0) return res.status(400).json({ error: 'Invalid agent_id' });
    }
  }

  const sets = [];
  const params = [];
  let i = 1;
  if (vesselName != null) {
    sets.push(`vessel_name = $${i++}`);
    params.push(vesselName);
  }
  if (jettyId !== undefined) {
    sets.push(`jetty_id = $${i++}`);
    params.push(jettyId);
  }
  if (eta !== undefined) {
    sets.push(`eta = $${i++}`);
    params.push(eta);
  }
  if (purposeId !== undefined) {
    sets.push(`purpose_id = $${i++}`);
    params.push(purposeId);
  }
  if (voyageNo !== undefined) {
    sets.push(`voyage_no = $${i++}`);
    params.push(voyageNo);
  }
  if (agentId !== undefined) {
    sets.push(`agent_id = $${i++}`);
    params.push(agentId);
  }
  if (sets.length === 0) return res.status(400).json({ error: 'No fields to update' });
  sets.push(`updated_at = NOW()`);
  sets.push(`updated_by = $${i++}`);
  params.push(req.userId ?? null);
  const idPh = i++;
  const portPh = i++;
  params.push(planId, selectedPortId);

  await pool.query(
    `UPDATE shipment_plans SET ${sets.join(', ')} WHERE id = $${idPh} AND port_id = $${portPh} AND deleted_at IS NULL`,
    params
  );

  if (agentId !== undefined) {
    await pool.query(
      `UPDATE shipping_instructions SET agent_id = $1, updated_at = NOW()
       WHERE shipment_plan_id = $2 AND deleted_at IS NULL`,
      [agentId, planId]
    );
  }

  await syncChildShippingInstructions(planId, selectedPortId);

  const plan = await loadPlan(pool, planId, selectedPortId);
  const cnt = await pool.query(
    `SELECT COUNT(*)::int AS c FROM shipping_instructions WHERE shipment_plan_id = $1 AND deleted_at IS NULL`,
    [planId]
  );
  writeActivityLog({
    pageKey: PAGE_KEY,
    action: 'update',
    entityType: 'ShipmentPlan',
    entityId: String(planId),
    entityLabel: plan.plan_reference || `Plan #${planId}`,
    summary: 'Updated shipment plan',
    changes: [{ field: 'Details', from: '—', to: 'Updated' }],
    actorUserId: req.userId ?? null,
  }).catch(() => {});

  res.json(toPlanListRow({ ...plan, si_count: cnt.rows[0]?.c ?? 0 }));
});

router.post('/:id/submit', requireAuth, async (req, res) => {
  if (!(await userHasPageEdit(req.userId, PAGE_KEY))) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const selectedPortId = Number(req.selectedPortId);
  const planId = parseInt(req.params.id, 10);
  if (Number.isNaN(planId)) return res.status(400).json({ error: 'Invalid id' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const p = await client.query(
      `SELECT id, approval_status, plan_reference FROM shipment_plans WHERE id = $1 AND port_id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [planId, selectedPortId]
    );
    if (p.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Shipment plan not found' });
    }
    const row = p.rows[0];
    if (row.approval_status !== 'Draft' && row.approval_status !== 'Rejected') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Plan can only be submitted from Draft or Rejected' });
    }
    const c = await client.query(
      `SELECT COUNT(*)::int AS n FROM shipping_instructions WHERE shipment_plan_id = $1 AND deleted_at IS NULL`,
      [planId]
    );
    if ((c.rows[0]?.n ?? 0) < 1) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'At least one shipping instruction is required before submit' });
    }
    await client.query(
      `UPDATE shipment_plans SET
         approval_status = 'Submitted',
         submitted_at = NOW(),
         rejection_reason = NULL,
         rejected_at = NULL,
         updated_at = NOW(),
         updated_by = $2
       WHERE id = $1`,
      [planId, req.userId ?? null]
    );
    await client.query('COMMIT');
    const appBase = getPublicAppBaseUrl();
    const planRefLabel = row.plan_reference || `Plan #${planId}`;
    triggerNotificationDeferred(pool, {
      eventKey: 'shipment_plan.submitted',
      correlationId: `shipment_plan.submitted:${planId}`,
      portId: selectedPortId,
      excludeUserId: req.userId ?? null,
      payloadVars: {
        planReference: planRefLabel,
        planId: String(planId),
        primaryHref: `${appBase}/shipment-plans/approval/${planId}`,
        actionUrl: `${appBase}/shipment-plans/approval/${planId}`,
      },
    });
    writeActivityLog({
      pageKey: PAGE_KEY,
      action: 'update',
      entityType: 'ShipmentPlan',
      entityId: String(planId),
      entityLabel: row.plan_reference || `Plan #${planId}`,
      summary: 'Submitted shipment plan for approval',
      changes: [{ field: 'Approval status', from: row.approval_status, to: 'Submitted' }],
      actorUserId: req.userId ?? null,
    }).catch(() => {});
    const plan = await loadPlan(pool, planId, selectedPortId);
    const cnt = await pool.query(
      `SELECT COUNT(*)::int AS c FROM shipping_instructions WHERE shipment_plan_id = $1 AND deleted_at IS NULL`,
      [planId]
    );
    res.json(toPlanListRow({ ...plan, si_count: cnt.rows[0]?.c ?? 0 }));
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});

router.post('/:id/approve', requireAuth, async (req, res) => {
  if (!(await userHasPageApprove(req.userId, PAGE_KEY))) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const selectedPortId = Number(req.selectedPortId);
  const planId = parseInt(req.params.id, 10);
  if (Number.isNaN(planId)) return res.status(400).json({ error: 'Invalid id' });

  const b = req.body || {};
  const signoffReason =
    typeof b.signoff_reason === 'string'
      ? b.signoff_reason.trim()
      : typeof b.reason === 'string'
        ? b.reason.trim()
        : '';
  if (!signoffReason) {
    return res.status(400).json({ error: 'reason is required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const p = await client.query(
      `SELECT id, approval_status, plan_reference FROM shipment_plans WHERE id = $1 AND port_id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [planId, selectedPortId]
    );
    if (p.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Shipment plan not found' });
    }
    const row = p.rows[0];
    if (row.approval_status !== 'Submitted') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Only Submitted plans can be approved' });
    }
    await client.query(
      `UPDATE shipment_plans SET
         approval_status = 'Approved',
         approved_at = NOW(),
         approved_by_user_id = $2,
         rejection_reason = NULL,
         rejected_at = NULL,
         updated_at = NOW(),
         updated_by = $2
       WHERE id = $1`,
      [planId, req.userId ?? null]
    );
    await client.query('COMMIT');
    writeActivityLog({
      pageKey: PAGE_KEY,
      action: 'update',
      entityType: 'ShipmentPlan',
      entityId: String(planId),
      entityLabel: row.plan_reference || `Plan #${planId}`,
      summary: 'Approved shipment plan',
      changes: [
        { field: 'Approval status', from: 'Submitted', to: 'Approved' },
        { field: 'Reason', from: null, to: signoffReason },
      ],
      actorUserId: req.userId ?? null,
    }).catch(() => {});
    const plan = await loadPlan(pool, planId, selectedPortId);
    const cnt = await pool.query(
      `SELECT COUNT(*)::int AS c FROM shipping_instructions WHERE shipment_plan_id = $1 AND deleted_at IS NULL`,
      [planId]
    );
    res.json(toPlanListRow({ ...plan, si_count: cnt.rows[0]?.c ?? 0 }));
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});

router.post('/:id/reject', requireAuth, async (req, res) => {
  if (!(await userHasPageApprove(req.userId, PAGE_KEY))) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const selectedPortId = Number(req.selectedPortId);
  const planId = parseInt(req.params.id, 10);
  if (Number.isNaN(planId)) return res.status(400).json({ error: 'Invalid id' });
  const reason =
    typeof (req.body || {}).rejection_reason === 'string'
      ? (req.body || {}).rejection_reason.trim()
      : typeof (req.body || {}).reason === 'string'
        ? (req.body || {}).reason.trim()
        : '';
  if (!reason) return res.status(400).json({ error: 'rejection_reason is required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const p = await client.query(
      `SELECT id, approval_status, plan_reference FROM shipment_plans WHERE id = $1 AND port_id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [planId, selectedPortId]
    );
    if (p.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Shipment plan not found' });
    }
    const row = p.rows[0];
    if (row.approval_status !== 'Submitted') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Only Submitted plans can be rejected' });
    }
    await client.query(
      `UPDATE shipment_plans SET
         approval_status = 'Rejected',
         rejected_at = NOW(),
         rejection_reason = $2,
         updated_at = NOW(),
         updated_by = $3
       WHERE id = $1`,
      [planId, reason, req.userId ?? null]
    );
    await client.query('COMMIT');
    writeActivityLog({
      pageKey: PAGE_KEY,
      action: 'update',
      entityType: 'ShipmentPlan',
      entityId: String(planId),
      entityLabel: row.plan_reference || `Plan #${planId}`,
      summary: 'Rejected shipment plan',
      changes: [
        { field: 'Approval status', from: 'Submitted', to: 'Rejected' },
        { field: 'Reason', from: null, to: reason },
      ],
      actorUserId: req.userId ?? null,
    }).catch(() => {});
    const plan = await loadPlan(pool, planId, selectedPortId);
    const cnt = await pool.query(
      `SELECT COUNT(*)::int AS c FROM shipping_instructions WHERE shipment_plan_id = $1 AND deleted_at IS NULL`,
      [planId]
    );
    res.json(toPlanListRow({ ...plan, si_count: cnt.rows[0]?.c ?? 0 }));
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});

router.post('/:id/depart', requireAuth, async (req, res) => {
  const planId = parseInt(req.params.id, 10);
  if (Number.isNaN(planId)) return res.status(400).json({ error: 'Invalid id' });

  const { cast_off_at, clearance_document_url, vessel_photo_url } = req.body || {};
  if (!cast_off_at) {
    return res.status(400).json({ error: 'cast_off_at is required (ISO date string)' });
  }
  const cast = new Date(cast_off_at);
  if (Number.isNaN(cast.getTime())) {
    return res.status(400).json({ error: 'Invalid cast_off_at' });
  }
  const clearanceUrl =
    clearance_document_url && typeof clearance_document_url === 'string'
      ? clearance_document_url.trim()
      : null;
  const photoUrl =
    vessel_photo_url && typeof vessel_photo_url === 'string' ? vessel_photo_url.trim() : null;

  const selectedPortId = Number(req.selectedPortId);
  const ap = await pool.query(
    `SELECT approval_status FROM shipment_plans WHERE id = $1 AND port_id = $2 AND deleted_at IS NULL`,
    [planId, selectedPortId]
  );
  if (ap.rows.length === 0) return res.status(404).json({ error: 'Shipment plan not found' });
  if (ap.rows[0].approval_status !== 'Approved') {
    return res.status(400).json({ error: 'Shipment plan must be Approved before departure' });
  }

  const client = await pool.connect();
  let primaryOperationId = null;
  try {
    await client.query('BEGIN');
    const dep = await departShipmentPlanInTransaction(client, {
      planId,
      castOffAt: cast,
      clearanceDocumentUrl: clearanceUrl,
      vesselPhotoUrl: photoUrl,
      portId: selectedPortId,
    });
    if (!dep.ok) {
      await client.query('ROLLBACK');
      return res.status(dep.status).json({ error: dep.error });
    }
    primaryOperationId = dep.primaryOperationId;
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  const sailRow =
    primaryOperationId != null ? await loadOperationJoined(primaryOperationId) : null;
  writeActivityLog({
    pageKey: 'verification',
    action: 'update',
    entityType: 'ShipmentPlan',
    entityId: String(planId),
    entityLabel: sailRow?.vessel_name || `Shipment plan #${planId}`,
    summary: 'Recorded vessel departure (SAILED) for shipment plan',
    changes: [
      { field: 'Cast Off', from: null, to: sailRow?.cast_off_at ?? cast.toISOString() },
      { field: 'Status', from: null, to: 'SAILED (all operations on plan)' },
    ],
    meta: { shipmentPlanId: planId, operationId: primaryOperationId ?? undefined },
    actorUserId: req.userId ?? null,
  }).catch(() => {});

  if (sailRow) {
    return res.json(toOp(sailRow));
  }
  return res.json({ ok: true, shipmentPlanId: planId });
});

router.delete('/:id', requireAuth, async (req, res) => {
  if (!(await userHasPageDelete(req.userId, PAGE_KEY))) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const selectedPortId = Number(req.selectedPortId);
  const planId = parseInt(req.params.id, 10);
  if (Number.isNaN(planId)) return res.status(400).json({ error: 'Invalid id' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const p = await client.query(
      `SELECT id, approval_status, plan_reference FROM shipment_plans WHERE id = $1 AND port_id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [planId, selectedPortId]
    );
    if (p.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Shipment plan not found' });
    }
    const row = p.rows[0];
    if (row.approval_status !== 'Draft' && row.approval_status !== 'Rejected') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Only Draft or Rejected plans can be deleted' });
    }

    const sis = await client.query(
      `SELECT id FROM shipping_instructions WHERE shipment_plan_id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [planId]
    );
    for (const si of sis.rows) {
      const op = await client.query(
        `SELECT 1 FROM operations WHERE shipping_instruction_id = $1 AND deleted_at IS NULL LIMIT 1`,
        [si.id]
      );
      if (op.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'Cannot delete shipment plan: a shipping instruction has active operations. Remove or complete operations first.',
        });
      }
    }

    for (const si of sis.rows) {
      await client.query(
        `UPDATE public.shipping_instruction_breakdown SET deleted_at = NOW(), updated_at = NOW()
         WHERE shipping_instruction_id = $1 AND deleted_at IS NULL`,
        [si.id]
      );
      await client.query(
        `UPDATE shipping_instructions SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL`,
        [si.id]
      );
    }

    await client.query(
      `UPDATE shipment_plans SET deleted_at = NOW(), updated_at = NOW(), updated_by = $2 WHERE id = $1 AND deleted_at IS NULL`,
      [planId, req.userId ?? null]
    );
    await client.query('COMMIT');
    writeActivityLog({
      pageKey: PAGE_KEY,
      action: 'delete',
      entityType: 'ShipmentPlan',
      entityId: String(planId),
      entityLabel: row.plan_reference || `Plan #${planId}`,
      summary: 'Soft-deleted shipment plan and child shipping instructions',
      changes: [],
      actorUserId: req.userId ?? null,
    }).catch(() => {});
    return res.status(204).send();
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});

export default router;
