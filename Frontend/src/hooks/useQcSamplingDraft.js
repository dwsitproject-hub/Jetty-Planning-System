import { useCallback } from 'react'

const keyFor = (operationId) => `jps_qc_sampling_draft_${operationId}`

/**
 * Per-operation copy of unsaved QC sampling edits in localStorage, so a dropped connection
 * at the jetty (or an accidental reload) does not lose typed samples.
 * Files picked on the device cannot be stored, so documents are never part of the copy.
 */
export function useQcSamplingDraft(operationId) {
  const read = useCallback(() => {
    try {
      const raw = localStorage.getItem(keyFor(operationId))
      const parsed = raw ? JSON.parse(raw) : null
      return parsed && typeof parsed === 'object' && parsed.sampling ? parsed : null
    } catch {
      return null
    }
  }, [operationId])

  const write = useCallback(
    (sampling) => {
      try {
        // eslint-disable-next-line no-unused-vars -- documents are intentionally dropped
        const { documents, ...rest } = sampling
        localStorage.setItem(keyFor(operationId), JSON.stringify({ savedAt: Date.now(), sampling: rest }))
      } catch {
        /* storage full or unavailable: editing still works, just without the safety net */
      }
    },
    [operationId]
  )

  const clear = useCallback(() => {
    try {
      localStorage.removeItem(keyFor(operationId))
    } catch {
      /* ignore */
    }
  }, [operationId])

  return { read, write, clear }
}
