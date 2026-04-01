/**
 * Operations CRUD, at-berth, start-docking, recalculate-sla — Phase 3.
 * Phase 5: signoff, exception workflow, clearance / depart (SAILED).
 */
import express from 'express';
import { pool } from '../db.js';
import { computeSlaHours } from '../lib/sla.js';
import { writeActivityLog } from '../lib/activity-log.js';
import { optionalAuth } from '../middleware/auth.js';

const router = express.Router();
router.use(optionalAuth);
const AT_BERTH_STATUSES = ['DOCKED', 'IN_PROGRESS', 'COMPLETED'];

const SI_COMMODITY = `COALESCE(
  (SELECT sc.name FROM public.shipping_instruction_breakdown b
   JOIN public.si_commodities sc ON sc.id = b.commodity_id AND sc.deleted_at IS NULL
   WHERE b.shipping_instruction_id = si.id AND b.deleted_at IS NULL
   ORDER BY b.line_order, b.id LIMIT 1),
  si.commodity
)`;

const OP_SELECT = `o.*, si.vessel_name, si.reference_number, ${SI_COMMODITY} AS commodity,
            j.name AS jetty_name, p.id AS port_id, p.name AS port_name`;

function canAccessOperationForSelectedPort(opRow, selectedPortId) {
  const selected = Number(selectedPortId);
  const opPort = opRow?.port_id != null ? Number(opRow.port_id) : null;
  if (!Number.isFinite(selected)) return false;
  // Legacy rows may have null jetty/port before allocation; allow access.
  if (opPort == null) return true;
  return opPort === selected;
}

async function loadOperationJoined(id) {
  const r = await pool.query(
    `SELECT ${OP_SELECT}
     FROM operations o
     JOIN shipping_instructions si ON o.shipping_instruction_id = si.id AND si.deleted_at IS NULL
     LEFT JOIN jetties j ON o.jetty_id = j.id AND j.deleted_at IS NULL
     LEFT JOIN ports p ON p.id = COALESCE(o.port_id, j.port_id) AND p.deleted_at IS NULL
     WHERE o.id = $1 AND o.deleted_at IS NULL`,
    [id]
  );
  return r.rows[0] ?? null;
}

/** Normal signoff path: 100% + QC/qty gates. Exception path skips gates when exception_status is APPROVED. */
async function checkSignoffEligible(operationId, op) {
  if (op.exception_status === 'APPROVED') return { ok: true };
  const pct = Number(op.completion_percent) || 0;
  if (pct < 100) {
    return { ok: false, reason: 'completion_percent must be 100 unless an exception is approved' };
  }
  const qcPending = await pool.query(
    `SELECT 1 FROM qc_surveys WHERE operation_id = $1 AND status = 'Pending' AND deleted_at IS NULL LIMIT 1`,
    [operationId]
  );
  if (qcPending.rows.length > 0) {
    return { ok: false, reason: 'All QC surveys must be Done (or use an approved exception)' };
  }
  const qcRows = await pool.query(
    `SELECT phase, status FROM qc_surveys WHERE operation_id = $1 AND deleted_at IS NULL`,
    [operationId]
  );
  if (qcRows.rows.length > 0) {
    const preDone = qcRows.rows.some((row) => row.phase === 'Pre-Checking' && row.status === 'Done');
    const postDone = qcRows.rows.some((row) => row.phase === 'Post-Checking' && row.status === 'Done');
    if (!preDone || !postDone) {
      return {
        ok: false,
        reason: 'At least one Pre-Checking and one Post-Checking survey must be Done',
      };
    }
  }
  const qtyIncomplete = await pool.query(
    `SELECT 1 FROM quantity_checks WHERE operation_id = $1 AND phase = 'Operational' AND occurred_at IS NULL AND deleted_at IS NULL LIMIT 1`,
    [operationId]
  );
  if (qtyIncomplete.rows.length > 0) {
    return {
      ok: false,
      reason: 'All Operational quantity checks must be completed (occurred_at set)',
    };
  }
  return { ok: true };
}

