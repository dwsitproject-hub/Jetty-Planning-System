/**
 * Shipping instructions CRUD + breakdown lines (commodity per line, qty + metric).
 */
import express from 'express';
import { pool } from '../db.js';
import { writeActivityLog } from '../lib/activity-log.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

const COMMODITY_DISPLAY = `COALESCE(
  (SELECT sc.name FROM public.shipping_instruction_breakdown b
   JOIN public.si_commodities sc ON sc.id = b.commodity_id AND sc.deleted_at IS NULL
   WHERE b.shipping_instruction_id = si.id AND b.deleted_at IS NULL
   ORDER BY b.line_order, b.id LIMIT 1),
  si.commodity
)`;

const SI_FROM = `
  FROM shipping_instructions si
  LEFT JOIN si_trade_terms tt ON si.trade_term_id = tt.id AND tt.deleted_at IS NULL
  LEFT JOIN si_purposes sp ON si.purpose_id = sp.id AND sp.deleted_at IS NULL
  LEFT JOIN jetties j ON si.preferred_jetty_id = j.id AND j.deleted_at IS NULL
  LEFT JOIN si_shippers sh ON si.shipper_id = sh.id AND sh.deleted_at IS NULL
  LEFT JOIN si_loading_ports lp ON si.loading_port_id = lp.id AND lp.deleted_at IS NULL
  LEFT JOIN si_surveyors sv ON si.surveyor_id = sv.id AND sv.deleted_at IS NULL
  LEFT JOIN si_agents ag ON si.agent_id = ag.id AND ag.deleted_at IS NULL
`;

const SI_SELECT = `
  SELECT si.id, si.reference_number, si.vessel_name, si.commodity, si.purpose, si.eta, si.eta_from, si.eta_to, si.status,
    si.approval_id,
    si.created_at, si.updated_at,
    si.note,
    si.commodity_id, si.trade_term_id, si.purpose_id, si.preferred_jetty_id,
    si.shipper_id, si.loading_port_id, si.surveyor_id, si.agent_id,
    ${COMMODITY_DISPLAY} AS commodity_display,
    tt.code AS trade_term_code,
    sp.code AS purpose_code,
    j.name AS preferred_jetty_name,
    sh.name AS shipper_name,
    lp.name AS loading_port_name,
    sv.name AS surveyor_name,
    ag.name AS agent_name
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

async function validateSiFks(body) {
  const checks = [
    ['si_trade_terms', body.trade_term_id, 'trade_term_id'],
    ['si_purposes', body.purpose_id, 'purpose_id'],
    ['jetties', body.preferred_jetty_id, 'preferred_jetty_id'],
    ['si_shippers', body.shipper_id, 'shipper_id'],
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
            b.contract_no, b.po_no, b.remarks, b.shipper_text, b.line_order,
            c.name AS commodity_name, m.code AS metric_code, m.label AS metric_label
     FROM public.shipping_instruction_breakdown b
     JOIN public.si_commodities c ON c.id = b.commodity_id AND c.deleted_at IS NULL
     JOIN public.metric m ON m.id = b.metric_id AND m.deleted_at IS NULL
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
    remarks: row.remarks ?? null,
    shipperText: row.shipper_text ?? null,
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

async function replaceBreakdown(client, siId, breakdown) {
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
    const cOk = await client.query(`SELECT 1 FROM public.si_commodities WHERE id = $1 AND deleted_at IS NULL`, [cid]);
    const mOk = await client.query(`SELECT 1 FROM public.metric WHERE id = $1 AND deleted_at IS NULL`, [mid]);
    if (cOk.rows.length === 0) throw new Error(`Invalid commodity_id ${cid}`);
    if (mOk.rows.length === 0) throw new Error(`Invalid metric_id ${mid}`);
    await client.query(
      `INSERT INTO public.shipping_instruction_breakdown (
         shipping_instruction_id, commodity_id, metric_id, qty, contract_no, po_no, remarks, shipper_text, line_order
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        siId,
        cid,
        mid,
        qty,
        row.contract_no != null ? String(row.contract_no).trim() || null : row.contractNo?.trim() || null,
        row.po_no != null ? String(row.po_no).trim() || null : row.poNo?.trim() || null,
        row.remarks != null ? String(row.remarks).trim() || null : null,
        row.shipper_text != null
          ? String(row.shipper_text).trim() || null
          : row.shipperText?.trim() || null,
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
  add('Shipper', before.shipperName, after.shipperName);
  add('Loading port', before.loadingPortName, after.loadingPortName);
  add('Surveyor', before.surveyorName, after.surveyorName);
  add('Agent', before.agentName, after.agentName);
  add('ETA From', before.etaFrom, after.etaFrom);
  add('ETA To', before.etaTo, after.etaTo);
  add('Note', before.note, after.note);
  add('Breakdown', summarizeBreakdown(before.breakdown), summarizeBreakdown(after.breakdown));
  return changes;
}

