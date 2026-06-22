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
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { pool } from '../db.js';
import { assertOperationInSelectedPort } from '../lib/operation-access.js';
import { UPLOAD_ROOT } from '../paths.js';
import { validateMulterFileList } from '../lib/upload-mime.js';
import { writeActivityLog } from '../lib/activity-log.js';
import { sendStoredFileAttachment, sendStoredFileInline } from '../lib/send-stored-file.js';
import { promoteInProgressToPostOpsIfInProgress } from '../lib/operation-auto-status.js';
import { loadOperationScheduleTimezone, parseScheduleInstantToIso } from '../lib/schedule-instant.js';

const POST_CHECK_AUTO_KEYS = new Set([
  'final_inspection',
  'final_tank_inspection',
  'final_hold_inspection',
  'final_sounding',
]);

const router = express.Router();
const ALLOWED_PHASES = new Set(['Pre-Checking', 'Operational', 'Post-Checking']);

function toSubProcessDocumentDownloadUrl(id) {
  return `/api/v1/sub-process-documents/${id}/download`;
}

function resolveStoredPath(storedPath) {
  const full = path.resolve(UPLOAD_ROOT, String(storedPath || ''));
  const root = path.resolve(UPLOAD_ROOT);
  if (!full.startsWith(root)) return null;
  return full;
}

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

/** Legacy key normalization for merged subprocess tabs. */
function normalizeLegacySubProcessKey(phase, rawKey) {
  const k = cleanKey(rawKey);
  if (phase === 'Pre-Checking' && (k === 'tank_inspection' || k === 'hold_inspection')) {
    return 'inspection';
  }
  if (phase === 'Pre-Checking' && (k === 'initial_sounding' || k === 'initial_draft_survey')) {
    return 'initial_cargo_checking';
  }
  return k;
}

function parseTs(v, scheduleTz) {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const out = parseScheduleInstantToIso(v, scheduleTz);
  return out === undefined ? undefined : out;
}

/** Non-empty body field must parse; otherwise we risk merging bad data and hitting DB check. */
function assertParsedIfProvided(label, raw, parsed) {
  if (raw === undefined) return;
  if (raw === null || raw === '') return;
  if (String(raw).trim() === '') return;
  if (parsed === undefined) {
    throw Object.assign(new Error(`Invalid ${label}`), { statusCode: 400 });
  }
}

