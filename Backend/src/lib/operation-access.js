import { pool } from '../db.js';

export function canAccessOperationForSelectedPort(opRow, selectedPortId) {
  const selected = Number(selectedPortId);
  const opPort = opRow?.port_id != null ? Number(opRow.port_id) : null;
  if (!Number.isFinite(selected)) return false;
  // Legacy rows may have null jetty/port before allocation; allow access.
  if (opPort == null) return true;
  return opPort === selected;
}

function httpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

export async function assertOperationInSelectedPort(operationId, selectedPortId, client = pool) {
  const id = Number(operationId);
  if (!Number.isFinite(id)) throw httpError(400, 'Invalid operationId');

  const r = await client.query(
    `SELECT o.id, COALESCE(o.port_id, j.port_id) AS port_id
     FROM operations o
     LEFT JOIN jetties j ON o.jetty_id = j.id AND j.deleted_at IS NULL
     WHERE o.id = $1 AND o.deleted_at IS NULL`,
    [id]
  );
  if (r.rows.length === 0) throw httpError(404, 'Operation not found');
  const op = r.rows[0];
  if (!canAccessOperationForSelectedPort(op, selectedPortId)) {
    throw httpError(403, 'Forbidden');
  }
  return op;
}