router.get('/at-berth', async (req, res) => {
  const selectedPortId = Number(req.selectedPortId);
  const result = await pool.query(
    `SELECT ${OP_SELECT}
     FROM operations o
     JOIN shipping_instructions si ON o.shipping_instruction_id = si.id AND si.deleted_at IS NULL
     LEFT JOIN jetties j ON o.jetty_id = j.id AND j.deleted_at IS NULL
     LEFT JOIN ports p ON p.id = COALESCE(o.port_id, j.port_id) AND p.deleted_at IS NULL
     WHERE o.deleted_at IS NULL
       AND COALESCE(o.port_id, p.id) = $2
       AND o.status <> 'SAILED'
       AND (
         o.status = ANY($1)
         OR o.tb IS NOT NULL
         OR o.docking_start_time IS NOT NULL
       )
     ORDER BY o.docking_start_time ASC NULLS LAST`,
    [AT_BERTH_STATUSES, selectedPortId]
  );
  res.json(result.rows.map(toOp));
});

router.get('/:id/materials', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const result = await pool.query(
    `SELECT id, operation_id, material_key, volume, created_at, updated_at
     FROM operation_materials WHERE operation_id = $1 AND deleted_at IS NULL ORDER BY material_key`,
    [id]
  );
  res.json(result.rows.map((r) => ({
    id: r.id,
    operationId: r.operation_id,
    materialKey: r.material_key,
    volume: Number(r.volume),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  })));
});

router.post('/:id/materials', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const { material_key, volume } = req.body || {};
  if (!material_key || typeof material_key !== 'string' || !material_key.trim()) {
    return res.status(400).json({ error: 'material_key is required' });
  }
  const vol = Number(volume);
  if (Number.isNaN(vol) || vol < 0) return res.status(400).json({ error: 'volume must be a non-negative number' });
  const opCheck = await pool.query('SELECT id FROM operations WHERE id = $1 AND deleted_at IS NULL', [id]);
  if (opCheck.rows.length === 0) return res.status(404).json({ error: 'Operation not found' });
  const result = await pool.query(
    `INSERT INTO operation_materials (operation_id, material_key, volume)
     VALUES ($1, $2, $3)
     RETURNING id, operation_id, material_key, volume, created_at, updated_at`,
    [id, material_key.trim(), vol]
  );
  const r = result.rows[0];
  res.status(201).json({
    id: r.id,
    operationId: r.operation_id,
    materialKey: r.material_key,
    volume: Number(r.volume),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  });
});

router.get('/', async (req, res) => {
  const { port_id, jetty_id, status, purpose } = req.query;
  const selectedPortId = Number(req.selectedPortId);
  let query = `
    SELECT ${OP_SELECT}
    FROM operations o
    JOIN shipping_instructions si ON o.shipping_instruction_id = si.id AND si.deleted_at IS NULL
    LEFT JOIN jetties j ON o.jetty_id = j.id AND j.deleted_at IS NULL
    LEFT JOIN ports p ON p.id = COALESCE(o.port_id, j.port_id) AND p.deleted_at IS NULL
    WHERE o.deleted_at IS NULL`;
  const params = [];
  let i = 1;
  const requestedPort = port_id ? parseInt(port_id, 10) : null;
  const effectivePort = Number.isFinite(requestedPort) ? requestedPort : selectedPortId;
  query += ` AND COALESCE(o.port_id, p.id) = $${i++}`;
  params.push(effectivePort);
  if (jetty_id) {
    query += ` AND o.jetty_id = $${i++}`;
    params.push(parseInt(jetty_id, 10));
  }
  if (status) {
    query += ` AND o.status = $${i++}`;
    params.push(status);
  }
  if (purpose) {
    query += ` AND o.purpose = $${i++}`;
    params.push(purpose);
  }
  query += ` ORDER BY o.created_at DESC`;
  const result = await pool.query(query, params);
  res.json(result.rows.map(toOp));
});

router.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const row = await loadOperationJoined(id);
  if (!row) return res.status(404).json({ error: 'Operation not found' });
  if (!canAccessOperationForSelectedPort(row, req.selectedPortId)) {
    return res.status(404).json({ error: 'Operation not found' });
  }
  res.json(toOp(row));
});

