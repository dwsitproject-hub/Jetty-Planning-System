/**
 * ATG resync simulation: run the real recovery inside a transaction, report what changed, roll back.
 */
import { applyRecoveryRows, fetchRecoveryRows, prepareRecovery } from './atg-operation-recovery.js';
import { DEFAULT_RECENT_GAP_MS, deriveGapCheckStatus } from './atg-cargo-gap-status.js';
import {
  diffDailyRows,
  diffHourlyRows,
  classifyTargetGaps,
  summarizeQuantityByCommodity,
} from './atg-recovery-diff.js';

const LOCK_CLASS = 7311;
const SIMULATION_TIMEOUT = '180s';

export class RecoveryBusyError extends Error {
  constructor() {
    super('another_resync_running');
    this.statusCode = 409;
  }
}

/**
 * Hold a per-operation advisory lock on a dedicated connection while fn runs,
 * so only one simulation or resync touches an operation at a time.
 * @template T
 * @param {import('pg').Pool} pool
 * @param {number} operationId
 * @param {(client: import('pg').PoolClient) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withOperationLock(pool, operationId, fn) {
  const client = await pool.connect();
  let locked = false;
  let unlockFailed = false;
  try {
    const r = await client.query('SELECT pg_try_advisory_lock($1, $2) AS ok', [LOCK_CLASS, operationId]);
    if (!r.rows[0].ok) throw new RecoveryBusyError();
    locked = true;
    return await fn(client);
  } finally {
    if (locked) {
      await client.query('SELECT pg_advisory_unlock($1, $2)', [LOCK_CLASS, operationId]).catch(() => {
        unlockFailed = true;
      });
    }
    client.release(unlockFailed);
  }
}

/** All hourly rows of the affected load lines: recalculation can also move hours next to a gap. */
async function loadHourlySnapshot(db, operationId, lineIds) {
  const r = await db.query(
    `SELECT h.load_line_id, h.hour_start, h.hour_end, h.qty_moved, h.movement_status
     FROM operation_hourly_cargo_progress h
     WHERE h.operation_id = $1 AND h.load_line_id = ANY($2::bigint[])`,
    [operationId, lineIds]
  );
  return r.rows.map((row) => ({
    loadLineId: Number(row.load_line_id),
    hourStart: row.hour_start,
    hourEnd: row.hour_end,
    qtyMoved: Number(row.qty_moved),
    movementStatus: row.movement_status,
  }));
}

async function loadDailySnapshot(db, operationId) {
  const r = await db.query(
    `SELECT load_line_id, progress_date::text AS progress_date, qty_moved
     FROM operation_daily_cargo_progress WHERE operation_id = $1`,
    [operationId]
  );
  return r.rows.map((row) => ({
    loadLineId: row.load_line_id != null ? Number(row.load_line_id) : null,
    progressDate: row.progress_date,
    qtyMoved: Number(row.qty_moved),
  }));
}

async function loadCommodityByLine(db, lineIds) {
  const r = await db.query(
    `SELECT l.id, COALESCE(sc.short_name, sc.name) AS commodity
     FROM operation_cargo_load_lines l
     LEFT JOIN si_commodities sc ON sc.id = l.commodity_id
     WHERE l.id = ANY($1::bigint[])`,
    [lineIds]
  );
  return new Map(r.rows.map((row) => [Number(row.id), row.commodity]));
}

function overlapsAnyWindow(hour, windows) {
  const start = new Date(hour.hourStart).getTime();
  const end = new Date(hour.hourEnd).getTime();
  return windows.some((w) => start < new Date(w.endAt).getTime() && end > new Date(w.startAt).getTime());
}

function statusOf(op) {
  return deriveGapCheckStatus(op ? [op] : [], DEFAULT_RECENT_GAP_MS).status;
}

function emptySimulation(operationId, started) {
  return {
    ok: true,
    simulated: true,
    noDataChanged: true,
    operationId,
    operationLabel: null,
    simulatedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    targetGapKeys: [],
    gapOutcomes: [],
    targetClosed: 0,
    targetPartial: 0,
    stillMissing: [],
    samplesWouldInsert: 0,
    archiveErrors: [],
    quantity: summarizeQuantityByCommodity([], new Map()),
    hourly: [],
    daily: { changed: 0, totalDelta: 0 },
    status: { before: 'healthy', after: 'healthy' },
  };
}

/**
 * @param {import('pg').Pool} pool
 * @param {number} operationId
 * @param {{ gapKeys?: string[], scanOpts?: object, onProgress?: (p: object) => void }} [opts]
 */
export async function simulateAtgOperationRecovery(pool, operationId, opts = {}) {
  const started = Date.now();

  return withOperationLock(pool, operationId, async (client) => {
    const prep = await prepareRecovery(client, operationId, opts);
    if (!prep) return emptySimulation(operationId, started);

    const { paramRows, archiveErrors } = await fetchRecoveryRows(prep, { onProgress: opts.onProgress });
    const lineIds = [...new Set(prep.targetGaps.map((g) => Number(g.loadLineId)))];
    const windows = prep.targetGaps.map((g) => ({ startAt: g.startAt, endAt: g.endAt }));

    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL statement_timeout = '${SIMULATION_TIMEOUT}'`);

      const hourlyBefore = await loadHourlySnapshot(client, operationId, lineIds);
      const dailyBefore = await loadDailySnapshot(client, operationId);
      const applied = await applyRecoveryRows(client, prep, paramRows, { onProgress: opts.onProgress });
      opts.onProgress?.({ step: 'compare' });
      const hourlyAfter = await loadHourlySnapshot(client, operationId, lineIds);
      const dailyAfter = await loadDailySnapshot(client, operationId);
      const commodityByLine = await loadCommodityByLine(client, lineIds);

      const allHours = diffHourlyRows(hourlyBefore, hourlyAfter).map((h) => ({
        ...h,
        commodity: commodityByLine.get(h.loadLineId) || '—',
        inGap: overlapsAnyWindow(h, windows),
      }));
      const hourly = allHours.filter((h) => h.changed || h.inGap);
      const gapSummary = classifyTargetGaps(prep.targetGaps, applied.gapsAfter);

      return {
        ok: true,
        simulated: true,
        noDataChanged: true,
        operationId,
        operationLabel: prep.op.operationLabel,
        portId: prep.op.portId,
        simulatedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        targetGapKeys: prep.targetGapKeys,
        gapOutcomes: gapSummary.outcomes,
        targetClosed: gapSummary.closedCount,
        targetPartial: gapSummary.partialCount,
        stillMissing: gapSummary.stillMissing,
        samplesWouldInsert: applied.samplesInserted,
        archiveErrors,
        quantity: summarizeQuantityByCommodity(allHours, commodityByLine),
        hourly,
        daily: diffDailyRows(dailyBefore, dailyAfter),
        status: { before: statusOf(prep.op), after: statusOf(applied.opAfter) },
      };
    } finally {
      await client.query('ROLLBACK').catch(() => {});
    }
  });
}

/** @param {object} result simulation result */
export function buildSimulationAuditSummary(result) {
  const label = result.operationLabel || `Operation #${result.operationId}`;
  const closed = result.targetClosed ?? 0;
  const total = result.targetGapKeys?.length ?? 0;
  const delta = Number(result.quantity?.total?.qtyDelta || 0).toFixed(1);
  return `ATG cargo resync simulation: ${label}: would import ${result.samplesWouldInsert ?? 0} samples, fully close ${closed}/${total} gaps${result.targetPartial ? ` (${result.targetPartial} partly)` : ''}, quantity ${delta >= 0 ? '+' : ''}${delta} MT. No data changed.`;
}
