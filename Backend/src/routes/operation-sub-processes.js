/**
 * Operation sub-process + NOR detail endpoints (hybrid persistence).
 *
 * Base path: /api/v1
 * - GET/PUT    /operations/:operationId/sub-processes[/:subProcessKey]
 * - GET/POST   /operations/:operationId/sub-processes/:subProcessKey/documents
 * - GET/PUT    /operations/:operationId/nor-details
 */
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { pool } from '../db.js';
import { UPLOAD_ROOT } from '../paths.js';
import { writeActivityLog } from '../lib/activity-log.js';
import { optionalAuth } from '../middleware/auth.js';

const router = express.Router();
router.use(optionalAuth);
const ALLOWED_PHASES = new Set(['Pre-Checking', 'Operational', 'Post-Checking']);

function parseOperationId(raw) {
  const v = parseInt(raw, 10);
  return Number.isNaN(v) ? null : v;
}

function cleanKey(raw) {
  return String(raw || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

function cleanPhase(raw) {
  const v = String(raw || '').trim();
  return ALLOWED_PHASES.has(v) ? v : null;
}

function parseTs(v) {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

function sanitizePayload(v) {
  if (v == null) return null;
  return v;
}

function normalizeForChange(v) {
  if (v == null) return null;
  if (typeof v === 'string') {
    const trimmed = v.trim();
    return trimmed === '' ? null : trimmed;
  }
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function summarizeSamplingRecords(payload) {
  const records = Array.isArray(payload?.records) ? payload.records : [];
  if (records.length === 0) return null;
  return records
    .map((r) => {
      const palka = r?.noPalka ?? '-';
      const ffa = r?.ffa ?? '-';
      const moisture = r?.moisture ?? '-';
      return `${palka} (FFA:${ffa}, Moisture:${moisture})`;
    })
    .join('; ');
}

function safeBaseName(name) {
  const base = String(name || '').split(/[\\/]/).pop() || 'file';
  return base.replace(/[^\w.\-()+ ]/g, '_').slice(0, 120);
}

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

async function ensureOperationExists(operationId) {
  const r = await pool.query(
    `SELECT id FROM operations WHERE id = $1 AND deleted_at IS NULL`,
    [operationId]
  );
  return r.rows.length > 0;
}

async function loadSubProcess(operationId, phase, key) {
  const r = await pool.query(
    `SELECT id, operation_id, phase, sub_process_key, status, occurred_at, remark, payload_json, created_at, updated_at
     FROM operation_sub_processes
     WHERE operation_id = $1
       AND phase = $2
       AND sub_process_key = $3
       AND deleted_at IS NULL
     ORDER BY id DESC
     LIMIT 1`,
    [operationId, phase, key]
  );
  return r.rows[0] ?? null;
}

async function upsertSubProcess(operationId, phase, subProcessKey, body = {}) {
  const key = cleanKey(subProcessKey);
  const occurredAt = parseTs(body.occurredAt);
  const status = body.status != null ? String(body.status).trim() : undefined;
  const remark = body.remark != null ? String(body.remark) : undefined;
  const payload = sanitizePayload(body.payload);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ex = await client.query(
      `SELECT id
       FROM operation_sub_processes
       WHERE operation_id = $1 AND phase = $2 AND sub_process_key = $3 AND deleted_at IS NULL
       LIMIT 1`,
      [operationId, phase, key]
    );
    let id;
    if (ex.rows.length > 0) {
      id = ex.rows[0].id;
      await client.query(
        `UPDATE operation_sub_processes SET
           status = COALESCE($1, status),
           occurred_at = CASE WHEN $2::timestamptz IS NULL AND $3::boolean THEN NULL ELSE COALESCE($2, occurred_at) END,
           remark = CASE WHEN $4::boolean THEN COALESCE($5, '') ELSE remark END,
           payload_json = CASE WHEN $6::boolean THEN $7::jsonb ELSE payload_json END,
           updated_at = NOW()
         WHERE id = $8`,
        [
          status !== undefined ? status : null,
          occurredAt === undefined ? null : occurredAt,
          occurredAt !== undefined,
          remark !== undefined,
          remark !== undefined ? remark : null,
          payload !== undefined,
          payload !== undefined ? JSON.stringify(payload) : null,
          id,
        ]
      );
    } else {
      const ins = await client.query(
        `INSERT INTO operation_sub_processes
         (operation_id, phase, sub_process_key, status, occurred_at, remark, payload_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id`,
        [
          operationId,
          phase,
          key,
          status ?? null,
          occurredAt === undefined ? null : occurredAt,
          remark ?? null,
          payload !== undefined ? JSON.stringify(payload) : null,
        ]
      );
      id = ins.rows[0].id;
    }
    await client.query('COMMIT');
    return id;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

function toSubProcessRow(r) {
  return {
    id: r.id,
    operationId: r.operation_id,
    phase: r.phase,
    subProcessKey: r.sub_process_key,
    status: r.status ?? null,
    occurredAt: r.occurred_at ?? null,
    remark: r.remark ?? null,
    payload: r.payload_json ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      const operationId = String(req.params.operationId || '').trim();
      const key = cleanKey(req.params.subProcessKey || '');
      const dir = path.join(UPLOAD_ROOT, 'operations', operationId, 'sub-processes', key);
      await ensureDir(dir);
      cb(null, dir);
    } catch (e) {
      cb(e);
    }
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '');
    const rand = crypto.randomBytes(12).toString('hex');
    const stored = `${Date.now()}-${rand}${ext}`;
    cb(null, stored);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
});

router.get('/operations/:operationId/sub-processes', async (req, res) => {
  const operationId = parseOperationId(req.params.operationId);
  if (operationId == null) return res.status(400).json({ error: 'Invalid operationId' });

  const phase = req.query.phase ? cleanPhase(req.query.phase) : null;
  if (req.query.phase && !phase) {
    return res.status(400).json({ error: 'Invalid phase' });
  }

  const r = await pool.query(
    `SELECT id, operation_id, phase, sub_process_key, status, occurred_at, remark, payload_json, created_at, updated_at
     FROM operation_sub_processes
     WHERE operation_id = $1
       AND deleted_at IS NULL
       AND ($2::text IS NULL OR phase = $2)
     ORDER BY phase ASC, sub_process_key ASC, id ASC`,
    [operationId, phase]
  );

  res.json(r.rows.map(toSubProcessRow));
});

router.put('/operations/:operationId/sub-processes/:subProcessKey', async (req, res) => {
  const operationId = parseOperationId(req.params.operationId);
  if (operationId == null) return res.status(400).json({ error: 'Invalid operationId' });
  const key = cleanKey(req.params.subProcessKey);
  if (!key) return res.status(400).json({ error: 'subProcessKey required' });

  const phase = cleanPhase(req.body?.phase);
  if (!phase) return res.status(400).json({ error: 'phase must be Pre-Checking, Operational, or Post-Checking' });

  if (!(await ensureOperationExists(operationId))) {
    return res.status(404).json({ error: 'Operation not found' });
  }

  const before = await loadSubProcess(operationId, phase, key);
  const id = await upsertSubProcess(operationId, phase, key, req.body || {});
  const out = await pool.query(
    `SELECT id, operation_id, phase, sub_process_key, status, occurred_at, remark, payload_json, created_at, updated_at
     FROM operation_sub_processes
     WHERE id = $1`,
    [id]
  );
  const after = out.rows[0] ?? null;
  const changes = [
    { field: 'Phase', from: normalizeForChange(before?.phase), to: normalizeForChange(after?.phase) },
    { field: 'Sub-process', from: normalizeForChange(before?.sub_process_key), to: normalizeForChange(after?.sub_process_key) },
    { field: 'Status', from: normalizeForChange(before?.status), to: normalizeForChange(after?.status) },
    { field: 'Occurred At', from: normalizeForChange(before?.occurred_at), to: normalizeForChange(after?.occurred_at) },
    { field: 'Remark', from: normalizeForChange(before?.remark), to: normalizeForChange(after?.remark) },
    ...(key === 'sampling'
      ? [
          {
            field: 'Sampling Records',
            from: normalizeForChange(summarizeSamplingRecords(before?.payload_json)),
            to: normalizeForChange(summarizeSamplingRecords(after?.payload_json)),
          },
        ]
      : []),
  ].filter((c) => c.from !== c.to);

  writeActivityLog({
    pageKey: 'loading',
    action: before ? 'update' : 'add',
    entityType: 'Pre-Checking',
    entityId: String(operationId),
    entityLabel: key.replace(/_/g, ' '),
    summary: `${before ? 'Updated' : 'Created'} pre-checking step (${phase})`,
    changes,
    meta: { operationId, subProcessKey: key, phase },
    actorUserId: req.userId ?? null,
  }).catch(() => {});
  res.json(toSubProcessRow(out.rows[0]));
});

/** Soft-delete one sub-process row and its documents (activity log entry). */
router.delete('/operations/:operationId/sub-processes/:subProcessKey', async (req, res) => {
  const operationId = parseOperationId(req.params.operationId);
  if (operationId == null) return res.status(400).json({ error: 'Invalid operationId' });
  const key = cleanKey(req.params.subProcessKey);
  if (!key) return res.status(400).json({ error: 'subProcessKey required' });
  const phase = cleanPhase(req.query.phase || '');
  if (!phase) return res.status(400).json({ error: 'phase query must be Pre-Checking, Operational, or Post-Checking' });

  if (!(await ensureOperationExists(operationId))) {
    return res.status(404).json({ error: 'Operation not found' });
  }

  const row = await loadSubProcess(operationId, phase, key);
  if (!row) return res.status(404).json({ error: 'Sub-process not found' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE operation_sub_process_documents
       SET deleted_at = NOW(), updated_at = NOW()
       WHERE sub_process_id = $1 AND deleted_at IS NULL`,
      [row.id]
    );
    await client.query(
      `UPDATE operation_sub_processes SET deleted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND deleted_at IS NULL`,
      [row.id]
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  writeActivityLog({
    pageKey: 'loading',
    action: 'delete',
    entityType: phase,
    entityId: String(operationId),
    entityLabel: key.replace(/_/g, ' '),
    summary: `Deleted ${phase} step: ${key.replace(/_/g, ' ')}`,
    changes: [{ field: 'Sub-process', from: key, to: null }],
    meta: { operationId, subProcessKey: key, phase },
    actorUserId: req.userId ?? null,
  }).catch(() => {});

  res.status(204).send();
});

router.get('/operations/:operationId/sub-processes/:subProcessKey/documents', async (req, res) => {
  const operationId = parseOperationId(req.params.operationId);
  if (operationId == null) return res.status(400).json({ error: 'Invalid operationId' });
  const key = cleanKey(req.params.subProcessKey);
  if (!key) return res.status(400).json({ error: 'subProcessKey required' });
  const phase = cleanPhase(req.query.phase || req.body?.phase || 'Pre-Checking');
  if (!phase) return res.status(400).json({ error: 'Invalid phase' });

  const row = await loadSubProcess(operationId, phase, key);
  if (!row) return res.json([]);

  const d = await pool.query(
    `SELECT id, sub_process_id, original_name, stored_name, stored_path, mime_type, size_bytes, created_at
     FROM operation_sub_process_documents
     WHERE sub_process_id = $1 AND deleted_at IS NULL
     ORDER BY created_at DESC, id DESC`,
    [row.id]
  );
  res.json(
    d.rows.map((x) => ({
      id: x.id,
      subProcessId: x.sub_process_id,
      name: x.original_name,
      url: `/uploads/${String(x.stored_path || '').replace(/\\/g, '/')}`,
      mimeType: x.mime_type ?? null,
      sizeBytes: x.size_bytes != null ? Number(x.size_bytes) : null,
      createdAt: x.created_at,
    }))
  );
});

router.post('/operations/:operationId/sub-processes/:subProcessKey/documents', upload.array('files', 10), async (req, res) => {
  const operationId = parseOperationId(req.params.operationId);
  if (operationId == null) return res.status(400).json({ error: 'Invalid operationId' });
  const key = cleanKey(req.params.subProcessKey);
  if (!key) return res.status(400).json({ error: 'subProcessKey required' });
  const phase = cleanPhase(req.body?.phase || req.query.phase || 'Pre-Checking');
  if (!phase) return res.status(400).json({ error: 'Invalid phase' });
  if (!(await ensureOperationExists(operationId))) {
    return res.status(404).json({ error: 'Operation not found' });
  }

  const files = Array.isArray(req.files) ? req.files : [];
  if (files.length === 0) return res.status(400).json({ error: 'No files uploaded' });

  const subProcessId = await upsertSubProcess(operationId, phase, key, { phase });
  const inserted = [];
  for (const f of files) {
    const original = safeBaseName(f.originalname);
    const rel = path.relative(UPLOAD_ROOT, f.path);
    const ins = await pool.query(
      `INSERT INTO operation_sub_process_documents
       (sub_process_id, original_name, stored_name, stored_path, mime_type, size_bytes)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, created_at`,
      [subProcessId, original, f.filename, rel, f.mimetype ?? null, f.size ?? null]
    );
    inserted.push({
      id: ins.rows[0].id,
      subProcessId,
      name: original,
      url: `/uploads/${rel.replace(/\\/g, '/')}`,
      createdAt: ins.rows[0].created_at,
    });
  }
  writeActivityLog({
    pageKey: 'loading',
    action: 'add',
    entityType: 'Pre-Checking Document',
    entityId: String(operationId),
    entityLabel: key.replace(/_/g, ' '),
    summary: `Uploaded ${inserted.length} pre-checking file(s) (${phase})`,
    changes: inserted.map((x) => ({
      field: 'Document',
      from: null,
      to: x.name,
    })),
    meta: { operationId, subProcessKey: key, phase, names: inserted.map((x) => x.name) },
    actorUserId: req.userId ?? null,
  }).catch(() => {});
  res.status(201).json({ items: inserted });
});

router.delete(
  '/operations/:operationId/sub-processes/:subProcessKey/documents/:documentId',
  async (req, res) => {
    const operationId = parseOperationId(req.params.operationId);
    const documentId = parseInt(req.params.documentId, 10);
    if (operationId == null || !Number.isFinite(documentId)) {
      return res.status(400).json({ error: 'Invalid operation or document id' });
    }
    const key = cleanKey(req.params.subProcessKey);
    if (!key) return res.status(400).json({ error: 'subProcessKey required' });
    const phase = cleanPhase(req.query.phase || 'Pre-Checking');
    if (!phase) return res.status(400).json({ error: 'Invalid phase' });

    const row = await loadSubProcess(operationId, phase, key);
    if (!row) return res.status(404).json({ error: 'Sub-process not found' });

    const u = await pool.query(
      `UPDATE operation_sub_process_documents
       SET deleted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND sub_process_id = $2 AND deleted_at IS NULL
       RETURNING id, original_name`,
      [documentId, row.id]
    );
    if (u.rows.length === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }
    writeActivityLog({
      pageKey: 'loading',
      action: 'delete',
      entityType: 'Pre-Checking Document',
      entityId: String(operationId),
      entityLabel: key.replace(/_/g, ' '),
      summary: `Removed pre-checking document: ${u.rows[0].original_name || documentId}`,
      changes: [
        { field: 'Document', from: u.rows[0].original_name || String(documentId), to: null },
      ],
      meta: { operationId, subProcessKey: key, documentId },
      actorUserId: req.userId ?? null,
    }).catch(() => {});
    res.status(204).send();
  }
);

router.get('/operations/:operationId/nor-details', async (req, res) => {
  const operationId = parseOperationId(req.params.operationId);
  if (operationId == null) return res.status(400).json({ error: 'Invalid operationId' });
  const r = await pool.query(
    `SELECT id, operation_id, remark, payload_json, created_at, updated_at
     FROM operation_nor_details
     WHERE operation_id = $1 AND deleted_at IS NULL
     ORDER BY id DESC
     LIMIT 1`,
    [operationId]
  );
  if (r.rows.length === 0) {
    return res.json({ operationId, remark: null, payload: null });
  }
  const row = r.rows[0];
  res.json({
    id: row.id,
    operationId: row.operation_id,
    remark: row.remark ?? null,
    payload: row.payload_json ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
});

router.put('/operations/:operationId/nor-details', async (req, res) => {
  const operationId = parseOperationId(req.params.operationId);
  if (operationId == null) return res.status(400).json({ error: 'Invalid operationId' });
  if (!(await ensureOperationExists(operationId))) {
    return res.status(404).json({ error: 'Operation not found' });
  }

  const body = req.body || {};
  const remarkProvided = Object.prototype.hasOwnProperty.call(body, 'remark');
  const remark =
    remarkProvided && body.remark != null ? String(body.remark) : remarkProvided ? null : undefined;
  const payloadIn = Object.prototype.hasOwnProperty.call(body, 'payload') ? body.payload : undefined;

  function normalizePayload(raw) {
    if (raw == null) return {};
    if (typeof raw === 'string') {
      try {
        const o = JSON.parse(raw);
        return o && typeof o === 'object' ? o : {};
      } catch {
        return {};
      }
    }
    return typeof raw === 'object' ? raw : {};
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ex = await client.query(
      `SELECT id, remark, payload_json
       FROM operation_nor_details
       WHERE operation_id = $1 AND deleted_at IS NULL
       LIMIT 1`,
      [operationId]
    );
    let id;
    let beforeRemark = null;
    let beforePayload = {};
    let afterPayload = {};
    let afterRemark = null;
    if (ex.rows.length > 0) {
      id = ex.rows[0].id;
      const prevPayload = normalizePayload(ex.rows[0].payload_json);
      beforePayload = prevPayload;
      beforeRemark = ex.rows[0].remark ?? null;
      const nextPayload =
        payloadIn !== undefined && payloadIn !== null && typeof payloadIn === 'object'
          ? { ...prevPayload, ...payloadIn }
          : prevPayload;
      const nextRemark = remark !== undefined ? remark : ex.rows[0].remark ?? null;
      afterPayload = nextPayload;
      afterRemark = nextRemark;
      await client.query(
        `UPDATE operation_nor_details SET
           remark = $1,
           payload_json = $2::jsonb,
           updated_at = NOW()
         WHERE id = $3`,
        [nextRemark, JSON.stringify(nextPayload), id]
      );
    } else {
      const nextPayload =
        payloadIn !== undefined && payloadIn !== null && typeof payloadIn === 'object'
          ? payloadIn
          : {};
      const nextRemark = remark !== undefined ? remark : null;
      beforePayload = {};
      beforeRemark = null;
      afterPayload = nextPayload;
      afterRemark = nextRemark;
      const ins = await client.query(
        `INSERT INTO operation_nor_details (operation_id, remark, payload_json)
         VALUES ($1,$2,$3::jsonb)
         RETURNING id`,
        [operationId, nextRemark, JSON.stringify(nextPayload)]
      );
      id = ins.rows[0].id;
    }
    await client.query('COMMIT');
    const out = await pool.query(
      `SELECT id, operation_id, remark, payload_json, created_at, updated_at
       FROM operation_nor_details
       WHERE id = $1`,
      [id]
    );
    const row = out.rows[0];
    const changes = [
      { field: 'Remark', from: normalizeForChange(beforeRemark), to: normalizeForChange(afterRemark) },
      {
        field: 'NOR Source',
        from: normalizeForChange(beforePayload?.norSource ?? null),
        to: normalizeForChange(afterPayload?.norSource ?? null),
      },
      {
        field: 'NOR Stage',
        from: normalizeForChange(beforePayload?.norStage ?? null),
        to: normalizeForChange(afterPayload?.norStage ?? null),
      },
      {
        field: 'Updated Via',
        from: normalizeForChange(beforePayload?.updatedVia ?? null),
        to: normalizeForChange(afterPayload?.updatedVia ?? null),
      },
    ].filter((c) => c.from !== c.to);
    writeActivityLog({
      pageKey: 'loading',
      action: ex.rows.length > 0 ? 'update' : 'add',
      entityType: 'NOR Details',
      entityId: String(operationId),
      entityLabel: `Operation #${operationId}`,
      summary: `${ex.rows.length > 0 ? 'Updated' : 'Created'} NOR Accepted details`,
      changes,
      meta: { operationId },
      actorUserId: req.userId ?? null,
    }).catch(() => {});
    res.json({
      id: row.id,
      operationId: row.operation_id,
      remark: row.remark ?? null,
      payload: row.payload_json ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});

export default router;