router.post('/', async (req, res) => {
  const selectedPortId = Number(req.selectedPortId);
  const { shipping_instruction_id, jetty_id } = req.body || {};
  if (shipping_instruction_id == null) {
    return res.status(400).json({ error: 'shipping_instruction_id is required' });
  }
  const siId = parseInt(shipping_instruction_id, 10);
  const jId = jetty_id != null && jetty_id !== '' ? parseInt(jetty_id, 10) : null;
  if (Number.isNaN(siId) || (jId != null && Number.isNaN(jId))) {
    return res.status(400).json({ error: 'Invalid shipping_instruction_id or jetty_id' });
  }
  const siRes = await pool.query(
    'SELECT purpose FROM shipping_instructions WHERE id = $1 AND deleted_at IS NULL',
    [siId]
  );
  if (siRes.rows.length === 0) {
    return res.status(404).json({ error: 'Shipping instruction not found' });
  }
  if (jId != null) {
    const jettyOk = await pool.query(
      'SELECT 1 FROM jetties WHERE id = $1 AND port_id = $2 AND deleted_at IS NULL',
      [jId, selectedPortId]
    );
    if (jettyOk.rows.length === 0) {
      return res.status(404).json({ error: 'Jetty not found for selected port' });
    }
  }
  const purpose = siRes.rows[0].purpose;
  const result = await pool.query(
    `INSERT INTO operations (shipping_instruction_id, jetty_id, purpose, status, port_id)
     VALUES ($1, $2, $3, 'PENDING', $4)
     RETURNING id`,
    [siId, jId, purpose, selectedPortId]
  );
  const row = await loadOperationJoined(result.rows[0].id);
  writeActivityLog({
    pageKey: 'allocation',
    action: 'add',
    entityType: 'Operation',
    entityId: String(result.rows[0].id),
    entityLabel: row?.vessel_name || `Operation #${result.rows[0].id}`,
    summary: `Created operation for ${row?.reference_number || 'SI'}`,
    changes: [
      { field: 'Shipping Instruction', from: null, to: row?.reference_number || `SI-${siId}` },
      { field: 'Jetty', from: null, to: row?.jetty_name || null },
      { field: 'Purpose', from: null, to: purpose || null },
      { field: 'Status', from: null, to: 'PENDING' },
    ],
    meta: { operationId: result.rows[0].id },
    actorUserId: req.userId ?? null,
  }).catch(() => {});
  res.status(201).json(toOp(row));
});

router.put('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const before = await loadOperationJoined(id);
  if (!before) return res.status(404).json({ error: 'Operation not found' });
  if (!canAccessOperationForSelectedPort(before, req.selectedPortId)) {
    return res.status(404).json({ error: 'Operation not found' });
  }
  const { status, completion_percent } = req.body || {};
  const updates = [];
  const values = [];
  let i = 1;
  if (status) {
    const valid = ['PENDING', 'ALLOCATED', 'DOCKED', 'IN_PROGRESS', 'COMPLETED', 'SAILED'];
    if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    updates.push(`status = $${i++}`);
    values.push(status);
  }
  if (completion_percent !== undefined && completion_percent !== null) {
    const pct = parseInt(completion_percent, 10);
    if (Number.isNaN(pct) || pct < 0 || pct > 100) {
      return res.status(400).json({ error: 'completion_percent must be 0-100' });
    }
    updates.push(`completion_percent = $${i++}`);
    values.push(pct);
  }
  if (updates.length === 0) {
    return res.json(toOp(before));
  }
  values.push(id);
  const result = await pool.query(
    `UPDATE operations SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${i} AND deleted_at IS NULL`,
    values
  );
  if (result.rowCount === 0) return res.status(404).json({ error: 'Operation not found' });
  const row = await loadOperationJoined(id);
  writeActivityLog({
    pageKey: 'loading',
    action: 'update',
    entityType: 'Operation',
    entityId: String(id),
    entityLabel: row?.vessel_name || `Operation #${id}`,
    summary: 'Updated operation status / completion',
    changes: [
      { field: 'Status', from: before?.status ?? null, to: row?.status ?? null },
      { field: 'Completion %', from: before?.completion_percent ?? null, to: row?.completion_percent ?? null },
    ].filter((c) => c.from !== c.to),
    meta: { operationId: id, status, completion_percent },
    actorUserId: req.userId ?? null,
  }).catch(() => {});
  res.json(toOp(row));
});

