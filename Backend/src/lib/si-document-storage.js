/**
 * Persist SI source documents to disk + shipping_instruction_documents.
 */
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileTypeFromBuffer } from 'file-type';
import { pool } from '../db.js';
import { UPLOAD_ROOT } from '../paths.js';
import { runShippingInstructionDocumentExtract, SUPPORTED_FOR_EXTRACT } from './si-document-extract.js';

export function toSiDocumentDownloadUrl(id) {
  return `/api/v1/si-documents/${id}/download`;
}

export function toSiDocumentViewUrl(id) {
  return `/api/v1/si-documents/${id}/view`;
}

export function resolveSiStoredPath(storedPath) {
  const full = path.resolve(UPLOAD_ROOT, String(storedPath || ''));
  const root = path.resolve(UPLOAD_ROOT);
  if (!full.startsWith(root)) return null;
  return full;
}

function safeBaseName(name) {
  const base = String(name || '').split(/[\\/]/).pop() || 'file';
  return base.replace(/[^\w.\-()+ ]/g, '_').slice(0, 120);
}

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

function storageSubdir({ shipmentPlanId, draftKey }) {
  if (shipmentPlanId) return path.join('si', 'plans', String(shipmentPlanId));
  if (draftKey) return path.join('si', 'drafts', String(draftKey).replace(/[^\w.-]+/g, '_').slice(0, 64));
  return path.join('si', 'misc');
}

/**
 * @param {Buffer} buffer
 * @param {{
 *   portId: number,
 *   originalName: string,
 *   uploadedBy?: number|null,
 *   shipmentPlanId?: number|null,
 *   shippingInstructionId?: number|null,
 *   draftKey?: string|null,
 *   runExtract?: boolean,
 * }} opts
 */
export async function storeSiDocumentAndMaybeExtract(buffer, opts) {
  const ft = await fileTypeFromBuffer(buffer);
  const mime = ft?.mime;
  if (!mime || !SUPPORTED_FOR_EXTRACT.has(mime)) {
    const err = new Error('Unsupported file type (use PDF or image).');
    err.statusCode = 400;
    throw err;
  }

  let extractResult = null;
  if (opts.runExtract !== false) {
    extractResult = await runShippingInstructionDocumentExtract(buffer);
  }

  const sub = storageSubdir({
    shipmentPlanId: opts.shipmentPlanId,
    draftKey: opts.draftKey,
  });
  const dir = path.join(UPLOAD_ROOT, sub);
  await ensureDir(dir);
  const ext = path.extname(opts.originalName || '') || (mime === 'application/pdf' ? '.pdf' : '.bin');
  const storedName = `${Date.now()}-${crypto.randomBytes(12).toString('hex')}${ext}`;
  const fullPath = path.join(dir, storedName);
  await fs.writeFile(fullPath, buffer);
  const rel = path.relative(UPLOAD_ROOT, fullPath);

  const extractJson = extractResult
    ? {
        source: extractResult.source,
        mime: extractResult.mime,
        fields: extractResult.fields,
        rawTextTruncated: extractResult.rawTextTruncated,
      }
    : null;

  const r = await pool.query(
    `INSERT INTO shipping_instruction_documents (
       port_id, shipment_plan_id, shipping_instruction_id, draft_key,
       original_name, stored_name, stored_path, mime_type, size_bytes,
       extract_json, uploaded_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING id, created_at`,
    [
      opts.portId,
      opts.shipmentPlanId ?? null,
      opts.shippingInstructionId ?? null,
      opts.draftKey ?? null,
      safeBaseName(opts.originalName),
      storedName,
      rel,
      mime,
      buffer.length,
      extractJson ? JSON.stringify(extractJson) : null,
      opts.uploadedBy ?? null,
    ]
  );

  const id = r.rows[0].id;
  return {
    document: {
      id,
      name: safeBaseName(opts.originalName),
      downloadUrl: toSiDocumentDownloadUrl(id),
      mimeType: mime,
      sizeBytes: buffer.length,
      createdAt: r.rows[0].created_at,
      shipmentPlanId: opts.shipmentPlanId ?? null,
      shippingInstructionId: opts.shippingInstructionId ?? null,
      draftKey: opts.draftKey ?? null,
    },
    extract: extractResult
      ? {
          mime: extractResult.mime,
          source: extractResult.source,
          fields: extractResult.fields,
          rawText: extractResult.rawText,
          rawTextTruncated: extractResult.rawTextTruncated,
        }
      : null,
  };
}

export async function attachDraftSiDocuments(draftKey, shipmentPlanId, portId, shippingInstructionId = null) {
  const dk = String(draftKey || '').trim();
  if (!dk) {
    const err = new Error('draftKey required');
    err.statusCode = 400;
    throw err;
  }
  const planId = parseInt(shipmentPlanId, 10);
  if (Number.isNaN(planId)) {
    const err = new Error('Invalid shipment plan id');
    err.statusCode = 400;
    throw err;
  }
  const siId =
    shippingInstructionId != null && shippingInstructionId !== ''
      ? parseInt(shippingInstructionId, 10)
      : null;
  if (shippingInstructionId != null && shippingInstructionId !== '' && Number.isNaN(siId)) {
    const err = new Error('Invalid shipping instruction id');
    err.statusCode = 400;
    throw err;
  }

  const r = await pool.query(
    `UPDATE shipping_instruction_documents
     SET shipment_plan_id = $1,
         shipping_instruction_id = COALESCE($2, shipping_instruction_id),
         draft_key = NULL,
         updated_at = NOW()
     WHERE draft_key = $3 AND port_id = $4 AND deleted_at IS NULL
       AND shipment_plan_id IS NULL
     RETURNING id, original_name, stored_path`,
    [planId, siId, dk, portId]
  );

  const planDir = path.join(UPLOAD_ROOT, 'si', 'plans', String(planId));
  await ensureDir(planDir);

  for (const row of r.rows) {
    const oldFull = resolveSiStoredPath(row.stored_path);
    if (!oldFull || !fsSync.existsSync(oldFull)) continue;
    const destName = path.basename(oldFull);
    const destFull = path.join(planDir, destName);
    try {
      await fs.rename(oldFull, destFull);
      const rel = path.relative(UPLOAD_ROOT, destFull);
      await pool.query(
        `UPDATE shipping_instruction_documents SET stored_path = $1, updated_at = NOW() WHERE id = $2`,
        [rel, row.id]
      );
    } catch {
      /* best-effort move */
    }
  }

  return r.rows.map((row) => ({
    id: row.id,
    name: row.original_name,
    downloadUrl: toSiDocumentDownloadUrl(row.id),
  }));
}
