import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchAllocationOverview } from '../../api/allocation'
import { fetchMasterTanks } from '../../api/masterTanks'
import {
  createOperationalEntry,
  fetchOperation,
  fetchOperationalActivities,
  fetchSubProcesses,
  updateOperationalEntry,
  upsertSubProcess,
} from '../../api/operations'
import {
  getMilestoneListForPurpose,
  viewModelFromOperationalEntries,
} from '../../data/operationalMilestones'
import {
  getScheduleEntryTimeZone,
  normalizeForApi,
  nowToNaiveLocalInScheduleZone,
  utcIsoToNaiveLocal,
} from '../../utils/scheduleDateTime'

const POST_STEPS = [
  { uiKey: 'finalInspection', apiKey: 'final_inspection', label: 'FINAL INSPECTION' },
  { uiKey: 'finalCargoChecking', apiKey: 'final_sounding', label: 'FINAL CARGO CHECKING' },
]

function haptic() {
  try {
    navigator.vibrate?.(15)
  } catch {
    /* ignore */
  }
}

function formatDisplayTime(iso, tz) {
  if (!iso) return ''
  try {
    const local = utcIsoToNaiveLocal(iso, tz)
    if (!local) return ''
    const [, time] = String(local).split('T')
    return time ? time.slice(0, 5) : local
  } catch {
    return ''
  }
}

function deriveMilestoneState(milestoneKey, activities, naByLabel, purpose) {
  const list = getMilestoneListForPurpose(purpose)
  const label = list.find((m) => m.key === milestoneKey)?.label
  if (naByLabel?.[label]?.reason) return { state: 'done', detail: 'N/A', activities: [] }
  const rows = (activities || []).filter((a) => a.category === label)
  if (rows.length === 0) return { state: 'pending', detail: '', activities: rows }

  if (milestoneKey === 'opening_hatch') {
    const allStarted = rows.every((a) => Boolean(a.startTime))
    const complete = rows.every(
      (a) => Boolean(a.startTime) && a.cargoHandlingMethodId != null && a.cargoHandlingMethodId !== ''
    )
    if (complete) {
      return {
        state: 'done',
        detail: rows[0]?.subStepTitle
          ? `${rows[0].subStepTitle} · ${formatDisplayTime(rows[0].startTime, getScheduleEntryTimeZone())}`
          : formatDisplayTime(rows[0].startTime, getScheduleEntryTimeZone()),
        activities: rows,
      }
    }
    return {
      state: allStarted ? 'active' : 'pending',
      detail: formatDisplayTime(rows[0]?.startTime, getScheduleEntryTimeZone()),
      activities: rows,
    }
  }

  if (milestoneKey === 'cargo_pre_conditioning') {
    const allStarted = rows.every((a) => Boolean(a.startTime))
    return {
      state: allStarted ? 'done' : 'active',
      detail: formatDisplayTime(rows[0]?.startTime, getScheduleEntryTimeZone()),
      activities: rows,
    }
  }

  if (milestoneKey === 'cargo_operations') {
    const openLine = rows.find((r) =>
      (r.cargoLoadLines || []).some((l) => l.startAt && !l.endAt)
    )
    if (openLine) {
      const line = (openLine.cargoLoadLines || []).find((l) => l.startAt && !l.endAt)
      const tankCodes = (line?.tanks || []).map((t) => t.code || t.name).filter(Boolean)
      const tankIds = line?.tankIds || openLine.tankIds || []
      return {
        state: 'active',
        detail: tankCodes.length
          ? `Tanks: ${tankCodes.join(', ')}`
          : tankIds.length
            ? `Tanks: ${tankIds.length} selected`
            : 'In progress',
        activities: rows,
        openEntry: openLine,
        openLine: line,
      }
    }
    const anyClosed = rows.some((r) =>
      (r.cargoLoadLines || []).some((l) => l.startAt && l.endAt)
    )
    if (anyClosed || rows.length > 0) {
      const last = rows[rows.length - 1]
      const lastLine = (last.cargoLoadLines || []).slice(-1)[0]
      const tankCodes = (lastLine?.tanks || last.tanks || []).map((t) => t.code || t.name).filter(Boolean)
      return {
        state: 'done',
        detail: tankCodes.length ? `Tanks: ${tankCodes.join(', ')}` : 'Completed',
        activities: rows,
        lastTankIds: lastLine?.tankIds || last.tankIds || [],
      }
    }
    return { state: 'pending', detail: 'Tanks: (none yet)', activities: rows }
  }

  // other
  const open = rows.find((a) => a.startTime && !a.endTime)
  if (open) {
    return {
      state: 'active',
      detail: formatDisplayTime(open.startTime, getScheduleEntryTimeZone()),
      activities: rows,
      openEntry: open,
    }
  }
  if (rows.some((a) => a.endTime)) {
    const last = rows[rows.length - 1]
    return {
      state: 'done',
      detail: formatDisplayTime(last.endTime || last.startTime, getScheduleEntryTimeZone()),
      activities: rows,
    }
  }
  if (rows.some((a) => a.startTime)) {
    return {
      state: 'done',
      detail: formatDisplayTime(rows[0].startTime, getScheduleEntryTimeZone()),
      activities: rows,
    }
  }
  return { state: 'pending', detail: '', activities: rows }
}