router.post('/:id/start-docking', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const before = await loadOperationJoined(id);
  if (!before) return res.status(404).json({ error: 'Operation not found' });
  if (!canAccessOperationForSelectedPort(before, req.selectedPortId)) {
    return res.status(404).json({ error: 'Operation not found' });
  }
  const { docking_start_time } = req.body || {};
  const startTime = docking_start_time ? new Date(docking_start_time) : new Date();
  let slaHours;
  try {
    slaHours = await computeSlaHours(id);
  } catch (err) {
    return res.status(400).json({ error: err.message || 'SLA computation failed' });
  }
  const estimated = new Date(startTime.getTime() + slaHours * 60 * 60 * 1000);
  const result = await pool.query(
    `UPDATE operations SET docking_start_time = $1, estimated_completion_time = $2, status = 'DOCKED', updated_at = NOW()
     WHERE id = $3 AND deleted_at IS NULL`,
    [startTime, estimated, id]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: 'Operation not found' });
  const dockRow = await loadOperationJoined(id);
  writeActivityLog({
    pageKey: 'loading',
    action: 'update',
    entityType: 'Operation',
    entityId: String(id),
    entityLabel: dockRow?.vessel_name || `Operation #${id}`,
    summary: 'Recorded start of docking / TB timeline',
    changes: [
      { field: 'Docking Start', from: before?.docking_start_time ?? null, to: dockRow?.docking_start_time ?? null },
      { field: 'Estimated Completion', from: before?.estimated_completion_time ?? null, to: dockRow?.estimated_completion_time ?? null },
      { field: 'Status', from: before?.status ?? null, to: dockRow?.status ?? null },
    ].filter((c) => c.from !== c.to),
    meta: { operationId: id },
    actorUserId: req.userId ?? null,
  }).catch(() => {});
  res.json(toOp(dockRow));
});

router.post('/:id/recalculate-sla', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const opRes = await pool.query(
    `SELECT o.docking_start_time, o.estimated_completion_time, p.id AS port_id
     FROM operations o
     LEFT JOIN jetties j ON j.id = o.jetty_id AND j.deleted_at IS NULL
     LEFT JOIN ports p ON p.id = j.port_id AND p.deleted_at IS NULL
     WHERE o.id = $1 AND o.deleted_at IS NULL`,
    [id]
  );
  if (opRes.rows.length === 0) return res.status(404).json({ error: 'Operation not found' });
  if (!canAccessOperationForSelectedPort(opRes.rows[0], req.selectedPortId)) {
    return res.status(404).json({ error: 'Operation not found' });
  }
  const dockingStart = opRes.rows[0].docking_start_time;
  if (!dockingStart) {
    return res.status(400).json({ error: 'Operation has no docking_start_time; call start-docking first' });
  }
  let slaHours;
  try {
    slaHours = await computeSlaHours(id);
  } catch (err) {
    return res.status(400).json({ error: err.message || 'SLA computation failed' });
  }
  const startTime = new Date(dockingStart);
  const estimated = new Date(startTime.getTime() + slaHours * 60 * 60 * 1000);
  const result = await pool.query(
    `UPDATE operations SET estimated_completion_time = $1, updated_at = NOW() WHERE id = $2 AND deleted_at IS NULL`,
    [estimated, id]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: 'Operation not found' });
  const slaRow = await loadOperationJoined(id);
  writeActivityLog({
    pageKey: 'loading',
    action: 'update',
    entityType: 'Operation',
    entityId: String(id),
    entityLabel: slaRow?.vessel_name || `Operation #${id}`,
    summary: 'Recalculated SLA / estimated completion',
    changes: [
      { field: 'Estimated Completion', from: opRes.rows[0]?.estimated_completion_time ?? null, to: slaRow?.estimated_completion_time ?? null },
    ].filter((c) => c.from !== c.to),
    meta: { operationId: id },
    actorUserId: req.userId ?? null,
  }).catch(() => {});
  res.json(toOp(slaRow));
});

