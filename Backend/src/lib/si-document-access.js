/**
 * Port-scope checks for shipping_instruction_documents rows.
 */
import { pool } from '../db.js';

export async function assertSiDocumentInSelectedPort(documentId, selectedPortId) {
  const id = parseInt(documentId, 10);
  if (Number.isNaN(id)) {
    const err = new Error('Invalid document id');
    err.statusCode = 400;
    throw err;
  }
  const portId = parseInt(selectedPortId, 10);
  if (Number.isNaN(portId)) {
    const err = new Error('Port scope required');
    err.statusCode = 403;
    throw err;
  }
  const r = await pool.query(
    `SELECT id, port_id FROM shipping_instruction_documents
     WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  if (r.rows.length === 0) {
    const err = new Error('Document not found');
    err.statusCode = 404;
    throw err;
  }
  if (Number(r.rows[0].port_id) !== portId) {
    const err = new Error('Document not in selected port');
    err.statusCode = 403;
    throw err;
  }
  return r.rows[0];
}

export async function assertShipmentPlanInSelectedPort(shipmentPlanId, selectedPortId) {
  const planId = parseInt(shipmentPlanId, 10);
  if (Number.isNaN(planId)) {
    const err = new Error('Invalid shipment plan id');
    err.statusCode = 400;
    throw err;
  }
  const portId = parseInt(selectedPortId, 10);
  if (Number.isNaN(portId)) {
    const err = new Error('Port scope required');
    err.statusCode = 403;
    throw err;
  }
  const r = await pool.query(
    `SELECT id, port_id FROM shipment_plans WHERE id = $1 AND deleted_at IS NULL`,
    [planId]
  );
  if (r.rows.length === 0) {
    const err = new Error('Shipment plan not found');
    err.statusCode = 404;
    throw err;
  }
  if (Number(r.rows[0].port_id) !== portId) {
    const err = new Error('Shipment plan not in selected port');
    err.statusCode = 403;
    throw err;
  }
  return r.rows[0];
}
