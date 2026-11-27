import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { startKurasPeriod, stopKurasPeriod } from '../../api/kurasPeriods.js'
import { normalizeForApi } from '../../utils/scheduleDateTime'

/**
 * Kuras on another palka in operator mode (movement type Mixed): start, stop, and the prompt when
 * cargo is stopped while kuras is still running. Periods come with the cargo segments.
 */
export function useOperatorKuras({ operationId, segments, tz, reload, enabled }) {
  const { t } = useTranslation('operator')
  const [sheet, setSheet] = useState(null)
  const [busy, setBusy] = useState(false)

  const { running, runningSegment, palkasUsed } = useMemo(() => {
    let run = null
    let seg = null
    const used = []
    for (const s of segments || []) {
      for (const p of s.kurasPeriods || []) {
        if (p.palka && !used.includes(p.palka)) used.push(p.palka)
        if (!p.endAt) {
          run = p
          seg = s
        }
      }
    }
    return { running: run, runningSegment: seg, palkasUsed: used }
  }, [segments])

  const run = useCallback(
    async (fn) => {
      setBusy(true)
      try {
        await fn()
        setSheet(null)
        await reload()
        return true
      } catch (e) {
        window.alert(e?.message || t('kuras.saveFailed'))
        return false
      } finally {
        setBusy(false)
      }
    },
    [reload, t]
  )

  const start = useCallback(
    ({ palka, startLocal }) =>
      run(() => startKurasPeriod(operationId, { palka, startAt: startLocal ? normalizeForApi(startLocal, tz) : undefined })),
    [run, operationId, tz]
  )

  const stop = useCallback(
    ({ qty } = {}) => run(() => stopKurasPeriod(operationId, running.id, { qty })),
    [run, operationId, running]
  )

  return {
    enabled: Boolean(enabled),
    running,
    runningSegment,
    palkasUsed,
    sheet,
    busy,
    openSheet: (mode) => setSheet({ mode }),
    closeSheet: () => setSheet(null),
    start,
    stop,
  }
}
