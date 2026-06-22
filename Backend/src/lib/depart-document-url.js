/**
 * Validate clearance/vessel photo URLs on depart (C-01).
 */
import { pool } from '../db.js';
import { assertStoredFileAccess } from './stored-file-access.js';

function httpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

/**
 * @param {string|null|undefined} url
 * @param {{ operationId?: number|null, planId?: number|null, selectedPortId: number, client?: import('pg').Pool | import('pg').PoolClient }} ctx
 * @returns {Promise<string|null>}
 */
export async function validateDepartDocumentUrl(url, ctx) {
  if (url == null || url === '') return null;
  const u = String(url).trim();
  if (!u) return null;
  if (/^https?:\/\//i.test(u)) {
    throw httpError(400, 'External document URLs are not allowed');
  }

  const opDocMatch = u.match(/\/api\/v1\/operation-documents\/(\d+)\/download/i);
  if (opDocMatch) {
    const docId = parseInt(opDocMatch[1], 10);
    const db = ctx.client || pool;
    const r = await db.query(
      `SELECT id, operation_id FROM operation_documents
       WHERE id = $1 AND deleted_at IS NULL`,
      [docId]
    );
    if (r.rows.length === 0) throw httpError(400, 'Operation document not found');
    const docOpId = Number(r.rows[0].operation_id);
    if (ctx.operationId != null && docOpId !== Number(ctx.operationId)) {
      throw httpError(400, 'Document does not belong to this operation');
    }
    if (ctx.planId != null) {
      const planOps = await db.query(
        `SELECT o.id FROM operations o
         JOIN shipping_instructions si ON si.id = o.shipping_instruction_id AND si.deleted_at IS NULL
         WHERE si.shipment_plan_id = $1 AND o.deleted_at IS NULL`,
        [ctx.planId]
      );
      const allowed = planOps.rows.some((row) => Number(row.id) === docOpId);
      if (!allowed) throw httpError(400, 'Document does not belong to this shipment plan');
    }
    return u;
  }

  if (u.includes('/uploads/') || u.startsWith('uploads/')) {
    await assertStoredFileAccess(u, ctx.selectedPortId);
    return u;
  }

  throw httpError(400, 'Invalid document URL');
}

/**
 * @param {{ clearanceUrl?: string|null, photoUrl?: string|null, operationId?: number|null, planId?: number|null, selectedPortId: number, client?: import('pg').Pool | import('pg').PoolClient }} args
 */
export async function validateDepartDocumentUrls(args) {
  const ctx = {
    operationId: args.operationId,
    planId: args.planId,
    selectedPortId: args.selectedPortId,
    client: args.client,
  };
  const clearanceUrl = await validateDepartDocumentUrl(args.clearanceUrl, ctx);
  const photoUrl = await validateDepartDocumentUrl(args.photoUrl, ctx);
  return { clearanceUrl, photoUrl };
}
