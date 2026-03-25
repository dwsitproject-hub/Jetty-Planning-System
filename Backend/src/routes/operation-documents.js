/**
 * Operation documents (local disk in dev; DB metadata).
 * Base path: /api/v1/operation-documents
 */
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { pool } from '../db.js';
import { writeActivityLog } from '../lib/activity-log.js';
import { optionalAuth } from '../middleware/auth.js';
import { UPLOAD_ROOT } from '../paths.js';

const router = express.Router();
router.use(optionalAuth);

/** Activity log page keys for uploads (NOR appears in both Allocation and Pre-Checking). */
function pageKeysForOperationDocKind(kind) {
  const k = String(kind || '').toUpperCase();
  if (k === 'NOR') return ['allocation', 'loading'];
  if (k === 'BERTHING') return ['allocation'];
  return ['loading'];
}

function safeBaseName(name) {
  const base = String(name || '').split(/[\\/]/).pop() || 'file';
  return base.replace(/[^\w.\-()+ ]/g, '_').slice(0, 120);
}

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      const operationId = String(req.params.operationId || '').trim();
      const kind = String(req.params.kind || '').trim().toLowerCase();
      const dir = path.join(UPLOAD_ROOT, 'operations', operationId, kind);
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
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB per file
});

router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

  const r = await pool.query(
    `SELECT id, stored_path, operation_id, kind, original_name
     FROM operation_documents
     WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  if (r.rows.length === 0) return res.status(404).json({ error: 'Document not found' });

  const row = r.rows[0];
  await pool.query(`UPDATE operation_documents SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1`, [id]);

  // Best-effort delete from disk (do not fail request if missing).
  try {
    const full = path.join(UPLOAD_ROOT, row.stored_path);
    await fs.unlink(full);
  } catch {
    // ignore
  }

  for (const pageKey of pageKeysForOperationDocKind(row.kind)) {
    writeActivityLog({
      pageKey,
      action: 'delete',
      entityType: `${String(row.kind || '').toUpperCase()} document`,
      entityId: row.operation_id != null ? String(row.operation_id) : null,
      entityLabel: row.original_name || `Document ${id}`,
      summary: `Deleted ${row.kind || 'operation'} document for operation ${row.operation_id}`,
      changes: [
        { field: 'Document', from: row.original_name || `Document ${id}`, to: null },
        { field: 'Kind', from: row.kind || null, to: null },
      ],
      meta: { operationId: row.operation_id, documentId: id, kind: row.kind },
      actorUserId: req.userId ?? null,
    }).catch(() => {});
  }

  res.status(204).send();
});

router.get('/operations/:operationId/:kind', async (req, res) => {
  const operationId = parseInt(req.params.operationId, 10);
  const kind = String(req.params.kind || '').trim().toUpperCase();
  if (Number.isNaN(operationId)) return res.status(400).json({ error: 'Invalid operationId' });
  if (!kind) return res.status(400).json({ error: 'kind required' });

  const r = await pool.query(
    `SELECT id, operation_id, kind, original_name, stored_name, stored_path, mime_type, size_bytes, created_at
     FROM operation_documents
     WHERE operation_id = $1 AND kind = $2 AND deleted_at IS NULL
     ORDER BY created_at DESC, id DESC`,
    [operationId, kind]
  );

  res.json(
    r.rows.map((d) => ({
      id: d.id,
      operationId: d.operation_id,
      kind: d.kind,
      name: d.original_name,
      url: `/uploads/${d.stored_path.replace(/\\/g, '/')}`,
      mimeType: d.mime_type,
      sizeBytes: d.size_bytes != null ? Number(d.size_bytes) : null,
      createdAt: d.created_at,
    }))
  );
});

router.post('/operations/:operationId/:kind', upload.array('files', 10), async (req, res) => {
  const operationId = parseInt(req.params.operationId, 10);
  const kind = String(req.params.kind || '').trim().toUpperCase();
  if (Number.isNaN(operationId)) return res.status(400).json({ error: 'Invalid operationId' });
  if (!kind) return res.status(400).json({ error: 'kind required' });

  const op = await pool.query(`SELECT 1 FROM operations WHERE id = $1 AND deleted_at IS NULL`, [operationId]);
  if (op.rows.length === 0) return res.status(404).json({ error: 'Operation not found' });

  const files = Array.isArray(req.files) ? req.files : [];
  if (files.length === 0) return res.status(400).json({ error: 'No files uploaded' });

  const inserted = [];
  for (const f of files) {
    const original = safeBaseName(f.originalname);
    const storedName = f.filename;
    // stored_path is relative to UPLOAD_ROOT so we can serve it via /uploads
    const rel = path.relative(UPLOAD_ROOT, f.path);

    const r = await pool.query(
      `INSERT INTO operation_documents (operation_id, kind, original_name, stored_name, stored_path, mime_type, size_bytes)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, created_at`,
      [operationId, kind, original, storedName, rel, f.mimetype ?? null, f.size ?? null]
    );
    inserted.push({
      id: r.rows[0].id,
      operationId,
      kind,
      name: original,
      url: `/uploads/${rel.replace(/\\/g, '/')}`,
      createdAt: r.rows[0].created_at,
    });
  }

  const label = inserted.map((x) => x.name).join(', ');
  for (const pageKey of pageKeysForOperationDocKind(kind)) {
    writeActivityLog({
      pageKey,
      action: 'add',
      entityType: `${kind} document`,
      entityId: String(operationId),
      entityLabel: label.length > 200 ? `${label.slice(0, 197)}…` : label,
      summary: `Uploaded ${inserted.length} ${kind} document(s) for operation ${operationId}`,
      changes: inserted.map((x) => ({
        field: 'Document',
        from: null,
        to: x.name,
      })),
      meta: { operationId, kind, documentIds: inserted.map((x) => x.id), names: inserted.map((x) => x.name) },
      actorUserId: req.userId ?? null,
    }).catch(() => {});
  }

  res.status(201).json({ items: inserted });
});

export default router;

