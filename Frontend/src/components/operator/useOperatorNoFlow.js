import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { closeNoFlowEvent, createNoFlowEvent, fetchNoFlowLive, updateNoFlowEvent } from '../../api/noFlow'
import { useNoFlowLog } from '../noflow/useNoFlowLog.js'

const LIVE_POLL_MS = 120000

/**
 * Live no-flow capture for operator mode:
 *  - cargo_stop: Stop cargo, then open a stop from the stop time with the reason
 *  - flow_pause: open a stop now while the cargo entry stays open
 *  - nudge: open a stop from when ATG went flat
 *  - change: change the reason of the open stop
 */
export function useOperatorNoFlow({ operationId, editable, milestones, stopCargo }) {
  const { t } = useTranslation('pages')
  const log = useNoFlowLog(operationId, { readOnly: !editable })
  const [live, setLive] = useState({ openStop: null, nudge: null })
  const [sheet, setSheet] = useState(null)
  const [busy, setBusy] = useState(false)
  const reloadLog = log.load

  const loadLive = useCallback(async () => {
    if (!operationId) return
    try {
      setLive(await fetchNoFlowLive(operationId))
    } catch {
      /* keep the last known state; the next poll retries */
    }
  }, [operationId])

  const refresh = useCallback(() => Promise.all([reloadLog(), loadLive()]), [reloadLog, loadLive])

  // Starting or stopping cargo changes gaps and can close the open stop server-side.
  useEffect(() => {
    refresh()
  }, [milestones, refresh])

  useEffect(() => {
    const id = window.setInterval(loadLive, LIVE_POLL_MS)
    return () => window.clearInterval(id)
  }, [loadLive])

  const run = useCallback(
    async (fn) => {
      setBusy(true)
      try {
        await fn()
        setSheet(null)
      } catch (e) {
        window.alert(e?.message || t('noFlowSaveFailed'))
      } finally {
        setBusy(false)
        refresh()
      }
    },
    [refresh, t]
  )

  const openStop = useCallback(
    (startedAt, source, { reasonId, note }) =>
      createNoFlowEvent(operationId, { startedAt, endedAt: null, reasonId, note: note || null, source }),
    [operationId]
  )

  const confirm = useCallback(
    async ({ reasonId, note }) => {
      const mode = sheet?.mode
      if (mode === 'cargo_stop') {
        const stoppedAt = await stopCargo()
        if (!stoppedAt) return
        await run(() => openStop(stoppedAt, 'cargo_stop', { reasonId, note }))
        return
      }
      await run(() => {
        if (mode === 'change') {
          const s = live.openStop
          return updateNoFlowEvent(operationId, s.id, { startedAt: s.startedAt, endedAt: null, reasonId, note: note || null })
        }
        if (mode === 'nudge') return openStop(live.nudge.flatSince, 'atg_nudge', { reasonId, note })
        return openStop(new Date().toISOString(), 'flow_pause', { reasonId, note })
      })
    },
    [sheet, stopCargo, run, openStop, operationId, live]
  )

  /** End of cargo / Skip: stop cargo without logging a stop. */
  const stopWithoutReason = useCallback(async () => {
    const stoppedAt = await stopCargo()
    if (stoppedAt) setSheet(null)
  }, [stopCargo])

  const flowResumed = useCallback(
    () => run(() => closeNoFlowEvent(operationId, live.openStop.id)),
    [run, operationId, live.openStop]
  )

  const quickPickNudge = useCallback((reasonId) => run(() => openStop(live.nudge.flatSince, 'atg_nudge', { reasonId })), [
    run,
    openStop,
    live.nudge,
  ])

  return {
    log,
    openStop: live.openStop,
    nudge: live.nudge,
    sheet,
    busy,
    openSheet: (mode) => setSheet({ mode }),
    closeSheet: () => setSheet(null),
    confirm,
    stopWithoutReason,
    flowResumed,
    quickPickNudge,
  }
}
