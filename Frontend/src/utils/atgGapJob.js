/** Polling helper for ATG gap background jobs (preview / simulate / resync). */

const defaultWait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Poll a job until it finishes. Resolves with the job result, throws the job error,
 * and returns undefined if the caller cancelled (dialog closed).
 * A few failed polls in a row (network blip) are tolerated; the job keeps running server-side.
 */
export async function waitForJob(
  jobId,
  { fetchJob, onProgress, isCancelled = () => false, intervalMs = 3000, maxPollErrors = 5, wait = defaultWait }
) {
  let pollErrors = 0
  for (;;) {
    if (isCancelled()) return undefined
    let job
    try {
      job = await fetchJob(jobId)
      pollErrors = 0
    } catch (e) {
      pollErrors += 1
      if (pollErrors >= maxPollErrors) throw e
      await wait(intervalMs)
      continue
    }
    if (isCancelled()) return undefined
    onProgress?.(job.progress ?? null, job)
    if (job.status === 'done') return job.result
    if (job.status === 'failed') throw new Error(job.error || 'job_failed')
    await wait(intervalMs)
  }
}

/** Friendly text for the error codes the server stores on failed jobs. */
export function jobErrorKey(message) {
  switch (message) {
    case 'another_resync_running':
      return 'atgGapBusy'
    case 'interrupted_by_restart':
      return 'atgGapJobInterrupted'
    case 'timed_out':
      return 'atgGapJobTimedOut'
    default:
      return null
  }
}
