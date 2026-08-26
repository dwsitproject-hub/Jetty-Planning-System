import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchAllocationOverview } from '../../api/allocation'
import { fetchMasterTanks } from '../../api/masterTanks'
import { fetchTankGaugingMassDelta } from '../../api/tankGauging'
import {
  createOperationalEntry,
  fetchOperation,
  fetchOperationalActivities,
  fetchSubProcesses,
  resolveCargoLineTankIdsForApi,
  updateOperationalEntry,
  upsertSubProcess,
} from '../../api/operations'
import {
  getMilestoneListForPurpose,
  viewModelFromOperationalEntries,
} from '../../data/operationalMilestones'
import {
  ensureApiEndAfterStart,
  ensureApiStartAfterPreviousEnd,
  getScheduleEntryTimeZone,
  normalizeForApi,
  nowToNaiveLocalInScheduleZone,
  nowToNaiveLocalWithSecondsInScheduleZone,
  utcIsoToNaiveLocal,
} from '../../utils/scheduleDateTime'
import { buildOperatorCargoSegments } from '../../utils/operatorCargoSegments'
import i18n from '../../i18n'
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
          ? i18n.t('operator:cargo.tanksLabel', { list: tankCodes.join(', ') })
          : tankIds.length
            ? i18n.t('operator:cargo.tanksSelected', { count: tankIds.length })
            : i18n.t('operator:cargo.inProgress'),
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
      const closedCount = rows.reduce(
        (n, r) => n + (r.cargoLoadLines || []).filter((l) => l.startAt && l.endAt).length,
        0
      )
      const tankCodes = (lastLine?.tanks || last.tanks || []).map((t) => t.code || t.name).filter(Boolean)
      const detailParts = []
      if (closedCount > 1) detailParts.push(i18n.t('operator:cargo.segmentsDone', { count: closedCount }))
      if (tankCodes.length) detailParts.push(i18n.t('operator:cargo.lastTanks', { list: tankCodes.join(', ') }))
      else if (closedCount <= 1) detailParts.push(i18n.t('operator:cargo.completed'))
      return {
        state: 'done',
        detail: detailParts.join(' · ') || i18n.t('operator:cargo.completed'),
        activities: rows,
        lastTankIds: lastLine?.tankIds || last.tankIds || [],
        closedSegmentCount: closedCount,
      }
    }
    return { state: 'pending', detail: i18n.t('operator:cargo.tanksNoneYet'), activities: rows }
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

function buildOperatorActivityRemark(milestoneKey, { subStepTitle, tankIds, tankOptions } = {}) {
  if (milestoneKey === 'cargo_operations' && Array.isArray(tankIds) && tankIds.length > 0) {
    const codes = tankIds
      .map((id) => tankOptions?.find((t) => String(t.id) === String(id))?.code)
      .filter(Boolean)
    if (codes.length) return codes.join(', ')
  }
  return subStepTitle || '—'
}

function operatorNowLocal(tz) {
  return nowToNaiveLocalWithSecondsInScheduleZone(tz)
}

async function buildStoppedCargoLine(openLine, endIso, { portId, commodityType, tankOptions, tz }) {
  const tankIds = resolveLineTankIds(openLine)
  const line = {
    startAt: openLine.startAt,
    endAt: endIso,
    tankIds,
    atgQtyMode: 'auto',
  }
  if (commodityType !== 'Liquid' || !portId || tankIds.length === 0) return line

  const atgTankIds = tankIds.filter((id) =>
    tankOptions?.find((t) => String(t.id) === String(id))?.hasAtg
  )
  if (atgTankIds.length === 0) return line

  try {
    const data = await fetchTankGaugingMassDelta({
      portId,
      tankIds: atgTankIds,
      startAt: normalizeForApi(openLine.startAt, tz),
      endAt: endIso,
    })
    const mass = Number(data?.sumDeltaMass)
    if (!data?.incomplete && Number.isFinite(mass) && mass > 0) {
      line.qty = mass
    }
  } catch {
    /* backend may compute ATG on save when qty omitted for pure ATG lines */
  }
  return line
}

function resolveLineTankIds(line) {
  if (Array.isArray(line?.tankIds) && line.tankIds.length) {
    return line.tankIds.map(String)
  }
  if (Array.isArray(line?.tanks) && line.tanks.length) {
    return line.tanks.map((t) => String(t.id)).filter(Boolean)
  }
  return []
}

