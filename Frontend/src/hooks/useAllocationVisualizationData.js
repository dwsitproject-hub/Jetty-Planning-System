import { useEffect, useMemo, useState, useCallback } from 'react'
import { fetchAllocationOverview, fetchAllocationPlanOverview } from '../api/allocation'
import { usePortScope } from '../context/PortScopeContext'
import { mergeBerthsStateForPlanPov, mergeQueueRowsForPlanPov } from '../utils/allocationPlanPovMerge'
import { formatDateTimeDisplay } from '../utils/formatDateTimeDisplay'
import { getEtcBreach, getEtcBreachRagStatus } from '../utils/etcBreach'

function schematicMaterialDisplay(r) {
  return r?.materialDisplay ?? r?.material ?? r?.commodity ?? '—'
}

function buildVesselById({ planViz, isPlanCentric, breachNowMs }) {
  const map = {}
  const srcList = planViz.mergedList
  const srcSchedule = planViz.mergedSchedule
  const srcBerths = planViz.mergedBerths

  const refLabel = (r) => {
    if (isPlanCentric && String(r?.vesselId || '').startsWith('plan-')) {
      return r.planReference || r.shippingInstruction || '—'
    }
    return r.shippingInstruction || '—'
  }

  const addRow = (r) => {
    if (!r?.vesselId || map[r.vesselId]) return
    map[r.vesselId] = {
      vesselName: r.vesselName || r.vesselId,
      siId: refLabel(r),
      purpose: r.purpose || null,
      loadDischarge: r.loadDischarge ?? null,
      commodity: r.commodity || null,
      materialDisplay: schematicMaterialDisplay(r),
      etaToCompletion: r.estimatedCompletionDateTime
        ? formatDateTimeDisplay(r.estimatedCompletionDateTime)
        : '—',
      ragStatus: getEtcBreachRagStatus(r, breachNowMs),
      etcBreach: getEtcBreach(r, breachNowMs),
      status: r.status || null,
    }
  }

  for (const r of srcList) addRow(r)
  for (const r of srcSchedule) addRow(r)

  for (const b of srcBerths || []) {
    for (const o of Array.isArray(b?.occupants) ? b.occupants : []) {
      if (!o?.vesselId || map[o.vesselId]) continue
      map[o.vesselId] = {
        vesselName: o.vesselName || o.vesselId,
        siId: '—',
        purpose: o.purpose || null,
        loadDischarge: o.loadDischarge ?? null,
        commodity: null,
        materialDisplay: schematicMaterialDisplay(o),
        etaToCompletion: o.estimatedCompletionDateTime
          ? formatDateTimeDisplay(o.estimatedCompletionDateTime)
          : '—',
        ragStatus: getEtcBreachRagStatus(o, breachNowMs),
        etcBreach: getEtcBreach(o, breachNowMs),
        status: o.status || null,
      }
    }
  }

  return map
}

/**
 * Shared allocation overview data for schematic / schedule visualizations (incl. popout).
 * @param {'plan' | 'legacy'} profile
 */
export default function useAllocationVisualizationData(profile = 'plan') {
  const isPlanCentric = profile === 'plan'
  const { selectedPortId, selectedPort } = usePortScope()
  const overviewFetcher = useMemo(
    () => (isPlanCentric ? fetchAllocationPlanOverview : fetchAllocationOverview),
    [isPlanCentric]
  )

  const [list, setList] = useState([])
  const [scheduleList, setScheduleList] = useState([])
  const [berthsState, setBerthsState] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [breachNowMs, setBreachNowMs] = useState(() => Date.now())

  const applyOverview = useCallback((data) => {
    setList(Array.isArray(data?.queue) ? data.queue : [])
    setScheduleList(
      Array.isArray(data?.scheduleQueue)
        ? data.scheduleQueue
        : Array.isArray(data?.queue)
          ? data.queue
          : []
    )
    setBerthsState(Array.isArray(data?.berths) ? data.berths : [])
  }, [])

  const reload = useCallback(() => {
    if (!selectedPortId) {
      setList([])
      setScheduleList([])
      setBerthsState([])
      setLoading(false)
      return Promise.resolve()
    }
    setLoading(true)
    setError(null)
    return overviewFetcher()
      .then((data) => {
        applyOverview(data)
      })
      .catch((err) => {
        setError(err?.message || 'Failed to load allocation data')
        setList([])
        setScheduleList([])
        setBerthsState([])
      })
      .finally(() => {
        setLoading(false)
      })
  }, [selectedPortId, overviewFetcher, applyOverview])

  useEffect(() => {
    reload()
  }, [reload])

  useEffect(() => {
    const id = setInterval(() => {
      setBreachNowMs(Date.now())
      if (selectedPortId) {
        overviewFetcher()
          .then(applyOverview)
          .catch(() => {})
      }
    }, 30_000)
    return () => clearInterval(id)
  }, [selectedPortId, overviewFetcher, applyOverview])

  const planViz = useMemo(() => {
    if (!isPlanCentric) {
      return {
        mergedList: list,
        mergedSchedule: scheduleList,
        mergedBerths: berthsState,
        planVesselToRepresentativeVesselId: new Map(),
      }
    }
    const q = mergeQueueRowsForPlanPov(list)
    const s = mergeQueueRowsForPlanPov(scheduleList)
    const rep = new Map([...q.planVesselToRepresentativeVesselId, ...s.planVesselToRepresentativeVesselId])
    return {
      mergedList: q.mergedRows,
      mergedSchedule: s.mergedRows,
      mergedBerths: mergeBerthsStateForPlanPov(berthsState, rep),
      planVesselToRepresentativeVesselId: rep,
    }
  }, [isPlanCentric, list, scheduleList, berthsState])

  const vesselById = useMemo(
    () => buildVesselById({ planViz, isPlanCentric, breachNowMs }),
    [planViz, isPlanCentric, breachNowMs]
  )

  const berthIds = useMemo(
    () => (Array.isArray(berthsState) ? berthsState.map((b) => b.id).filter(Boolean) : []),
    [berthsState]
  )

  return {
    loading,
    error,
    isPlanCentric,
    selectedPortId,
    selectedPort,
    planViz,
    vesselById,
    berthIds,
    berthsState,
    breachNowMs,
    reload,
  }
}
