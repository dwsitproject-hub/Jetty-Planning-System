/**
 * Resolve stored upload paths to owning resources and enforce port scope.
 */
import fsSync from 'node:fs';
import path from 'node:path';
import { pool } from '../db.js';
import { UPLOAD_ROOT } from '../paths.js';
import { canAccessOperationForSelectedPort } from './operation-access.js';

export function normalizeStoredRelativePath(input) {
  let p = String(input || '').trim().replace(/\\/g, '/');
  if (!p) return null;
  if (p.startsWith('/uploads/')) p = p.slice('/uploads/'.length);
  else if (p.startsWith('uploads/')) p = p.slice('uploads/'.length);
  else if (p.startsWith('/')) p = p.slice(1);
  if (!p || p.includes('..')) return null;
  return p;
}

export function resolveStoredFileOnDisk(relativePath) {
  const rel = normalizeStoredRelativePath(relativePath);
  if (!rel) return null;
  const full = path.resolve(UPLOAD_ROOT, rel);
  const root = path.resolve(UPLOAD_ROOT);
  if (!full.startsWith(root)) return null;
  if (!fsSync.existsSync(full)) return null;
  return { full, rel, filename: path.basename(full) };
}

function httpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function assertPortMatch(resourcePortId, selectedPortId) {
  const selected = Number(selectedPortId);
  const resource = Number(resourcePortId);
  if (!Number.isFinite(selected)) throw httpError(403, 'Port scope required');
  if (!Number.isFinite(resource)) throw httpError(404, 'File not found');
  if (resource !== selected) throw httpError(403, 'Forbidden');
}

/**
 * @returns {Promise<{ full: string, filename: string }>}
 */
export async function assertStoredFileAccess(relativePath, selectedPortId) {
  const onDisk = resolveStoredFileOnDisk(relativePath);
  if (!onDisk) throw httpError(404, 'File not found');
  const { full, rel, filename } = onDisk;

  const opDoc = await pool.query(
    `SELECT operation_id FROM operation_documents
     WHERE stored_path = $1 AND deleted_at IS NULL LIMIT 1`,
    [rel]
  );
  if (opDoc.rows.length > 0) {
    const op = await pool.query(
      `SELECT o.id, COALESCE(o.port_id, j.port_id) AS port_id
       FROM operations o
       LEFT JOIN jetties j ON j.id = o.jetty_id AND j.deleted_at IS NULL
       WHERE o.id = $1 AND o.deleted_at IS NULL`,
      [opDoc.rows[0].operation_id]
    );
    if (op.rows.length === 0) throw httpError(404, 'File not found');
    if (!canAccessOperationForSelectedPort(op.rows[0], selectedPortId)) {
      throw httpError(403, 'Forbidden');
    }
    return { full, filename };
  }

  const siDoc = await pool.query(
    `SELECT port_id FROM shipping_instruction_documents
     WHERE stored_path = $1 AND deleted_at IS NULL LIMIT 1`,
    [rel]
  );
  if (siDoc.rows.length > 0) {
    assertPortMatch(siDoc.rows[0].port_id, selectedPortId);
    return { full, filename };
  }

  const subDoc = await pool.query(
    `SELECT sp.operation_id
     FROM operation_sub_process_documents d
     JOIN operation_sub_processes sp ON sp.id = d.sub_process_id AND sp.deleted_at IS NULL
     WHERE d.stored_path = $1 AND d.deleted_at IS NULL
     LIMIT 1`,
    [rel]
  );
  if (subDoc.rows.length > 0) {
    const op = await pool.query(
      `SELECT o.id, COALESCE(o.port_id, j.port_id) AS port_id
       FROM operations o
       LEFT JOIN jetties j ON j.id = o.jetty_id AND j.deleted_at IS NULL
       WHERE o.id = $1 AND o.deleted_at IS NULL`,
      [subDoc.rows[0].operation_id]
    );
    if (op.rows.length === 0) throw httpError(404, 'File not found');
    if (!canAccessOperationForSelectedPort(op.rows[0], selectedPortId)) {
      throw httpError(403, 'Forbidden');
    }
    return { full, filename };
  }

  const legacySuffix = `%/${rel}`;
  const opLegacy = await pool.query(
    `SELECT o.id, COALESCE(o.port_id, j.port_id) AS port_id
     FROM operations o
     LEFT JOIN jetties j ON j.id = o.jetty_id AND j.deleted_at IS NULL
     WHERE o.deleted_at IS NULL
       AND (
         o.clearance_document_url LIKE $1
         OR o.vessel_photo_url LIKE $1
       )
     LIMIT 1`,
    [legacySuffix]
  );
  if (opLegacy.rows.length > 0) {
    if (!canAccessOperationForSelectedPort(opLegacy.rows[0], selectedPortId)) {
      throw httpError(403, 'Forbidden');
    }
    return { full, filename };
  }

  const planLegacy = await pool.query(
    `SELECT port_id FROM shipment_plans
     WHERE deleted_at IS NULL
       AND (
         clearance_document_url LIKE $1
         OR vessel_photo_url LIKE $1
       )
     LIMIT 1`,
    [legacySuffix]
  );
  if (planLegacy.rows.length > 0) {
    assertPortMatch(planLegacy.rows[0].port_id, selectedPortId);
    return { full, filename };
  }

  throw httpError(404, 'File not found');
}
