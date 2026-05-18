/**
 * Shipping instruction source documents (PDF/images) + optional OCR extract.
 * Base: /api/v1/si-documents
 */
import express from 'express';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import multer from 'multer';
import { pool } from '../db.js';
import {
  assertSiDocumentInSelectedPort,
  assertShipmentPlanInSelectedPort,
} from '../lib/si-document-access.js';
import {
  attachDraftSiDocuments,
  resolveSiStoredPath,
  storeSiDocumentAndMaybeExtract,
  toSiDocumentDownloadUrl,
} from '../lib/si-document-storage.js';
const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
});

function parseOptionalInt(v) {
  if (v == null || v === '') return null;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
}

/** POST /extract — store file + run heuristic extract */
router.post('/extract', upload.single('file'), async (req, res) => {
  const buf = req.file?.buffer;
  if (!buf?.length) {
    return res.status(400).json({ error: 'No file uploaded (use form field name: file).' });
  }

  const portId = parseInt(req.selectedPortId, 10);
  const shipmentPlanId = parseOptionalInt(req.body?.shipment_plan_id ?? req.body?.shipmentPlanId);
  const shippingInstructionId = parseOptionalInt(
    req.body?.shipping_instruction_id ?? req.body?.shippingInstructionId
  );
  const draftKey = String(req.body?.draft_key ?? req.body?.draftKey ?? '').trim() || null;

  if (shipmentPlanId) {
    await assertShipmentPlanInSelectedPort(shipmentPlanId, portId);
  }

  try {
    const out = await storeSiDocumentAndMaybeExtract(buf, {
      portId,
      originalName: req.file.originalname || 'document',
      uploadedBy: req.userId ?? null,
      shipmentPlanId,
      shippingInstructionId,
      draftKey,
      runExtract: true,
    });
    res.status(201).json(out);
  } catch (e) {
    const code = Number(e?.statusCode);
    const status = Number.isInteger(code) && code >= 400 && code < 500 ? code : 500;
    res.status(status).json({ error: e?.message || 'Upload and extract failed' });
  }
});

/** POST /attach-draft — link draft_key uploads to a saved shipment plan */
router.post('/attach-draft', express.json(), async (req, res) => {
  const portId = parseInt(req.selectedPortId, 10);
  const draftKey = String(req.body?.draft_key ?? req.body?.draftKey ?? '').trim();
  const shipmentPlanId = parseOptionalInt(req.body?.shipment_plan_id ?? req.body?.shipmentPlanId);
  const shippingInstructionId = parseOptionalInt(
    req.body?.shipping_instruction_id ?? req.body?.shippingInstructionId
  );

  if (!draftKey || !shipmentPlanId) {
    return res.status(400).json({ error: 'draftKey and shipmentPlanId are required.' });
  }

  await assertShipmentPlanInSelectedPort(shipmentPlanId, portId);

  const items = await attachDraftSiDocuments(draftKey, shipmentPlanId, portId, shippingInstructionId);
  res.json({ items });
});

router.get('/:id/download', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

  const r = await pool.query(
    `SELECT id, original_name, stored_path FROM shipping_instruction_documents
     WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  if (r.rows.length === 0) return res.status(404).json({ error: 'Document not found' });

  await assertSiDocumentInSelectedPort(id, req.selectedPortId);
  const row = r.rows[0];
  const full = resolveSiStoredPath(row.stored_path);
  if (!full || !fsSync.existsSync(full)) {
    return res.status(404).json({ error: 'Document file not found' });
  }
  return res.download(full, row.original_name || `si-document-${id}`);
});

router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

  const r = await pool.query(
    `SELECT id, stored_path FROM shipping_instruction_documents
     WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  if (r.rows.length === 0) return res.status(404).json({ error: 'Document not found' });

  await assertSiDocumentInSelectedPort(id, req.selectedPortId);
  await pool.query(
    `UPDATE shipping_instruction_documents SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [id]
  );

  try {
    const full = resolveSiStoredPath(r.rows[0].stored_path);
    if (full) await fs.unlink(full);
  } catch {
    /* ignore */
  }

  res.status(204).send();
});

export default router;