/**
 * Save estimated completion time (manual estimation) for an operation.
 * Used by Demurrage Risk Calculator page.
 */
router.put('/:id/estimated-completion', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const before = await loadOperationJoined(id);
  if (!before) return res.status(404).json({ error: 'Operation not found' });
  if (!canAccessOperationForSelectedPort(before, req.selectedPortId)) {
    return res.status(404).json({ error: 'Operation not found' });
  }

  const { estimated_completion_time, meta } = req.body || {};
  if (!estimated_completion_time) {
    return res.status(400).json({ error: 'estimated_completion_time is required' });
  }
  const dt = new Date(estimated_completion_time);
  if (Number.isNaN(dt.getTime())) {
    return res.status(400).json({ error: 'estimated_completion_time must be a valid datetime' });
  }

  const result = await pool.query(
    `UPDATE operations
     SET estimated_completion_time = $1, updated_at = NOW()
     WHERE id = $2 AND deleted_at IS NULL`,
    [dt, id],
  );
  if (result.rowCount === 0) return res.status(404).json({ error: 'Operation not found' });

  const row = await loadOperationJoined(id);
  writeActivityLog({
    pageKey: 'demurrage-risk-calculator',
    action: 'update',
    entityType: 'Operation',
    entityId: String(id),
    entityLabel: row?.vessel_name || `Operation #${id}`,
    summary: 'Saved estimation of completion time',
    changes: [
      { field: 'Estimated Completion', from: before?.estimated_completion_time ?? null, to: row?.estimated_completion_time ?? null },
    ].filter((c) => c.from !== c.to),
    meta: { operationId: id, ...(meta && typeof meta === 'object' ? meta : {}) },
    actorUserId: req.userId ?? null,
  }).catch(() => {});

  res.json(toOp(row));
});

router.post('/:id/request-exception', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const op = await pool.query(
    `SELECT o.id, o.status, o.completion_percent, o.exception_status, o.exception_justification, o.exception_document_url, p.id AS port_id
     FROM operations o
     LEFT JOIN jetties j ON j.id = o.jetty_id AND j.deleted_at IS NULL
     LEFT JOIN ports p ON p.id = j.port_id AND p.deleted_at IS NULL
     WHERE o.id = $1 AND o.deleted_at IS NULL`,
    [id]
  );
  if (op.rows.length === 0) return res.status(404).json({ error: 'Operation not found' });
  const row = op.rows[0];
  if (!canAccessOperationForSelectedPort(row, req.selectedPortId)) {
    return res.status(404).json({ error: 'Operation not found' });
  }
  if (row.status === 'SAILED') return res.status(400).json({ error: 'Operation has already sailed' });
  if (row.status === 'COMPLETED') return res.status(400).json({ error: 'Operation is already completed; signoff done' });
  if (row.exception_status === 'PENDING') {
    return res.status(400).json({ error: 'An exception request is already pending' });
  }
  if (row.exception_status === 'APPROVED') {
    return res.status(400).json({ error: 'Exception already approved' });
  }
  const { justification, exception_document_url } = req.body || {};
  if (!justification || typeof justification !== 'string' || !justification.trim()) {
    return res.status(400).json({ error: 'justification is required' });
  }
  const docUrl =
    exception_document_url && typeof exception_document_url === 'string'
      ? exception_document_url.trim()
      : null;
  await pool.query(
    `UPDATE operations SET
       exception_status = 'PENDING',
       exception_justification = $1,
       exception_document_url = $2,
       exception_requested_at = NOW(),
       exception_resolved_at = NULL,
       exception_approver_user_id = NULL,
       updated_at = NOW()
     WHERE id = $3 AND deleted_at IS NULL`,
    [justification.trim(), docUrl, id]
  );
  const exRow = await loadOperationJoined(id);
  writeActivityLog({
    pageKey: 'verification',
    action: 'add',
    entityType: 'Exception',
    entityId: String(id),
    entityLabel: exRow?.vessel_name || `Operation #${id}`,
    summary: 'Requested operations exception',
    changes: [
      { field: 'Exception Status', from: row.exception_status ?? null, to: 'PENDING' },
      { field: 'Justification', from: row.exception_justification ?? null, to: justification.trim() },
      { field: 'Document URL', from: row.exception_document_url ?? null, to: docUrl ?? null },
    ].filter((c) => c.from !== c.to),
    meta: { operationId: id },
    actorUserId: req.userId ?? null,
  }).catch(() => {});
  res.status(201).json(toOp(exRow));
});

