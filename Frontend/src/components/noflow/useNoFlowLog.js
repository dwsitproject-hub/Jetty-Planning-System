import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { closeNoFlowEvent, deleteNoFlowEvent, fetchNoFlow, fetchNoFlowReasonOptions } from '../../api/noFlow'

/**
 * Data for one voyage's no-flow log: summary (recorded + unexplained stops), active
 * reasons for the form (skipped when read-only), reload and remove.
 */
export function useNoFlowLog(operationId, { readOnly = false } = {}) {
  const { t } = useTranslation('pages')
  const [summary, setSummary] = useState(null)
  const [reasons, setReasons] = useState([])
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!operationId) return
    try {
      setError('')
      setSummary(await fetchNoFlow(operationId))
    } catch (e) {
      setError(e?.message || t('noFlowLoadFailed'))
    }
  }, [operationId, t])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (readOnly) return
    fetchNoFlowReasonOptions().then(setReasons).catch(() => setReasons([]))
  }, [readOnly])

  const remove = useCallback(
    async (stop) => {
      if (!window.confirm(t('noFlowDeleteConfirm'))) return
      try {
        await deleteNoFlowEvent(operationId, stop.id)
        await load()
      } catch (e) {
        setError(e?.message || t('noFlowSaveFailed'))
      }
    },
    [operationId, load, t]
  )

  /** Flow resumed on an open stop (end = now). */
  const close = useCallback(
    async (stop) => {
      try {
        await closeNoFlowEvent(operationId, stop.id)
        await load()
      } catch (e) {
        setError(e?.message || t('noFlowSaveFailed'))
      }
    },
    [operationId, load, t]
  )

  return { summary, reasons, error, load, remove, close, readOnly }
}