function openingHasStarted(activities, naByLabel, purpose) {
  const st = deriveMilestoneState('opening_hatch', activities, naByLabel, purpose)
  return st.state === 'done' || st.state === 'active' || Boolean(naByLabel?.OPENING?.reason)
}

export function useOperatorExecution(operationId) {
  const tz = getScheduleEntryTimeZone()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState(null)
  const [operation, setOperation] = useState(null)
  const [activities, setActivities] = useState([])
  const [naByLabel, setNaByLabel] = useState({})
  const [postByKey, setPostByKey] = useState({})
  const [siblings, setSiblings] = useState([])
  const [tankOptions, setTankOptions] = useState([])

  const showToast = useCallback((message, variant = 'success') => {
    setToast({ message, variant })
    window.setTimeout(() => setToast(null), 2800)
  }, [])

  const purpose = operation?.purpose === 'Unloading' ? 'Unloading' : 'Loading'
  const commodityType = operation?.commodityType === 'Solid' ? 'Solid' : 'Liquid'
  const portId = operation?.portId ?? null

  const reload = useCallback(async () => {
    if (operationId == null || Number.isNaN(Number(operationId))) {
      setError('Invalid operation')
      setLoading(false)
      return
    }
    setError('')
    try {
      const [op, opActs, postRows, overview] = await Promise.all([
        fetchOperation(operationId),
        fetchOperationalActivities(operationId),
        fetchSubProcesses(operationId, 'Post-Checking'),
        fetchAllocationOverview().catch(() => ({ queue: [] })),
      ])
      setOperation(op || null)
      const vm = viewModelFromOperationalEntries(opActs?.entries || [], op?.purpose === 'Unloading' ? 'Unloading' : 'Loading')
      setActivities(vm.activities)
      setNaByLabel(vm.naByLabel)

      const postMap = {}
      const list = Array.isArray(postRows) ? postRows : []
      for (const row of list) {
        const key = row.subProcessKey || row.sub_process_key
        if (key) postMap[key] = row
      }
      setPostByKey(postMap)

      const pid = Number(op?.shipmentPlanId)
      const queue = Array.isArray(overview?.queue) ? overview.queue : []
      const sibs =
        Number.isFinite(pid) && pid > 0
          ? queue
              .filter((x) => x?.operationId != null && Number(x.shipmentPlanId) === pid)
              .sort((a, b) => Number(a.operationId) - Number(b.operationId))
          : []
      setSiblings(sibs)
    } catch (e) {
      setError(e?.message || 'Failed to load operation')
    } finally {
      setLoading(false)
    }
  }, [operationId])

  useEffect(() => {
    setLoading(true)
    reload()
  }, [reload])

  useEffect(() => {
    if (commodityType !== 'Liquid' || portId == null || portId === '') {
      setTankOptions([])
      return
    }
    let cancelled = false
    fetchMasterTanks(portId)
      .then((list) => {
        if (cancelled) return
        setTankOptions(
          (Array.isArray(list) ? list : []).map((tk) => ({
            id: String(tk.id),
            code: tk.code || String(tk.id),
            name: tk.name || '',
            hasAtg: tk.hasAtg === true,
            label: tk.hasAtg
              ? `${tk.code || tk.id}${tk.name ? ` — ${tk.name}` : ''} · ATG`
              : `${tk.code || tk.id}${tk.name ? ` — ${tk.name}` : ''}`,
          }))
        )
      })
      .catch(() => {
        if (!cancelled) setTankOptions([])
      })
    return () => {
      cancelled = true
    }
  }, [commodityType, portId])

  const milestones = useMemo(() => {
    const defs = getMilestoneListForPurpose(purpose)
    return defs.map((m) => ({
      ...m,
      ...deriveMilestoneState(m.key, activities, naByLabel, purpose),
    }))
  }, [purpose, activities, naByLabel])

  const postSteps = useMemo(() => {
    return POST_STEPS.map((s) => {
      let row = postByKey[s.apiKey]
      let apiKey = s.apiKey
      if (!row && s.apiKey === 'final_inspection') {
        row = postByKey.final_tank_inspection || postByKey.final_hold_inspection || null
        if (row) apiKey = row.subProcessKey || row.sub_process_key || apiKey
      }
      const status = String(row?.status || 'Not Started')
      const done = /done|complete/i.test(status)
      const ts =
        row?.occurredAt ||
        row?.endAt ||
        row?.startAt ||
        row?.occurred_at ||
        row?.end_at ||
        row?.start_at ||
        null
      return {
        ...s,
        apiKey,
        state: done ? 'done' : /progress/i.test(status) ? 'active' : 'pending',
        detail: done ? formatDisplayTime(ts, tz) : '',
        row,
        occurredAt: ts,
      }
    })
  }, [postByKey, tz])

  const activityLog = useMemo(() => {
    const items = []
    for (const a of activities) {
      const lines = a.cargoLoadLines || []
      if (lines.length > 0) {
        for (const line of lines) {
          if (line.startAt) {
            const tanks = (line.tanks || []).map((t) => t.code || t.name).filter(Boolean)
            items.push({
              id: `l-${a.id}-${line.id || line.startAt}-s`,
              label: `Cargo start${tanks.length ? ` ${tanks.join('+')}` : ''}`,
              at: line.startAt,
            })
          }
          if (line.endAt) {
            items.push({
              id: `l-${a.id}-${line.id || line.endAt}-e`,
              label: 'Cargo stop',
              at: line.endAt,
            })
          }
        }
      } else {
        if (a.startTime) {
          items.push({
            id: `a-${a.id}-start`,
            label: `${a.category}${a.subStepTitle ? ` · ${a.subStepTitle}` : ''} started`,
            at: a.startTime,
          })
        }
        if (a.endTime) {
          items.push({
            id: `a-${a.id}-end`,
            label: `${a.category} stopped`,
            at: a.endTime,
          })
        }
      }
    }
    for (const s of postSteps) {
      if (s.state === 'done' && s.occurredAt) {
        items.push({
          id: `p-${s.apiKey}`,
          label: `${s.label} done`,
          at: s.occurredAt,
        })
      }
    }
    items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    return items
  }, [activities, postSteps])

  const confirmSequence = useCallback(() => {
    if (openingHasStarted(activities, naByLabel, purpose)) return true
    return window.confirm('Opening is not completed. Continue anyway?')
  }, [activities, naByLabel, purpose])

  const runMutation = useCallback(
    async (fn, successMsg) => {
      setBusy(true)
      setError('')
      try {
        await fn()
        await reload()
        haptic()
        if (successMsg) showToast(successMsg)
        return true
      } catch (e) {
        setError(e?.message || 'Action failed')
        showToast(e?.message || 'Action failed', 'error')
        return false
      } finally {
        setBusy(false)
      }
    },
    [reload, showToast]
  )

  const startMilestone = useCallback(
    async (milestoneKey, { tankIds } = {}) => {
      if (milestoneKey === 'cargo_operations' || milestoneKey === 'other') {
        if (!confirmSequence()) return false
      }
      const nowLocal = nowToNaiveLocalInScheduleZone(tz)
      const nowIso = normalizeForApi(nowLocal, tz)

      if (milestoneKey === 'cargo_operations') {
        if (commodityType === 'Liquid' && (!Array.isArray(tankIds) || tankIds.length === 0)) {
          showToast('Select at least one tank', 'error')
          return false
        }
        return runMutation(async () => {
          await createOperationalEntry(
            operationId,
            {
              entryType: 'activity',
              milestoneKey: 'cargo_operations',
              subStepTitle: 'Cargo',
              startAt: nowIso,
              endAt: null,
              cargoLoadLines: [
                {
                  startAt: nowIso,
                  endAt: null,
                  tankIds: commodityType === 'Liquid' ? tankIds : undefined,
                },
              ],
            },
            { scheduleIana: tz }
          )
        }, 'Cargo started')
      }

      const defaults = {
        opening_hatch: { subStepTitle: 'Opening' },
        cargo_pre_conditioning: { subStepTitle: 'Pre-conditioning' },
        other: { subStepTitle: 'Other' },
      }
      const meta = defaults[milestoneKey] || { subStepTitle: 'Activity' }
      return runMutation(async () => {
        await createOperationalEntry(
          operationId,
          {
            entryType: 'activity',
            milestoneKey,
            subStepTitle: meta.subStepTitle,
            startAt: nowIso,
            endAt: null,
          },
          { scheduleIana: tz }
        )
      }, `${meta.subStepTitle} started`)
    },
    [commodityType, confirmSequence, operationId, runMutation, showToast, tz]
  )

  const stopCargo = useCallback(async () => {
    const st = deriveMilestoneState('cargo_operations', activities, naByLabel, purpose)
    const entry = st.openEntry
    const openLine = st.openLine
    if (!entry?.id || !openLine) {
      showToast('No active cargo line to stop', 'error')
      return
    }
    const nowLocal = nowToNaiveLocalInScheduleZone(tz)
    const nowIso = normalizeForApi(nowLocal, tz)
    const lines = (entry.cargoLoadLines || []).map((l) => {
      const isOpen = l.startAt && !l.endAt
      return {
        startAt: l.startAt,
        endAt: isOpen ? nowIso : l.endAt,
        qty: l.qty,
        tankIds: l.tankIds || [],
      }
    })
    await runMutation(async () => {
      await updateOperationalEntry(
        operationId,
        entry.id,
        {
          milestoneKey: 'cargo_operations',
          subStepTitle: entry.subStepTitle || 'Cargo',
          startAt: entry.startTime,
          endAt: null,
          cargoLoadLines: lines,
        },
        { scheduleIana: tz }
      )
    }, 'Cargo stopped')
  }, [activities, naByLabel, operationId, purpose, runMutation, showToast, tz])

  const completeOther = useCallback(async () => {
    const st = deriveMilestoneState('other', activities, naByLabel, purpose)
    const entry = st.openEntry
    if (!entry?.id) {
      showToast('No active Other step', 'error')
      return
    }
    const nowLocal = nowToNaiveLocalInScheduleZone(tz)
    const nowIso = normalizeForApi(nowLocal, tz)
    await runMutation(async () => {
      await updateOperationalEntry(
        operationId,
        entry.id,
        {
          milestoneKey: 'other',
          subStepTitle: entry.subStepTitle || 'Other',
          startAt: entry.startTime,
          endAt: nowIso,
        },
        { scheduleIana: tz }
      )
    }, 'Other completed')
  }, [activities, naByLabel, operationId, purpose, runMutation, showToast, tz])

  const markPostDone = useCallback(
    async (apiKey) => {
      const nowLocal = nowToNaiveLocalInScheduleZone(tz)
      const nowIso = normalizeForApi(nowLocal, tz)
      await runMutation(async () => {
        await upsertSubProcess(
          operationId,
          apiKey,
          {
            phase: 'Post-Checking',
            status: 'Done',
            occurredAt: nowIso,
            startAt: nowIso,
            endAt: nowIso,
          },
          { scheduleIana: tz }
        )
      }, 'Marked done')
    },
    [operationId, runMutation, tz]
  )

  const editOperationalTimestamp = useCallback(
    async ({ entryId, milestoneKey, field, valueLocal, cargoLineIndex }) => {
      const entry = activities.find((a) => String(a.id) === String(entryId))
      if (!entry) throw new Error('Entry not found')
      const iso = normalizeForApi(valueLocal, tz)
      if (milestoneKey === 'cargo_operations' && Array.isArray(entry.cargoLoadLines)) {
        const lines = entry.cargoLoadLines.map((l, idx) => ({
          startAt: idx === cargoLineIndex && field === 'startAt' ? iso : l.startAt,
          endAt: idx === cargoLineIndex && field === 'endAt' ? iso : l.endAt,
          qty: l.qty,
          tankIds: l.tankIds || [],
        }))
        await updateOperationalEntry(
          operationId,
          entryId,
          {
            milestoneKey: 'cargo_operations',
            subStepTitle: entry.subStepTitle || 'Cargo',
            startAt: entry.startTime,
            endAt: entry.endTime,
            cargoLoadLines: lines,
          },
          { scheduleIana: tz }
        )
      } else {
        await updateOperationalEntry(
          operationId,
          entryId,
          {
            milestoneKey,
            subStepTitle: entry.subStepTitle || '',
            startAt: field === 'startAt' ? iso : entry.startTime,
            endAt: field === 'endAt' ? iso : entry.endTime,
          },
          { scheduleIana: tz }
        )
      }
      await reload()
      haptic()
      showToast('Timestamp updated')
    },
    [activities, operationId, reload, showToast, tz]
  )

  const editPostTimestamp = useCallback(
    async (apiKey, valueLocal) => {
      const iso = normalizeForApi(valueLocal, tz)
      await upsertSubProcess(
        operationId,
        apiKey,
        {
          phase: 'Post-Checking',
          status: 'Done',
          occurredAt: iso,
          startAt: iso,
          endAt: iso,
        },
        { scheduleIana: tz }
      )
      await reload()
      haptic()
      showToast('Timestamp updated')
    },
    [operationId, reload, showToast, tz]
  )

  return {
    loading,
    busy,
    error,
    toast,
    clearToast: () => setToast(null),
    operation,
    purpose,
    commodityType,
    portId,
    siblings,
    tankOptions,
    milestones,
    postSteps,
    activityLog,
    tz,
    nowLocal: () => nowToNaiveLocalInScheduleZone(tz),
    toLocal: (iso) => utcIsoToNaiveLocal(iso, tz),
    startMilestone,
    stopCargo,
    completeOther,
    markPostDone,
    editOperationalTimestamp,
    editPostTimestamp,
    reload,
  }
}