router.post('/:id/approve-exception', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const op = await pool.query(
    `SELECT o.id, o.exception_status, o.exception_approver_user_id, p.id AS port_id
     FROM operations o
     LEFT JOIN jetties j ON j.id = o.jetty_id AND j.deleted_at IS NULL
     LEFT JOIN ports p ON p.id = j.port_id AND p.deleted_at IS NULL
     WHERE o.id = $1 AND o.deleted_at IS NULL`,
    [id]
  );
  if (op.rows.length === 0) return res.status(404).json({ error: 'Operation not found' });
  if (!canAccessOperationForSelectedPort(op.rows[0], req.selectedPortId)) {
    return res.status(404).json({ error: 'Operation not found' });
  }
  if (op.rows[0].exception_status !== 'PENDING') {
    return res.status(400).json({ error: 'No pending exception to approve' });
  }
  const { approver_user_id } = req.body || {};
  const approverId =
    approver_user_id != null && !Number.isNaN(parseInt(approver_user_id, 10))
      ? parseInt(approver_user_id, 10)
      : null;
  if (approverId != null) {
    const u = await pool.query('SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL', [approverId]);
    if (u.rows.length === 0) return res.status(400).json({ error: 'approver_user_id not found' });
  }
  await pool.query(
    `UPDATE operations SET
       exception_status = 'APPROVED',
       exception_resolved_at = NOW(),
       exception_approver_user_id = $1,
       updated_at = NOW()
     WHERE id = $2 AND deleted_at IS NULL`,
    [approverId, id]
  );
  const apprRow = await loadOperationJoined(id);
  writeActivityLog({
    pageKey: 'verification',
    action: 'update',
    entityType: 'Exception',
    entityId: String(id),
    entityLabel: apprRow?.vessel_name || `Operation #${id}`,
    summary: 'Approved operations exception',
    changes: [
      { field: 'Exception Status', from: op.rows[0]?.exception_status ?? null, to: 'APPROVED' },
      { field: 'Approver User ID', from: op.rows[0]?.exception_approver_user_id ?? null, to: approverId ?? null },
    ].filter((c) => c.from !== c.to),
    meta: { operationId: id },
    actorUserId: req.userId ?? null,
  }).catch(() => {});
  res.json(toOp(apprRow));
});

router.post('/:id/reject-exception', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const op = await pool.query(
    `SELECT o.id, o.exception_status, o.exception_approver_user_id, p.id AS port_id
     FROM operations o
     LEFT JOIN jetties j ON j.id = o.jetty_id AND j.deleted_at IS NULL
     LEFT JOIN ports p ON p.id = j.port_id AND p.deleted_at IS NULL
     WHERE o.id = $1 AND o.deleted_at IS NULL`,
    [id]
  );
  if (op.rows.length === 0) return res.status(404).json({ error: 'Operation not found' });
  if (!canAccessOperationForSelectedPort(op.rows[0], req.selectedPortId)) {
    return res.status(404).json({ error: 'Operation not found' });
  }
  if (op.rows[0].exception_status !== 'PENDING') {
    return res.status(400).json({ error: 'No pending exception to reject' });
  }
  const { approver_user_id } = req.body || {};
  const approverId =
    approver_user_id != null && !Number.isNaN(parseInt(approver_user_id, 10))
      ? parseInt(approver_user_id, 10)
      : null;
  if (approverId != null) {
    const u = await pool.query('SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL', [approverId]);
    if (u.rows.length === 0) return res.status(400).json({ error: 'approver_user_id not found' });
  }
  await pool.query(
    `UPDATE operations SET
       exception_status = 'REJECTED',
       exception_resolved_at = NOW(),
       exception_approver_user_id = $1,
       updated_at = NOW()
     WHERE id = $2 AND deleted_at IS NULL`,
    [approverId, id]
  );
  const rejRow = await loadOperationJoined(id);
  writeActivityLog({
    pageKey: 'verification',
    action: 'update',
    entityType: 'Exception',
    entityId: String(id),
    entityLabel: rejRow?.vessel_name || `Operation #${id}`,
    summary: 'Rejected operations exception',
    changes: [
      { field: 'Exception Status', from: op.rows[0]?.exception_status ?? null, to: 'REJECTED' },
      { field: 'Approver User ID', from: op.rows[0]?.exception_approver_user_id ?? null, to: approverId ?? null },
    ].filter((c) => c.from !== c.to),
    meta: { operationId: id },
    actorUserId: req.userId ?? null,
  }).catch(() => {});
  res.json(toOp(rejRow));
});