function mapExistingCargoLine(l, entry) {
  let tankIds = resolveLineTankIds(l)
  if (tankIds.length === 0 && entry) {
    const lineCount = (entry.cargoLoadLines || []).length
    if (lineCount === 1) {
      tankIds = resolveLineTankIds({ tankIds: entry.tankIds, tanks: entry.tanks })
    }
  }
  return {
    startAt: l.startAt,
    endAt: l.endAt,
    qty: l.qty,
    tankIds,
    atgQtyMode: l.atgQtyMode || 'auto',
    manualQty: l.manualQty,
  }
}

function assertLiquidCargoLinesHaveTanks(lines, { requireAllLines = true } = {}) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const parsed = resolveCargoLineTankIdsForApi(line)
    if (parsed.length === 0 && (requireAllLines || i === lines.length - 1)) {
      return { ok: false, index: i }
    }
  }
  return { ok: true }
}

function findCargoEntryForNextSegment(activities, naByLabel, purpose) {
  const st = deriveMilestoneState('cargo_operations', activities, naByLabel, purpose)
  if (st.state === 'active') return null
  const rows = st.activities || []
  if (!rows.length) return null
  const entry = rows[rows.length - 1]
  const lines = entry.cargoLoadLines || []
  if (lines.some((l) => l.startAt && !l.endAt)) return null
  if (!lines.some((l) => l.startAt && l.endAt)) return null
  return entry
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
      setError(i18n.t('operator:exec.invalidOperation'))
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
      setError(e?.message || i18n.t('operator:exec.loadFailed'))
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
    return defs.map((m) => {
      const state = deriveMilestoneState(m.key, activities, naByLabel, purpose)
      if (m.key === 'cargo_operations') {
        return {
          ...m,
          ...state,
          cargoSegments: buildOperatorCargoSegments(activities, purpose),
        }
      }
      return { ...m, ...state }
    })
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
    return window.confirm(i18n.t('operator:confirm.openingIncomplete'))
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
        setError(e?.message || i18n.t('operator:toast.actionFailed'))
        showToast(e?.message || i18n.t('operator:toast.actionFailed'), 'error')
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
      const nowLocal = operatorNowLocal(tz)
      const nowIso = normalizeForApi(nowLocal, tz)

      if (milestoneKey === 'cargo_operations') {
        if (commodityType === 'Liquid' && (!Array.isArray(tankIds) || tankIds.length === 0)) {
          showToast(i18n.t('operator:toast.selectTank'), 'error')
          return false
        }
        const normalizedTankIds =
          commodityType === 'Liquid' ? tankIds.map(String).filter(Boolean) : []
        if (commodityType === 'Liquid') {
          const parsedSelection = resolveCargoLineTankIdsForApi({ tankIds: normalizedTankIds })
          if (parsedSelection.length === 0) {
            showToast(i18n.t('operator:toast.invalidTankSelection'), 'error')
            return false
          }
        }
        const existingCargo = findCargoEntryForNextSegment(activities, naByLabel, purpose)
        return runMutation(async () => {
          if (existingCargo?.id) {
            const prevLines = (existingCargo.cargoLoadLines || []).map((l) =>
              mapExistingCargoLine(l, existingCargo)
            )
            const tankCheck = assertLiquidCargoLinesHaveTanks(
              commodityType === 'Liquid'
                ? [
                    ...prevLines,
                    {
                      startAt: nowIso,
                      endAt: null,
                      tankIds: normalizedTankIds,
                    },
                  ]
                : prevLines,
              { requireAllLines: commodityType === 'Liquid' }
            )
            if (commodityType === 'Liquid' && !tankCheck.ok) {
              if (tankCheck.index < prevLines.length) {
                throw new Error(i18n.t('operator:toast.prevSegmentMissingTanks'))
              }
              throw new Error(i18n.t('operator:toast.selectTank'))
            }
            const lastEnd = prevLines[prevLines.length - 1]?.endAt
            const lineStartIso = lastEnd
              ? ensureApiStartAfterPreviousEnd(lastEnd, nowIso, tz)
              : nowIso
            await updateOperationalEntry(
              operationId,
              existingCargo.id,
              {
                milestoneKey: 'cargo_operations',
                subStepTitle: existingCargo.subStepTitle || 'Cargo',
                remark: existingCargo.description || existingCargo.remark || 'Cargo',
                startAt: existingCargo.startTime,
                endAt: null,
                cargoLoadLines: [
                  ...prevLines,
                  {
                    startAt: lineStartIso,
                    endAt: null,
                    tankIds: normalizedTankIds,
                    atgQtyMode: 'auto',
                  },
                ],
              },
              { scheduleIana: tz }
            )
          } else {
            await createOperationalEntry(
              operationId,
              {
                entryType: 'activity',
                milestoneKey: 'cargo_operations',
                subStepTitle: 'Cargo',
                remark: buildOperatorActivityRemark('cargo_operations', {
                  subStepTitle: 'Cargo',
                  tankIds: normalizedTankIds,
                  tankOptions,
                }),
                startAt: nowIso,
                endAt: null,
                cargoLoadLines: [
                  {
                    startAt: nowIso,
                    endAt: null,
                    tankIds: normalizedTankIds,
                    atgQtyMode: 'auto',
                  },
                ],
              },
              { scheduleIana: tz }
            )
          }
        }, existingCargo?.id ? i18n.t('operator:toast.cargoNextSegment') : i18n.t('operator:toast.cargoStarted'))
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
            remark: buildOperatorActivityRemark(milestoneKey, { subStepTitle: meta.subStepTitle }),
            startAt: nowIso,
            endAt: null,
          },
          { scheduleIana: tz }
        )
      }, i18n.t('operator:toast.milestoneStarted', { name: meta.subStepTitle }))
    },
    [activities, commodityType, confirmSequence, naByLabel, operationId, purpose, runMutation, showToast, tankOptions, tz]
  )

  const stopCargo = useCallback(async () => {
    const st = deriveMilestoneState('cargo_operations', activities, naByLabel, purpose)
    const entry = st.openEntry
    const openLine = st.openLine
    if (!entry?.id || !openLine) {
      showToast(i18n.t('operator:toast.noActiveCargo'), 'error')
      return
    }
    const nowLocal = operatorNowLocal(tz)
    const endIso = ensureApiEndAfterStart(openLine.startAt, normalizeForApi(nowLocal, tz), tz)
    const lines = await Promise.all(
      (entry.cargoLoadLines || []).map(async (l) => {
        const isOpen = l.startAt && !l.endAt
        if (!isOpen) {
          return {
            startAt: l.startAt,
            endAt: l.endAt,
            qty: l.qty,
            tankIds: resolveLineTankIds(l),
            atgQtyMode: l.atgQtyMode || 'auto',
          }
        }
        return buildStoppedCargoLine(l, endIso, { portId, commodityType, tankOptions, tz })
      })
    )
    const openStopped = lines.find((l) => l.endAt && (l.qty == null || l.qty === ''))
    if (
      commodityType === 'Liquid' &&
      openStopped &&
      (openStopped.tankIds || []).some((id) =>
        tankOptions?.find((t) => String(t.id) === String(id))?.hasAtg
      )
    ) {
      showToast(i18n.t('operator:toast.atgQtyPending'), 'error')
      return
    }
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
    }, i18n.t('operator:toast.cargoStopped'))
  }, [
    activities,
    commodityType,
    naByLabel,
    operationId,
    portId,
    purpose,
    runMutation,
    showToast,
    tankOptions,
    tz,
  ])

  const completeOther = useCallback(async () => {
    const st = deriveMilestoneState('other', activities, naByLabel, purpose)
    const entry = st.openEntry
    if (!entry?.id) {
      showToast(i18n.t('operator:toast.noActiveOther'), 'error')
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
    }, i18n.t('operator:toast.otherCompleted'))
  }, [activities, naByLabel, operationId, purpose, runMutation, showToast, tz])

  const markPostDone = useCallback(
    async (apiKey) => {
      const nowLocal = operatorNowLocal(tz)
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
      }, i18n.t('operator:toast.markedDone'))
    },
    [operationId, runMutation, tz]
  )

  const editOperationalTimestamp = useCallback(
    async ({ entryId, milestoneKey, field, valueLocal, cargoLineIndex }) => {
      const entry = activities.find((a) => String(a.id) === String(entryId))
      if (!entry) throw new Error(i18n.t('operator:exec.entryNotFound'))
      const iso = normalizeForApi(valueLocal, tz)
      if (milestoneKey === 'cargo_operations' && Array.isArray(entry.cargoLoadLines)) {
        const lines = entry.cargoLoadLines.map((l, idx) => {
          const edited = idx === cargoLineIndex
          return {
            startAt: edited && field === 'startAt' ? iso : l.startAt,
            endAt: edited && field === 'endAt' ? iso : l.endAt,
            // The moved segment covers a different window, so let the server
            // recompute from ATG; its previous quantity is only the fallback for
            // when ATG cannot answer for the new window.
            qty: l.qty,
            tankIds: resolveLineTankIds(l),
            atgQtyMode: edited ? 'auto' : l.atgQtyMode || 'auto',
          }
        })
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
      showToast(i18n.t('operator:toast.timestampUpdated'))
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
      showToast(i18n.t('operator:toast.timestampUpdated'))
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
