import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { JobAlreadyRunningError, failInterruptedJobs, startJob } from './atg-gap-jobs.js';

/** Minimal in-memory stand-in for the pg pool, enough for startJob's queries. */
function fakeDb({ conflict = false } = {}) {
  const jobs = [];
  const db = {
    jobs,
    async query(sql, params = []) {
      if (/UPDATE atg_gap_jobs[\s\S]*timed_out/.test(sql)) return { rowCount: 0, rows: [] };
      if (/INSERT INTO atg_gap_jobs/.test(sql)) {
        if (conflict) {
          const err = new Error('duplicate');
          err.code = '23505';
          throw err;
        }
        jobs.push({ id: jobs.length + 1, status: 'running', progress: null, result: null, error: null });
        return { rows: [{ id: jobs.length }] };
      }
      if (/SET progress/.test(sql)) {
        jobs[params[0] - 1].progress = JSON.parse(params[1]);
        return { rowCount: 1, rows: [] };
      }
      if (/SET status = 'done'/.test(sql)) {
        Object.assign(jobs[params[0] - 1], { status: 'done', result: JSON.parse(params[1]) });
        return { rowCount: 1, rows: [] };
      }
      if (/SET status = 'failed', error = \$2/.test(sql)) {
        Object.assign(jobs[params[0] - 1], { status: 'failed', error: params[1] });
        return { rowCount: 1, rows: [] };
      }
      if (/interrupted_by_restart/.test(sql)) {
        const running = jobs.filter((j) => j.status === 'running');
        running.forEach((j) => Object.assign(j, { status: 'failed', error: 'interrupted_by_restart' }));
        return { rowCount: running.length, rows: [] };
      }
      throw new Error(`unexpected query: ${sql.slice(0, 60)}`);
    },
  };
  return db;
}

const tick = () => new Promise((resolve) => setImmediate(resolve));
const input = { operationId: 7, kind: 'simulate', gapKeys: ['a'], userId: 1 };

describe('atg-gap-jobs', () => {
  it('returns the job id at once and stores the result when work finishes', async () => {
    const db = fakeDb();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const jobId = await startJob(db, input, async () => {
      await gate;
      return { ok: true };
    });
    assert.equal(jobId, 1);
    assert.equal(db.jobs[0].status, 'running');
    release();
    await tick();
    await tick();
    assert.equal(db.jobs[0].status, 'done');
    assert.deepEqual(db.jobs[0].result, { ok: true });
  });

  it('records progress reported by the work', async () => {
    const db = fakeDb();
    await startJob(db, input, async (onProgress) => {
      onProgress({ step: 'download', done: 1, total: 4 });
      return {};
    });
    await tick();
    await tick();
    assert.deepEqual(db.jobs[0].progress, { step: 'download', done: 1, total: 4 });
  });

  it('marks the job failed, keeps the message and calls the failure hook', async () => {
    const db = fakeDb();
    let hookError = null;
    await startJob(
      db,
      input,
      async () => {
        throw new Error('Tankvision unreachable');
      },
      { onFailure: (e) => { hookError = e.message; } }
    );
    await tick();
    await tick();
    assert.equal(db.jobs[0].status, 'failed');
    assert.equal(db.jobs[0].error, 'Tankvision unreachable');
    assert.equal(hookError, 'Tankvision unreachable');
  });

  it('refuses a second running job for the same operation', async () => {
    await assert.rejects(startJob(fakeDb({ conflict: true }), input, async () => ({})), JobAlreadyRunningError);
  });

  it('fails jobs left running after a restart', async () => {
    const db = fakeDb();
    db.jobs.push({ id: 1, status: 'running' }, { id: 2, status: 'done' });
    assert.equal(await failInterruptedJobs(db), 1);
    assert.equal(db.jobs[0].error, 'interrupted_by_restart');
    assert.equal(db.jobs[1].status, 'done');
  });
});