router.post('/:id/signoff', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const opRow = await loadOperationJoined(id);
  if (!opRow) return res.status(404).json({ error: 'Operation not found' });
  if (!canAccessOperationForSelectedPort(opRow, req.selectedPortId)) {
    return res.status(404).json({ error: 'Operation not found' });
  }
  if (opRow.status === 'SAILED') return res.status(400).json({ error: 'Operation has already sailed' });
  if (opRow.status === 'COMPLETED') {
    return res.json(toOp(opRow));
  }
  const allowed = ['DOCKED', 'IN_PROGRESS'];
  if (!allowed.includes(opRow.status)) {
    return res.status(400).json({ error: `Signoff requires status DOCKED or IN_PROGRESS (current: ${opRow.status})` });
  }
  const gate = await checkSignoffEligible(id, opRow);
  if (!gate.ok) return res.status(400).json({ error: gate.reason });
  await pool.query(
    `UPDATE operations SET
       status = 'COMPLETED',
       actual_completion_time = COALESCE(actual_completion_time, NOW()),
       updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  const signedRow = await loadOperationJoined(id);
  writeActivityLog({
    pageKey: 'verification',
    action: 'update',
    entityType: 'Operation',
    entityId: String(id),
    entityLabel: signedRow?.vessel_name || `Operation #${id}`,
    summary: 'Signed off operation (COMPLETED)',
    changes: [
      { field: 'Status', from: opRow?.status ?? null, to: 'COMPLETED' },
      { field: 'Actual Completion', from: opRow?.actual_completion_time ?? null, to: signedRow?.actual_completion_time ?? null },
    ],
    meta: { operationId: id },
    actorUserId: req.userId ?? null,
  }).catch(() => {});
  res.json(toOp(signedRow));
});

/** Record cast-off and mark vessel SAILED (after signoff / COMPLETED). */
router.post('/:id/depart', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const opRow = await loadOperationJoined(id);
  if (!opRow) return res.status(404).json({ error: 'Operation not found' });
  if (!canAccessOperationForSelectedPort(opRow, req.selectedPortId)) {
    return res.status(404).json({ error: 'Operation not found' });
  }
  if (opRow.status === 'SAILED') {
    return res.json(toOp(opRow));
  }
  if (opRow.status !== 'COMPLETED') {
    return res.status(400).json({ error: 'Operation must be COMPLETED (signoff) before depart' });
  }
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
  await pool.query(
    `UPDATE operations SET
       status = 'SAILED',
       cast_off_at = $1,
       clearance_document_url = $2,
       vessel_photo_url = $3,
       sailed_at = NOW(),
       updated_at = NOW()
     WHERE id = $4 AND deleted_at IS NULL`,
    [cast, clearanceUrl, photoUrl, id]
  );
  const sailRow = await loadOperationJoined(id);
  writeActivityLog({
    pageKey: 'verification',
    action: 'update',
    entityType: 'Operation',
    entityId: String(id),
    entityLabel: sailRow?.vessel_name || `Operation #${id}`,
    summary: 'Recorded vessel departure (SAILED)',
    changes: [
      { field: 'Status', from: opRow?.status ?? null, to: 'SAILED' },
      { field: 'Cast Off', from: opRow?.cast_off_at ?? null, to: sailRow?.cast_off_at ?? null },
    ],
    meta: { operationId: id },
    actorUserId: req.userId ?? null,
  }).catch(() => {});
  res.json(toOp(sailRow));
});

