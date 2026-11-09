/**
 * Background jobs for ATG gap preview / simulate / resync.
 * The HTTP call returns a job id at once; the page polls the job row for progress and result.
 */

export const JOB_KINDS = ['preview', 'simulate', 'resync'];
const STALE_AFTER_MINUTES = 15;
const PROGRESS_MIN_INTERVAL_MS = 700;

export class JobAlreadyRunningError extends Error {
  constructor() {
    super('another_resync_running');
    this.statusCode = 409;
  }
}

function mapJob(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    operationId: Number(row.operation_id),
    kind: row.kind,
    status: row.status,
    gapKeys: row.gap_keys ?? [],
    progress: row.progress ?? null,
    result: row.result ?? null,
    error: row.error ?? null,
    createdAt: new Date(row.created_at).toISOString(),
    finishedAt: row.finished_at ? new Date(row.finished_at).toISOString() : null,
  };
}

/** Jobs left "running" by a crashed process or a restart can never finish. */
export async function failInterruptedJobs(db) {
  const r = await db.query(
    `UPDATE atg_gap_jobs
     SET status = 'failed', error = 'interrupted_by_restart', finished_at = NOW(), updated_at = NOW()
     WHERE status = 'running'`
  );
  return r.rowCount;
}

async function failStaleJobs(db, operationId) {
  await db.query(
    `UPDATE atg_gap_jobs
     SET status = 'failed', error = 'timed_out', finished_at = NOW(), updated_at = NOW()
     WHERE status = 'running' AND operation_id = $1
       AND created_at < NOW() - ($2::int * INTERVAL '1 minute')`,
    [operationId, STALE_AFTER_MINUTES]
  );
}

export async function getJob(db, jobId) {
  const r = await db.query(`SELECT * FROM atg_gap_jobs WHERE id = $1`, [jobId]);
  return mapJob(r.rows[0]);
}

/**
 * Running job per operation, for the cards on System Health.
 * @returns {Promise<Map<number, { id: number, kind: string, createdAt: string, progress: object|null }>>}
 */
export async function loadActiveJobs(db, operationIds) {
  const map = new Map();
  if (!operationIds?.length) return map;
  let rows;
  try {
    rows = (
      await db.query(
        `SELECT * FROM atg_gap_jobs
         WHERE status = 'running' AND operation_id = ANY($1::bigint[])
           AND created_at >= NOW() - ($2::int * INTERVAL '1 minute')`,
        [operationIds, STALE_AFTER_MINUTES]
      )
    ).rows;
  } catch (err) {
    if (err.code === '42P01') return map; // migration 147 not applied yet: the card must still load
    throw err;
  }
  for (const row of rows) {
    const job = mapJob(row);
    map.set(job.operationId, { id: job.id, kind: job.kind, createdAt: job.createdAt, progress: job.progress, gapKeys: job.gapKeys });
  }
  return map;
}

async function createJob(db, { operationId, kind, gapKeys, userId }) {
  await failStaleJobs(db, operationId);
  try {
    const r = await db.query(
      `INSERT INTO atg_gap_jobs (operation_id, kind, gap_keys, created_by)
       VALUES ($1, $2, $3::jsonb, $4) RETURNING id`,
      [operationId, kind, JSON.stringify(gapKeys ?? []), userId ?? null]
    );
    return Number(r.rows[0].id);
  } catch (err) {
    if (err.code === '23505') throw new JobAlreadyRunningError();
    throw err;
  }
}

/** Throttled writer so a chatty download loop does not hammer the database. */
function makeProgressWriter(db, jobId) {
  let lastAt = 0;
  let lastStep = null;
  return (progress) => {
    const now = Date.now();
    const stepChanged = progress.step !== lastStep;
    const finishedStep = progress.total != null && progress.done >= progress.total;
    if (!stepChanged && !finishedStep && now - lastAt < PROGRESS_MIN_INTERVAL_MS) return;
    lastAt = now;
    lastStep = progress.step;
    db.query(`UPDATE atg_gap_jobs SET progress = $2::jsonb, updated_at = NOW() WHERE id = $1`, [
      jobId,
      JSON.stringify(progress),
    ]).catch((e) => console.error('ATG gap job progress update failed:', e?.message || e));
  };
}

/**
 * Create the job row, run `work` in the background and store its result or error.
 * @param {import('pg').Pool} db
 * @param {{ operationId: number, kind: string, gapKeys?: string[], userId?: number|null }} input
 * @param {(onProgress: (p: { step: string, done?: number, total?: number }) => void) => Promise<object>} work
 * @param {{ onFailure?: (err: Error) => void }} [hooks]
 * @returns {Promise<number>} job id
 */
export async function startJob(db, input, work, hooks = {}) {
  const jobId = await createJob(db, input);
  const onProgress = makeProgressWriter(db, jobId);

  setImmediate(async () => {
    try {
      const result = await work(onProgress);
      await db.query(
        `UPDATE atg_gap_jobs
         SET status = 'done', result = $2::jsonb, finished_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [jobId, JSON.stringify(result)]
      );
    } catch (err) {
      console.error(`ATG gap job ${jobId} (${input.kind}) failed:`, err);
      try {
        hooks.onFailure?.(err);
      } catch (hookErr) {
        console.error('ATG gap job failure hook failed:', hookErr?.message || hookErr);
      }
      await db
        .query(
          `UPDATE atg_gap_jobs
           SET status = 'failed', error = $2, finished_at = NOW(), updated_at = NOW() WHERE id = $1`,
          [jobId, String(err?.message || err).slice(0, 500)]
        )
        .catch((e) => console.error('ATG gap job failure update failed:', e?.message || e));
    }
  });

  return jobId;
}