router.get('/', async (req, res) => {
  const { purpose, status } = req.query;
  let query = `${SI_SELECT} WHERE si.deleted_at IS NULL`;
  const params = [];
  let i = 1;
  if (purpose) {
    query += ` AND si.purpose = $${i++}`;
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

router.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const result = await pool.query(`${SI_SELECT} WHERE si.id = $1 AND si.deleted_at IS NULL`, [id]);
  if (result.rows.length === 0) return res.status(404).json({ error: 'Shipping instruction not found' });
  const row = result.rows[0];
  const breakdown = await loadBreakdown(id);
  res.json({ ...toSIList(row), breakdown });
});

router.post('/', requireAuth, async (req, res) => {
  const b = req.body || {};
  const {
    reference_number,
    vessel_name,
    trade_term_id,
    purpose,
    purpose_id,
    eta,
    eta_from,
    eta_to,
    status,
    approval_id,
    preferred_jetty_id,
    shipper_id,
    loading_port_id,
    surveyor_id,
    agent_id,
    note,
    breakdown,
  } = b;

  if (!vessel_name || typeof vessel_name !== 'string' || !vessel_name.trim()) {
    return res.status(400).json({ error: 'vessel_name is required' });
  }

  const bdErr = validateBreakdownPayload(breakdown);
  if (bdErr) return res.status(400).json({ error: bdErr });

  let purposeVal = purpose;
  let purposeIdVal = purpose_id != null ? parseInt(purpose_id, 10) : null;

  if (purposeIdVal && !Number.isNaN(purposeIdVal)) {
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
    shipper_id,
    loading_port_id,
    surveyor_id,
    agent_id,
  });
  if (fkErr) return res.status(400).json(fkErr);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO shipping_instructions (
         reference_number, vessel_name, commodity, commodity_id, trade_term_id, purpose_id, purpose, eta, eta_from, eta_to, status,
         approval_id, preferred_jetty_id, shipper_id, loading_port_id, surveyor_id, agent_id, note
       ) VALUES ($1,$2,NULL,NULL,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING id`,
      [
        reference_number?.trim() ?? null,
        vessel_name.trim(),
        trade_term_id != null && trade_term_id !== '' ? parseInt(trade_term_id, 10) : null,
        purposeIdVal,
        purposeVal,
        eta ? new Date(eta) : eta_from ? new Date(`${eta_from}T12:00:00Z`) : null,
        eta_from ? String(eta_from).slice(0, 10) : null,
        eta_to ? String(eta_to).slice(0, 10) : (eta_from ? String(eta_from).slice(0, 10) : null),
        status && ['Draft', 'Submitted', 'Approved'].includes(status) ? status : 'Draft',
        typeof approval_id === 'string' ? approval_id.trim() || null : null,
        preferred_jetty_id != null && preferred_jetty_id !== '' ? parseInt(preferred_jetty_id, 10) : null,
        shipper_id != null && shipper_id !== '' ? parseInt(shipper_id, 10) : null,
        loading_port_id != null && loading_port_id !== '' ? parseInt(loading_port_id, 10) : null,
        surveyor_id != null && surveyor_id !== '' ? parseInt(surveyor_id, 10) : null,
        agent_id != null && agent_id !== '' ? parseInt(agent_id, 10) : null,
        typeof note === 'string' ? note.trim() || null : null,
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
      pageKey: 'shipping-instruction',
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
    throw e;
  } finally {
    client.release();
  }
});

router.put('/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const b = req.body || {};
  const {
    reference_number,
    vessel_name,
    trade_term_id,
    purpose,
    purpose_id,
    eta,
    eta_from,
    eta_to,
    status,
    approval_id,
    preferred_jetty_id,
    shipper_id,
    loading_port_id,
    surveyor_id,
    agent_id,
    note,
    breakdown,
  } = b;

  if (!vessel_name || typeof vessel_name !== 'string' || !vessel_name.trim()) {
    return res.status(400).json({ error: 'vessel_name is required' });
  }

  const cur = await pool.query(`${SI_SELECT} WHERE si.id = $1 AND si.deleted_at IS NULL`, [id]);
  if (cur.rows.length === 0) return res.status(404).json({ error: 'Shipping instruction not found' });
  const beforeRow = cur.rows[0];
  const beforeBd = await loadBreakdown(id);

  let purposeVal = purpose ?? cur.rows[0].purpose;
  let purposeIdVal = purpose_id != null ? parseInt(purpose_id, 10) : cur.rows[0].purpose_id;

  if (purpose_id != null && purpose_id !== '') {
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
    shipper_id,
    loading_port_id,
    surveyor_id,
    agent_id,
  });
  if (fkErr) return res.status(400).json(fkErr);

  if (breakdown !== undefined) {
    const bdErr = validateBreakdownPayload(breakdown);
    if (bdErr) return res.status(400).json({ error: bdErr });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const up = await client.query(
      `UPDATE shipping_instructions SET
         reference_number = $1,
         vessel_name = $2,
         trade_term_id = $3,
         purpose_id = $4,
         purpose = $5,
         eta = $6,
         eta_from = $7,
         eta_to = $8,
         status = $9,
         approval_id = COALESCE($10, approval_id),
         preferred_jetty_id = $11,
         shipper_id = $12,
         loading_port_id = $13,
         surveyor_id = $14,
         agent_id = $15,
         note = $16,
         updated_at = NOW()
       WHERE id = $17 AND deleted_at IS NULL`,
      [
        reference_number?.trim() ?? null,
        vessel_name.trim(),
        trade_term_id != null && trade_term_id !== '' ? parseInt(trade_term_id, 10) : null,
        purposeIdVal,
        purposeVal,
        eta ? new Date(eta) : eta_from ? new Date(`${eta_from}T12:00:00Z`) : null,
        eta_from ? String(eta_from).slice(0, 10) : null,
        eta_to ? String(eta_to).slice(0, 10) : (eta_from ? String(eta_from).slice(0, 10) : null),
        status && ['Draft', 'Submitted', 'Approved'].includes(status) ? status : 'Draft',
        typeof approval_id === 'string' ? approval_id.trim() || null : null,
        preferred_jetty_id != null && preferred_jetty_id !== '' ? parseInt(preferred_jetty_id, 10) : null,
        shipper_id != null && shipper_id !== '' ? parseInt(shipper_id, 10) : null,
        loading_port_id != null && loading_port_id !== '' ? parseInt(loading_port_id, 10) : null,
        surveyor_id != null && surveyor_id !== '' ? parseInt(surveyor_id, 10) : null,
        agent_id != null && agent_id !== '' ? parseInt(agent_id, 10) : null,
        typeof note === 'string' ? note.trim() || null : null,
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
      pageKey: 'shipping-instruction',
      action: 'update',
      entityType: 'Shipping Instruction',
      entityId: id,
      entityLabel: response.referenceNumber || `SI-${id}`,
      summary: 'Updated Draft SI',
      changes,
      actorUserId: req.userId ?? null,
    }).catch(() => {});
    res.json(response);
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.message?.startsWith('Invalid')) return res.status(400).json({ error: e.message });
    throw e;
  } finally {
    client.release();
  }
});

router.delete('/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const op = await pool.query(
    `SELECT 1 FROM operations WHERE shipping_instruction_id = $1 AND deleted_at IS NULL LIMIT 1`,
    [id]
  );
  if (op.rows.length > 0) {
    return res.status(409).json({ error: 'Cannot delete shipping instruction while operations reference it' });
  }
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
      return res.status(404).json({ error: 'Shipping instruction not found' });
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  writeActivityLog({
    pageKey: 'shipping-instruction',
    action: 'delete',
    entityType: 'Shipping Instruction',
    entityId: id,
    entityLabel: `SI-${id}`,
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
    note: row.note ?? null,
    preferredJettyId: row.preferred_jetty_id ?? null,
    preferredJettyName: row.preferred_jetty_name ?? null,
    shipperId: row.shipper_id ?? null,
    shipperName: row.shipper_name ?? null,
    loadingPortId: row.loading_port_id ?? null,
    loadingPortName: row.loading_port_name ?? null,
    surveyorId: row.surveyor_id ?? null,
    surveyorName: row.surveyor_name ?? null,
    agentId: row.agent_id ?? null,
    agentName: row.agent_name ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export default router;
