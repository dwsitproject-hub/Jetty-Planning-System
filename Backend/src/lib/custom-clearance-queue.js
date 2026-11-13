/**
 * Queue for the Custom Clearance menu: berthed operations plus the state of their
 * Post-Checking `custom_clearance` step (the same row the Loading hub edits).
 */
import { isBerthedQueueRow } from './berthed-queue.js';
import { loadSubProcessRows, queueHeader } from './field-queue.js';

export const CUSTOM_CLEARANCE_STEP = Object.freeze({ phase: 'Post-Checking', key: 'custom_clearance' });

export const CLEARANCE_STATUS = Object.freeze({
  NOT_STARTED: 'not_started',
  DRAFT: 'draft',
  DONE: 'done',
});

/** An explicit `Done` is final; any other saved row is a draft; no row means not started. */
export function deriveClearanceStatus(row) {
  if (!row) return CLEARANCE_STATUS.NOT_STARTED;
  return String(row.status || '').trim() === 'Done' ? CLEARANCE_STATUS.DONE : CLEARANCE_STATUS.DRAFT;
}

const iso = (value) => (value ? new Date(value).toISOString() : null);

/** Queue-card summary of one `custom_clearance` row (undefined row = not started). */
export function toClearanceSummary(row) {
  return {
    status: deriveClearanceStatus(row),
    startAt: iso(row?.start_at),
    endAt: iso(row?.end_at),
    remark: row?.remark ?? '',
    documentCount: Number(row?.document_count) || 0,
    updatedAt: iso(row?.updated_at),
    updatedByName: row?.updated_by_name ?? null,
  };
}

/**
 * @param {number} selectedPortId
 * @param {(portId: number) => Promise<{ queue: object[] }>} loadOverview allocation overview loader
 */
export async function buildCustomClearanceQueue(selectedPortId, loadOverview) {
  const overview = await loadOverview(selectedPortId);
  const rows = (Array.isArray(overview?.queue) ? overview.queue : []).filter(isBerthedQueueRow);
  const steps = await loadSubProcessRows(
    rows.map((r) => r.operationId),
    CUSTOM_CLEARANCE_STEP
  );
  return rows.map((r) => ({
    ...queueHeader(r),
    clearance: toClearanceSummary(steps.get(r.operationId)),
  }));
}
