import { pool } from '../db.js';

const NO_PORT_MESSAGE = 'No port assigned, please contact Jetty Planning System Admin';

export async function loadUserAssignedPorts(userId) {
  const result = await pool.query(
    `SELECT p.id, p.name, p.schedule_timezone
     FROM user_ports up
     JOIN ports p ON p.id = up.port_id AND p.deleted_at IS NULL
     WHERE up.user_id = $1 AND up.deleted_at IS NULL
     ORDER BY p.name ASC, p.id ASC`,
    [userId]
  );
  return result.rows.map((r) => ({
    id: Number(r.id),
    name: r.name,
    scheduleTimezone: r.schedule_timezone ?? 'Asia/Jakarta',
  }));
}

/**
 * Requires authenticated user and resolves selected port from:
 * - x-selected-port-id header
 * - x-port-id header
 *
 * Behavior:
 * - 0 assigned ports: 403 + message
 * - 1 assigned port: auto-select it
 * - >1 assigned ports: explicit header required and must belong to assignment
 */
export async function requirePortScope(req, res, next) {
  if (!req.userId) return res.status(401).json({ error: 'Authentication required' });

  const assigned = await loadUserAssignedPorts(req.userId);
  if (assigned.length === 0) {
    return res.status(403).json({ error: NO_PORT_MESSAGE });
  }

  const assignedIds = assigned.map((p) => Number(p.id));
  const selectedRaw =
    req.headers['x-selected-port-id'] ??
    req.headers['x-port-id'] ??
    req.query?.port_id ??
    null;

  let selectedPortId = null;
  if (assigned.length === 1) {
    selectedPortId = assignedIds[0];
  } else {
    const parsed = parseInt(String(selectedRaw ?? '').trim(), 10);
    if (!Number.isFinite(parsed)) {
      return res.status(400).json({ error: 'Port selection required' });
    }
    if (!assignedIds.includes(parsed)) {
      return res.status(403).json({ error: 'Selected port is not assigned to this user' });
    }
    selectedPortId = parsed;
  }

  req.assignedPorts = assigned;
  req.assignedPortIds = assignedIds;
  req.selectedPortId = selectedPortId;
  next();
}

export { NO_PORT_MESSAGE };