/** After UPDATE merge rules, both timestamps set ⇒ end >= start (matches operation_sub_processes_time_range_check). */
function assertEffectiveTimeRange(effStart, effEnd) {
  if (effStart == null || effEnd == null) return;
  const s = new Date(effStart).getTime();
  const e = new Date(effEnd).getTime();
  if (Number.isNaN(s) || Number.isNaN(e)) return;
  if (e < s) {
    throw Object.assign(new Error('Invalid time range: end must be on or after start'), { statusCode: 400 });
  }
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

async function assertOperationAccess(operationId, req) {
  await assertOperationInSelectedPort(operationId, req.selectedPortId);
}

/** First breakdown line commodity type for the operation’s shipping instruction. */
async function loadOperationPrecheckContext(operationId) {
  const r = await pool.query(
    `SELECT o.purpose,
            COALESCE(
              (SELECT sc.commodity_type FROM shipping_instruction_breakdown b
               JOIN si_commodities sc ON sc.id = b.commodity_id AND sc.deleted_at IS NULL
               WHERE b.shipping_instruction_id = o.shipping_instruction_id AND b.deleted_at IS NULL
               ORDER BY b.line_order, b.id LIMIT 1),
              'Liquid'
            ) AS commodity_type
     FROM operations o
     WHERE o.id = $1 AND o.deleted_at IS NULL`,
    [operationId]
  );
  return r.rows[0] ?? null;
}

async function loadSubProcess(operationId, phase, key) {
  const r = await pool.query(
    `SELECT id, operation_id, phase, sub_process_key, status, occurred_at, start_at, end_at, skip_reason, remark, payload_json, created_at, updated_at
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
  const scheduleTz = await loadOperationScheduleTimezone(pool, operationId);
  const occurredAt = parseTs(body.occurredAt, scheduleTz);
  const startAt = parseTs(body.startAt, scheduleTz);
  const endAt = parseTs(body.endAt, scheduleTz);
  const status = body.status != null ? String(body.status).trim() : undefined;
  const skipReason = body.skipReason != null ? String(body.skipReason).trim() : undefined;
  const remark = body.remark != null ? String(body.remark) : undefined;
  const payload = sanitizePayload(body.payload);
  if (status === 'Skipped' && !(skipReason && skipReason.trim())) {
    throw Object.assign(new Error('skipReason is required when status is Skipped'), { statusCode: 400 });
  }

  assertParsedIfProvided('occurredAt', body.occurredAt, occurredAt);
  assertParsedIfProvided('startAt', body.startAt, startAt);
  assertParsedIfProvided('endAt', body.endAt, endAt);

  const isPostChecking = phase === 'Post-Checking';
  /** Post-Checking: full replace of time columns (omit/undefined → NULL). Pre-Checking keeps COALESCE merge. */
  const pcOcc = occurredAt === undefined ? null : occurredAt;
  const pcStart = startAt === undefined ? null : startAt;
  const pcEnd = endAt === undefined ? null : endAt;

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
      if (isPostChecking) {
        assertEffectiveTimeRange(pcStart, pcEnd);
        await client.query(
          `UPDATE operation_sub_processes SET
             status = COALESCE($1, status),
             occurred_at = $2,
             start_at = $3,
             end_at = $4,
             skip_reason = CASE WHEN $5::boolean THEN NULLIF($6, '') ELSE skip_reason END,
             remark = CASE WHEN $7::boolean THEN COALESCE($8, '') ELSE remark END,
             payload_json = CASE WHEN $9::boolean THEN $10::jsonb ELSE payload_json END,
             updated_at = NOW()
           WHERE id = $11`,
          [
            status !== undefined ? status : null,
            pcOcc,
            pcStart,
            pcEnd,
            skipReason !== undefined,
            skipReason !== undefined ? skipReason : null,
            remark !== undefined,
            remark !== undefined ? remark : null,
            payload !== undefined,
            payload !== undefined ? JSON.stringify(payload) : null,
            id,
          ]
        );
      } else {
        const cur = await client.query(
          `SELECT start_at, end_at FROM operation_sub_processes WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
          [id]
        );
        const row = cur.rows[0];
        const effStart = startAt === undefined ? row?.start_at ?? null : startAt;
        const effEnd = endAt === undefined ? row?.end_at ?? null : endAt;
        assertEffectiveTimeRange(effStart, effEnd);
        await client.query(
          `UPDATE operation_sub_processes SET
             status = COALESCE($1, status),
             occurred_at = CASE WHEN $2::timestamptz IS NULL AND $3::boolean THEN NULL ELSE COALESCE($2, occurred_at) END,
             start_at = CASE WHEN $4::timestamptz IS NULL AND $5::boolean THEN NULL ELSE COALESCE($4, start_at) END,
             end_at = CASE WHEN $6::timestamptz IS NULL AND $7::boolean THEN NULL ELSE COALESCE($6, end_at) END,
             skip_reason = CASE WHEN $8::boolean THEN NULLIF($9, '') ELSE skip_reason END,
             remark = CASE WHEN $10::boolean THEN COALESCE($11, '') ELSE remark END,
             payload_json = CASE WHEN $12::boolean THEN $13::jsonb ELSE payload_json END,
             updated_at = NOW()
           WHERE id = $14`,
          [
            status !== undefined ? status : null,
            occurredAt === undefined ? null : occurredAt,
            occurredAt !== undefined,
            startAt === undefined ? null : startAt,
            startAt !== undefined,
            endAt === undefined ? null : endAt,
            endAt !== undefined,
            skipReason !== undefined,
            skipReason !== undefined ? skipReason : null,
            remark !== undefined,
            remark !== undefined ? remark : null,
            payload !== undefined,
            payload !== undefined ? JSON.stringify(payload) : null,
            id,
          ]
        );
      }
    } else {
      if (isPostChecking) {
        assertEffectiveTimeRange(pcStart, pcEnd);
      } else {
        assertEffectiveTimeRange(startAt === undefined ? null : startAt, endAt === undefined ? null : endAt);
      }
      const ins = await client.query(
        `INSERT INTO operation_sub_processes
         (operation_id, phase, sub_process_key, status, occurred_at, start_at, end_at, skip_reason, remark, payload_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING id`,
        [
          operationId,
          phase,
          key,
          status ?? null,
          isPostChecking ? pcOcc : occurredAt === undefined ? null : occurredAt,
          isPostChecking ? pcStart : startAt === undefined ? null : startAt,
          isPostChecking ? pcEnd : endAt === undefined ? null : endAt,
          skipReason ?? null,
          remark ?? null,
          payload !== undefined ? JSON.stringify(payload) : null,
        ]
      );
      id = ins.rows[0].id;
    }
    if (phase === 'Post-Checking' && POST_CHECK_AUTO_KEYS.has(key)) {
      await promoteInProgressToPostOpsIfInProgress(client, operationId);
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
    startAt: r.start_at ?? r.occurred_at ?? null,
    endAt: r.end_at ?? null,
    skipReason: r.skip_reason ?? null,
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
      const phase = cleanPhase(req.body?.phase || req.query?.phase || 'Pre-Checking') || 'Pre-Checking';
      const key = normalizeLegacySubProcessKey(phase, req.params.subProcessKey || '');
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
  await assertOperationAccess(operationId, req);

  const phase = req.query.phase ? cleanPhase(req.query.phase) : null;
  if (req.query.phase && !phase) {
    return res.status(400).json({ error: 'Invalid phase' });
  }

  const r = await pool.query(
    `SELECT id, operation_id, phase, sub_process_key, status, occurred_at, start_at, end_at, skip_reason, remark, payload_json, created_at, updated_at
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
  const phase = cleanPhase(req.body?.phase);
  if (!phase) return res.status(400).json({ error: 'phase must be Pre-Checking, Operational, or Post-Checking' });
  let key = normalizeLegacySubProcessKey(phase, req.params.subProcessKey);
  if (!key) return res.status(400).json({ error: 'subProcessKey required' });
  if (String(req.body?.status || '') === 'Skipped' && !String(req.body?.skipReason || '').trim()) {
    return res.status(400).json({ error: 'skipReason is required when status is Skipped' });
  }

  await assertOperationAccess(operationId, req);

  if (phase === 'Pre-Checking' && key === 'inspection') {
    const ctx = await loadOperationPrecheckContext(operationId);
    if (!ctx) return res.status(404).json({ error: 'Operation not found' });
    if (ctx.purpose === 'Unloading') {
      return res.status(400).json({ error: 'Inspection does not apply to Unloading operations.' });
    }
    const expected = ctx.commodity_type === 'Solid' ? 'Hold' : 'Tank';
    const payloadIn = req.body?.payload;
    if (payloadIn != null && typeof payloadIn !== 'object') {
      return res.status(400).json({ error: 'payload must be an object' });
    }
    const clientType = payloadIn && typeof payloadIn === 'object' ? payloadIn.inspectionType : null;
    if (clientType != null && clientType !== expected) {
      return res.status(400).json({
        error: `Inspection type must be ${expected} for this shipping instruction (commodity is ${
          ctx.commodity_type === 'Solid' ? 'Solid' : 'Liquid'
        }).`,
      });
    }
    req.body.payload = { ...(payloadIn && typeof payloadIn === 'object' ? payloadIn : {}), inspectionType: expected };
  }

  if (phase === 'Pre-Checking' && key === 'initial_cargo_checking') {
    const ctx = await loadOperationPrecheckContext(operationId);
    if (!ctx) return res.status(404).json({ error: 'Operation not found' });
    const expected = ctx.commodity_type === 'Solid' ? 'Draft Survey' : 'Sounding';
    const payloadIn = req.body?.payload;
    if (payloadIn != null && typeof payloadIn !== 'object') {
      return res.status(400).json({ error: 'payload must be an object' });
    }
    const clientType = payloadIn && typeof payloadIn === 'object' ? payloadIn.cargoCheckingType : null;
    if (clientType != null && clientType !== expected) {
      return res.status(400).json({
        error: `Initial cargo checking type must be "${expected}" for this shipping instruction (commodity is ${
          ctx.commodity_type === 'Solid' ? 'Solid' : 'Liquid'
        }).`,
      });
    }
    req.body.payload = { ...(payloadIn && typeof payloadIn === 'object' ? payloadIn : {}), cargoCheckingType: expected };
  }

  const before = await loadSubProcess(operationId, phase, key);
  const id = await upsertSubProcess(operationId, phase, key, req.body || {});
  const out = await pool.query(
    `SELECT id, operation_id, phase, sub_process_key, status, occurred_at, start_at, end_at, skip_reason, remark, payload_json, created_at, updated_at
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
    { field: 'Start At', from: normalizeForChange(before?.start_at), to: normalizeForChange(after?.start_at) },
    { field: 'End At', from: normalizeForChange(before?.end_at), to: normalizeForChange(after?.end_at) },
    { field: 'Skip Reason', from: normalizeForChange(before?.skip_reason), to: normalizeForChange(after?.skip_reason) },
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
  const phase = cleanPhase(req.query.phase || '');
  if (!phase) return res.status(400).json({ error: 'phase query must be Pre-Checking, Operational, or Post-Checking' });
  const key = normalizeLegacySubProcessKey(phase, req.params.subProcessKey);
  if (!key) return res.status(400).json({ error: 'subProcessKey required' });

  await assertOperationAccess(operationId, req);

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
  await assertOperationAccess(operationId, req);
  const phase = cleanPhase(req.query.phase || req.body?.phase || 'Pre-Checking');
  if (!phase) return res.status(400).json({ error: 'Invalid phase' });
  const key = normalizeLegacySubProcessKey(phase, req.params.subProcessKey);
  if (!key) return res.status(400).json({ error: 'subProcessKey required' });

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
      url: toSubProcessDocumentDownloadUrl(x.id),
      mimeType: x.mime_type ?? null,
      sizeBytes: x.size_bytes != null ? Number(x.size_bytes) : null,
      createdAt: x.created_at,
    }))
  );
});

