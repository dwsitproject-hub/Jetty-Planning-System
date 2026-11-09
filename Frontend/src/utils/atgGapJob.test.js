import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { jobErrorKey, waitForJob } from './atgGapJob.js'

const noWait = () => Promise.resolve()

describe('waitForJob', () => {
  it('reports progress and resolves with the result when the job is done', async () => {
    const jobs = [
      { status: 'running', progress: { step: 'download', done: 1, total: 4 } },
      { status: 'running', progress: { step: 'import' } },
      { status: 'done', result: { ok: true } },
    ]
    const seen = []
    const result = await waitForJob(1, {
      fetchJob: async () => jobs.shift(),
      onProgress: (p) => seen.push(p?.step),
      wait: noWait,
    })
    assert.deepEqual(result, { ok: true })
    assert.deepEqual(seen, ['download', 'import', undefined])
  })

  it('throws the stored error when the job failed', async () => {
    await assert.rejects(
      waitForJob(1, { fetchJob: async () => ({ status: 'failed', error: 'interrupted_by_restart' }), wait: noWait }),
      /interrupted_by_restart/
    )
  })

  it('survives a few failed polls but gives up after too many', async () => {
    let calls = 0
    const flaky = async () => {
      calls += 1
      if (calls <= 2) throw new Error('network')
      return { status: 'done', result: 7 }
    }
    assert.equal(await waitForJob(1, { fetchJob: flaky, wait: noWait }), 7)
    await assert.rejects(
      waitForJob(1, { fetchJob: async () => { throw new Error('down') }, maxPollErrors: 3, wait: noWait }),
      /down/
    )
  })

  it('stops quietly when cancelled', async () => {
    let polls = 0
    const result = await waitForJob(1, {
      fetchJob: async () => { polls += 1; return { status: 'running' } },
      isCancelled: () => polls >= 2,
      wait: noWait,
    })
    assert.equal(result, undefined)
  })

  it('maps stored error codes to text keys', () => {
    assert.equal(jobErrorKey('another_resync_running'), 'atgGapBusy')
    assert.equal(jobErrorKey('interrupted_by_restart'), 'atgGapJobInterrupted')
    assert.equal(jobErrorKey('something else'), null)
  })
})
