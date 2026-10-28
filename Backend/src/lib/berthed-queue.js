/**
 * Which allocation-overview rows count as "berthed" for field menus (Operator Mode, QC Sampling).
 * A row is berthed once it has a TB timestamp or has reached DOCKED or later, and it has
 * not been shifted out to make room for another vessel.
 */
const BERTHED_STATUSES = new Set([
  'DOCKED',
  'IN_PROGRESS',
  'POST_OPS',
  'SIGNOFF_REQUESTED',
  'SIGNOFF_APPROVED',
]);

export function isBerthedQueueRow(row) {
  if (!row || row.operationId == null) return false;
  if (row.shiftingOut) return false;
  if (row.tbDateTime) return true;
  return BERTHED_STATUSES.has(String(row.status || '').toUpperCase());
}