router.post('/operations/:operationId/sub-processes/:subProcessKey/documents', upload.array('files', 10), async (req, res) => {
  const operationId = parseOperationId(req.params.operationId);
  if (operationId == null) return res.status(400).json({ error: 'Invalid operationId' });
  await assertOperationAccess(operationId, req);
  const phase = cleanPhase(req.body?.phase || req.query.phase || 'Pre-Checking');
  if (!phase) return res.status(400).json({ error: 'Invalid phase' });
  const key = normalizeLegacySubProcessKey(phase, req.params.subProcessKey);
  if (!key) return res.status(400).json({ error: 'subProcessKey required' });

  const files = Array.isArray(req.files) ? req.files : [];
  if (files.length === 0) return res.status(400).json({ error: 'No files uploaded' });

  try {
    await validateMulterFileList(files);
  } catch (e) {
    const code = e?.statusCode || 400;
    return res.status(code).json({ error: e?.message || 'Invalid file type' });
  }

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
      url: toSubProcessDocumentDownloadUrl(ins.rows[0].id),
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

async function loadSubProcessDocumentRow(documentId) {
  const r = await pool.query(
    `SELECT d.id, d.original_name, d.stored_path, sp.operation_id
     FROM operation_sub_process_documents d
     JOIN operation_sub_processes sp
       ON sp.id = d.sub_process_id
      AND sp.deleted_at IS NULL
     WHERE d.id = $1
       AND d.deleted_at IS NULL`,
    [documentId]
  );
  return r.rows[0] || null;
}

router.get('/sub-process-documents/:documentId/view', async (req, res) => {
  const documentId = parseInt(req.params.documentId, 10);
  if (!Number.isFinite(documentId)) return res.status(400).json({ error: 'Invalid document id' });
  const row = await loadSubProcessDocumentRow(documentId);
  if (!row) return res.status(404).json({ error: 'Document not found' });
  await assertOperationInSelectedPort(row.operation_id, req.selectedPortId);
  const full = resolveStoredPath(row.stored_path);
  if (!full || !fsSync.existsSync(full)) {
    return res.status(404).json({ error: 'Document file not found' });
  }
  return sendStoredFileInline(res, full, row.original_name, `sub-process-document-${documentId}`);
});

router.get('/sub-process-documents/:documentId/download', async (req, res) => {
  const documentId = parseInt(req.params.documentId, 10);
  if (!Number.isFinite(documentId)) return res.status(400).json({ error: 'Invalid document id' });
  const row = await loadSubProcessDocumentRow(documentId);
  if (!row) return res.status(404).json({ error: 'Document not found' });
  await assertOperationInSelectedPort(row.operation_id, req.selectedPortId);
  const full = resolveStoredPath(row.stored_path);
  if (!full || !fsSync.existsSync(full)) {
    return res.status(404).json({ error: 'Document file not found' });
  }
  return sendStoredFileAttachment(res, full, row.original_name, `sub-process-document-${documentId}`);
});

router.delete(
  '/operations/:operationId/sub-processes/:subProcessKey/documents/:documentId',
  async (req, res) => {
    const operationId = parseOperationId(req.params.operationId);
    const documentId = parseInt(req.params.documentId, 10);
    if (operationId == null || !Number.isFinite(documentId)) {
      return res.status(400).json({ error: 'Invalid operation or document id' });
    }
    await assertOperationAccess(operationId, req);
    const phase = cleanPhase(req.query.phase || 'Pre-Checking');
    if (!phase) return res.status(400).json({ error: 'Invalid phase' });
    const key = normalizeLegacySubProcessKey(phase, req.params.subProcessKey);
    if (!key) return res.status(400).json({ error: 'subProcessKey required' });

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
  await assertOperationAccess(operationId, req);
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
  await assertOperationAccess(operationId, req);

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

  const demurrageProvided = Object.prototype.hasOwnProperty.call(body, 'demurrageLiabilityFromAt');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const scheduleTz = await loadOperationScheduleTimezone(client, operationId);
    const opDemRes = await client.query(
      `SELECT demurrage_liability_from_at FROM operations WHERE id = $1 AND deleted_at IS NULL`,
      [operationId]
    );
    const beforeDemurrage = opDemRes.rows[0]?.demurrage_liability_from_at ?? null;
    let afterDemurrage = beforeDemurrage;

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

    if (demurrageProvided) {
      const raw = body.demurrageLiabilityFromAt;
      let nextVal = null;
      if (raw != null && raw !== '') {
        const parsed = parseTs(raw, scheduleTz);
        if (parsed === undefined) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Invalid demurrageLiabilityFromAt' });
        }
        nextVal = parsed;
      }
      afterDemurrage = nextVal;
      await client.query(
        `UPDATE operations SET demurrage_liability_from_at = $1, updated_at = NOW()
         WHERE id = $2 AND deleted_at IS NULL`,
        [nextVal, operationId]
      );
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
      ...(demurrageProvided
        ? [
            {
              field: 'Demurrage liability from',
              from: normalizeForChange(beforeDemurrage),
              to: normalizeForChange(afterDemurrage),
            },
          ]
        : []),
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