router.delete('/:id/materials/:materialId', async (req, res) => {
  const opId = parseInt(req.params.id, 10);
  const materialId = parseInt(req.params.materialId, 10);
  if (Number.isNaN(opId) || Number.isNaN(materialId)) {
    return res.status(400).json({ error: 'Invalid id' });
  }
  const opRow = await loadOperationJoined(opId);
  if (!opRow || !canAccessOperationForSelectedPort(opRow, req.selectedPortId)) {
    return res.status(404).json({ error: 'Operation not found' });
  }
  const result = await pool.query(
    `UPDATE operation_materials SET deleted_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND operation_id = $2 AND deleted_at IS NULL RETURNING id`,
    [materialId, opId]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Material row not found' });
  res.status(204).send();
});

/** Soft-delete operation and dependent rows (materials, QC, quantity). */
router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const opRow = await loadOperationJoined(id);
  if (!opRow || !canAccessOperationForSelectedPort(opRow, req.selectedPortId)) {
    return res.status(404).json({ error: 'Operation not found' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const op = await client.query(
      'SELECT id FROM operations WHERE id = $1 AND deleted_at IS NULL',
      [id]
    );
    if (op.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Operation not found' });
    }
    await client.query(
      `UPDATE qc_documents SET deleted_at = NOW(), updated_at = NOW()
       WHERE qc_survey_id IN (SELECT id FROM qc_surveys WHERE operation_id = $1 AND deleted_at IS NULL)
       AND deleted_at IS NULL`,
      [id]
    );
    await client.query(
      `UPDATE qc_surveys SET deleted_at = NOW(), updated_at = NOW() WHERE operation_id = $1 AND deleted_at IS NULL`,
      [id]
    );
    await client.query(
      `UPDATE quantity_checks SET deleted_at = NOW(), updated_at = NOW() WHERE operation_id = $1 AND deleted_at IS NULL`,
      [id]
    );
    await client.query(
      `UPDATE operation_materials SET deleted_at = NOW(), updated_at = NOW() WHERE operation_id = $1 AND deleted_at IS NULL`,
      [id]
    );
    await client.query(
      `UPDATE operations SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    await client.query('COMMIT');
    res.status(204).send();
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});

function toOp(row) {
  return {
    id: row.id,
    shippingInstructionId: row.shipping_instruction_id,
    jettyId: row.jetty_id,
    status: row.status,
    purpose: row.purpose,
    vesselName: row.vessel_name ?? undefined,
    referenceNumber: row.reference_number ?? undefined,
    commodity: row.commodity ?? undefined,
    jettyName: row.jetty_name ?? undefined,
    portId: row.port_id ?? null,
    portName: row.port_name ?? undefined,
    eta: row.eta ?? null,
    ta: row.ta ?? null,
    etb: row.etb ?? null,
    pob: row.pob ?? null,
    sob: row.sob ?? null,
    dockingStartTime: row.docking_start_time ?? null,
    estimatedCompletionTime: row.estimated_completion_time ?? null,
    actualCompletionTime: row.actual_completion_time ?? null,
    norTenderedAt: row.nor_tendered_at ?? null,
    norAcceptedAt: row.nor_accepted_at ?? null,
    tbAt: row.tb ?? null,
    demurrageLiabilityFromAt: row.demurrage_liability_from_at ?? null,
    completionPercent: row.completion_percent ?? 0,
    castOffAt: row.cast_off_at ?? null,
    clearanceDocumentUrl: row.clearance_document_url ?? null,
    vesselPhotoUrl: row.vessel_photo_url ?? null,
    sailedAt: row.sailed_at ?? null,
    exceptionStatus: row.exception_status ?? null,
    exceptionJustification: row.exception_justification ?? null,
    exceptionDocumentUrl: row.exception_document_url ?? null,
    exceptionRequestedAt: row.exception_requested_at ?? null,
    exceptionResolvedAt: row.exception_resolved_at ?? null,
    exceptionApproverUserId: row.exception_approver_user_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export default router;
