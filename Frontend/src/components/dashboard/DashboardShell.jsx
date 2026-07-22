import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { fetchOperations, fetchAtBerth, fetchSubProcesses, fetchOperationalActivities } from '../../api/operations'
import { fetchShipmentPlans } from '../../api/shipmentPlans'
import { fetchDashboardV2Weekly, fetchDashboardV2PipelineActuals, fetchDashboardV2SlotOccupancy, fetchDashboardV2SlaAtRisk } from '../../api/dashboardV2'
import { fetchJetties } from '../../api/jetties'
import { fetchSiLookups } from '../../api/siLookups'
import { useTranslation } from 'react-i18next'
import { usePortScope } from '../../context/PortScopeContext'
import { formatDateDisplay, formatDateTimeDisplay, getAppLocaleTag } from '../../utils/formatDateTimeDisplay'
import InteractiveTooltip from '../InteractiveTooltip'
import WidgetDetailModal from '../WidgetDetailModal'
import DashboardV2WeeklyTrends from '../DashboardV2WeeklyTrends'
import DropdownMultiSelect from '../DropdownMultiSelect'
import DateRangePicker from './DateRangePicker'
import { computePipelinePartition } from '../../utils/dashboardPipelinePartition'
import { isLegacyVesselPipelineEnabled } from '../../utils/pipelineActualsBeta'
import {
  buildPlanCommodityIndex,
  buildCommodityIdByName,
  buildCommodityNameById,
  extractCommodityOptionsFromMaster,
  filterPlans,
  filterOps,
  pruneInvalidCommoditySelection,
} from '../../utils/dashboardFilters'
import {
  AT_BERTH_PHASES,
  PHASE_EMOJI,
  fmtLocalDate,
  getTodayRange,
  getMonthRange,
  isTodayOnlyRange,
  parseDateLocal,
  parseIso,
  formatDurationHours,
  median,
  formatRelativeTime,
  phaseForCardDetailed,
  formatDateRangeLabel,
  formatSlaCount,
} from '../../utils/dashboardPageUtils'
import '../../styles/dashboard.css'
import '../../styles/allocation.css'

export default function DashboardShell({ mode = 'live' }) {
  const isLive = mode === 'live'
  const isAnalytics = mode === 'analytics'
  const titleKey = isLive ? 'liveOpsDashboard' : 'opsAnalyticsDashboard'
  const { t } = useTranslation('dashboard')
  const { t: tPages } = useTranslation('pages')
  const { selectedPortId, selectedPort } = usePortScope()
  const defaultRange = isLive ? getTodayRange() : getMonthRange(0)
  const [dateRange, setDateRange] = useState(defaultRange)
  const [selectedPurposes, setSelectedPurposes] = useState([])
  const [selectedCommodityIds, setSelectedCommodityIds] = useState([])
  const [masterCommodities, setMasterCommodities] = useState([])

  const [plans, setPlans] = useState([])
  const [ops, setOps] = useState([])
  const [atBerth, setAtBerth] = useState([])
  const [jetties, setJetties] = useState([])
  const [arrivalPlans, setArrivalPlans] = useState([])
  const [allOps, setAllOps] = useState([])
  const [berthDetails, setBerthDetails] = useState({})
  const [nowTick, setNowTick] = useState(() => Date.now())
  const [loading, setLoading] = useState(true)
  const [weeklyLoading, setWeeklyLoading] = useState(false)
  const [apiErr, setApiErr] = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [weeklyTrends, setWeeklyTrends] = useState(null)
  const [pipelineActuals, setPipelineActuals] = useState(null)
  const [pipelineActualsLoading, setPipelineActualsLoading] = useState(false)
  const [slotOccupancyData, setSlotOccupancyData] = useState(null)
  const [slotOccupancyLoading, setSlotOccupancyLoading] = useState(false)
  const [slaAtRiskData, setSlaAtRiskData] = useState(null)
  const [slaAtRiskLoading, setSlaAtRiskLoading] = useState(false)
  const [activeModal, setActiveModal] = useState(null)
  const legacyPipelineEnabled = isLegacyVesselPipelineEnabled()

  const { startDate, endDate } = dateRange
  const kpiStartDate = isLive ? fmtLocalDate(new Date()) : startDate
  const kpiEndDate = isLive ? fmtLocalDate(new Date()) : endDate

  useEffect(() => {
    if (!isLive) return undefined
    const syncToday = () => setDateRange(getTodayRange())
    syncToday()
    const id = setInterval(syncToday, 60000)
    return () => clearInterval(id)
  }, [isLive])

  useEffect(() => {
    if (selectedPortId == null) {
      setMasterCommodities([])
      return undefined
    }
    let cancelled = false
    fetchSiLookups()
      .then((data) => {
        if (!cancelled) {
          setMasterCommodities(Array.isArray(data?.commodities) ? data.commodities : [])
        }
      })
      .catch(() => {
        if (!cancelled) setMasterCommodities([])
      })
    return () => { cancelled = true }
  }, [selectedPortId])

  const refresh = useCallback(async (opts = {}) => {
    if (selectedPortId == null) {
      setLoading(false)
      setPlans([])
      setOps([])
      setAtBerth([])
      setJetties([])
      setArrivalPlans([])
      setAllOps([])
      if (isAnalytics) {
        setWeeklyTrends(null)
        setPipelineActuals(null)
      }
      setApiErr(null)
      return
    }

    // silent = background poll: keep current data on screen, no loading flash
    if (!opts.silent) setLoading(true)
    setApiErr(null)
    const errs = []

    const run = async (label, fn) => {
      try { return { ok: true, v: await fn() } } catch (e) {
        errs.push(`${label}: ${e?.message || 'failed'}`)
        return { ok: false, v: null }
      }
    }

    if (isLive) {
      const arrivalsStart = new Date()
      arrivalsStart.setDate(arrivalsStart.getDate() - 1)
      const arrivalsEnd = new Date()
      arrivalsEnd.setDate(arrivalsEnd.getDate() + 3)

      const [rAtBerth, rJetties, rArrivals] = await Promise.all([
        run('at-berth', fetchAtBerth),
        run('jetties', () => fetchJetties(selectedPortId)),
        run('arrivals', () => fetchShipmentPlans({
          startDate: fmtLocalDate(arrivalsStart),
          endDate: fmtLocalDate(arrivalsEnd),
        })),
      ])

      setPlans([])
      setOps([])
      setAllOps([])
      setAtBerth(Array.isArray(rAtBerth.v) ? rAtBerth.v : [])
      setJetties(Array.isArray(rJetties.v) ? rJetties.v : [])
      setArrivalPlans(Array.isArray(rArrivals.v) ? rArrivals.v : [])
    } else {
      // Arrivals window is live (yesterday → +3 days), independent of the selected range
      const arrivalsStart = new Date()
      arrivalsStart.setDate(arrivalsStart.getDate() - 1)
      const arrivalsEnd = new Date()
      arrivalsEnd.setDate(arrivalsEnd.getDate() + 3)

      const [rPlans, rOps, rAtBerth, rJetties, rArrivals, rAllOps] = await Promise.all([
        run('plans', () => fetchShipmentPlans({ startDate, endDate })),
        run('operations', () => fetchOperations({ startDate, endDate })),
        run('at-berth', fetchAtBerth),
        run('jetties', () => fetchJetties(selectedPortId)),
        run('arrivals', () => fetchShipmentPlans({
          startDate: fmtLocalDate(arrivalsStart),
          endDate: fmtLocalDate(arrivalsEnd),
        })),
        run('operations-all', () => fetchOperations()),
      ])

      setPlans(Array.isArray(rPlans.v) ? rPlans.v : [])
      setOps(Array.isArray(rOps.v) ? rOps.v : [])
      setAtBerth(Array.isArray(rAtBerth.v) ? rAtBerth.v : [])
      setJetties(Array.isArray(rJetties.v) ? rJetties.v : [])
      setArrivalPlans(Array.isArray(rArrivals.v) ? rArrivals.v : [])
      setAllOps(Array.isArray(rAllOps.v) ? rAllOps.v : [])
    }
    if (errs.length > 0) setApiErr(errs.join('; '))
    else setApiErr(null)
    setLastUpdated(new Date())
    setLoading(false)
  }, [selectedPortId, startDate, endDate, isLive, isAnalytics])

  const refreshWeekly = useCallback(async () => {
    if (selectedPortId == null) {
      setWeeklyTrends(null)
      return
    }
    setWeeklyLoading(true)
    try {
      const data = await fetchDashboardV2Weekly({
        startDate,
        endDate,
        purposes: selectedPurposes,
        commodityIds: selectedCommodityIds,
      })
      if (data && Array.isArray(data.weeks)) {
        setWeeklyTrends({ weeks: data.weeks, totalSlots: data.totalSlots ?? 0 })
      } else {
        setWeeklyTrends(null)
      }
    } catch (e) {
      setWeeklyTrends(null)
      setApiErr((prev) => {
        const msg = `weekly-trends: ${e?.message || 'failed'}`
        return prev ? `${prev}; ${msg}` : msg
      })
    } finally {
      setWeeklyLoading(false)
    }
  }, [selectedPortId, startDate, endDate, selectedPurposes, selectedCommodityIds])

  const refreshPipelineActuals = useCallback(async () => {
    if (selectedPortId == null) {
      setPipelineActuals(null)
      return
    }
    setPipelineActualsLoading(true)
    try {
      const data = await fetchDashboardV2PipelineActuals({
        startDate,
        endDate,
        purposes: selectedPurposes,
        commodityIds: selectedCommodityIds,
      })
      const toVesselList = (v) => (Array.isArray(v) ? v.map((x) => ({
        vesselName: x?.vesselName ?? null,
        purpose: x?.purpose ?? null,
      })) : [])
      if (data && typeof data === 'object') {
        setPipelineActuals({
          shipmentRequest: Number(data.shipmentRequest) || 0,
          shipmentRequestVessels: toVesselList(data.shipmentRequestVessels),
          incoming: Number(data.incoming) || 0,
          incomingVessels: toVesselList(data.incomingVessels),
          plannedBerthing: Number(data.plannedBerthing) || 0,
          plannedBerthingVessels: toVesselList(data.plannedBerthingVessels),
          atBerth: Number(data.atBerth) || 0,
          atBerthVessels: toVesselList(data.atBerthVessels),
          readyToSail: Number(data.readyToSail) || 0,
          readyToSailVessels: toVesselList(data.readyToSailVessels),
          sailed: Number(data.sailed) || 0,
          sailedVessels: toVesselList(data.sailedVessels),
        })
      } else {
        setPipelineActuals(null)
      }
    } catch (e) {
      setPipelineActuals(null)
      setApiErr((prev) => {
        const msg = `pipeline-actuals: ${e?.message || 'failed'}`
        return prev ? `${prev}; ${msg}` : msg
      })
    } finally {
      setPipelineActualsLoading(false)
    }
  }, [selectedPortId, startDate, endDate, selectedPurposes, selectedCommodityIds])

  const refreshSlotOccupancy = useCallback(async () => {
    if (selectedPortId == null) {
      setSlotOccupancyData(null)
      return
    }
    setSlotOccupancyLoading(true)
    try {
      const data = await fetchDashboardV2SlotOccupancy({
        startDate: kpiStartDate,
        endDate: kpiEndDate,
        purposes: selectedPurposes,
        commodityIds: selectedCommodityIds,
      })
      if (data && typeof data === 'object') {
        setSlotOccupancyData({
          mode: data.mode === 'average' ? 'average' : 'exact',
          usedSlots: Number(data.usedSlots) || 0,
          totalSlots: Number(data.totalSlots) || 0,
          pct: Number(data.pct) || 0,
          dayCount: Number(data.dayCount) || 1,
          overCapacity: Boolean(data.overCapacity),
          items: Array.isArray(data.items) ? data.items : [],
        })
      } else {
        setSlotOccupancyData(null)
      }
    } catch (e) {
      setSlotOccupancyData(null)
      setApiErr((prev) => {
        const msg = `slot-occupancy: ${e?.message || 'failed'}`
        return prev ? `${prev}; ${msg}` : msg
      })
    } finally {
      setSlotOccupancyLoading(false)
    }
  }, [selectedPortId, kpiStartDate, kpiEndDate, selectedPurposes, selectedCommodityIds])

  const refreshSlaAtRisk = useCallback(async () => {
    if (selectedPortId == null) {
      setSlaAtRiskData(null)
      return
    }
    setSlaAtRiskLoading(true)
    try {
      const data = await fetchDashboardV2SlaAtRisk({
        startDate: kpiStartDate,
        endDate: kpiEndDate,
        purposes: selectedPurposes,
        commodityIds: selectedCommodityIds,
      })
      if (data && typeof data === 'object') {
        setSlaAtRiskData({
          mode: data.mode === 'average' ? 'average' : 'exact',
          count: Number(data.count) || 0,
          overHoursSum: Number(data.overHoursSum) || 0,
          dayCount: Number(data.dayCount) || 1,
          items: Array.isArray(data.items) ? data.items : [],
        })
      } else {
        setSlaAtRiskData(null)
      }
    } catch (e) {
      setSlaAtRiskData(null)
      setApiErr((prev) => {
        const msg = `sla-at-risk: ${e?.message || 'failed'}`
        return prev ? `${prev}; ${msg}` : msg
      })
    } finally {
      setSlaAtRiskLoading(false)
    }
  }, [selectedPortId, kpiStartDate, kpiEndDate, selectedPurposes, selectedCommodityIds])

  const closeModal = useCallback(() => setActiveModal(null), [])

  useEffect(() => {
    if (!activeModal) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') setActiveModal(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeModal])

  useEffect(() => { refresh() }, [refresh])
  useEffect(() => { if (isAnalytics) refreshWeekly() }, [refreshWeekly, isAnalytics])
  useEffect(() => { if (isAnalytics) refreshPipelineActuals() }, [refreshPipelineActuals, isAnalytics])
  useEffect(() => { refreshSlotOccupancy() }, [refreshSlotOccupancy])
  useEffect(() => { refreshSlaAtRisk() }, [refreshSlaAtRisk])

  // Background poll: live sections only
  useEffect(() => {
    if (!isLive) return undefined
    const id = setInterval(() => { refresh({ silent: true }) }, 60000)
    return () => clearInterval(id)
  }, [refresh, isLive])

  // Re-render tick for live alongside-hours and relative timestamps
  useEffect(() => {
    if (!isLive) return undefined
    const id = setInterval(() => setNowTick(Date.now()), 30000)
    return () => clearInterval(id)
  }, [isLive])

  // Phase detail for vessels alongside (live mode only)
  useEffect(() => {
    if (!isLive) {
      setBerthDetails({})
      return undefined
    }
    const ids = atBerth.map((o) => o.id).filter((id) => id != null).slice(0, 30)
    if (ids.length === 0) {
      setBerthDetails({})
      return undefined
    }
    let cancelled = false
    Promise.all(
      ids.map(async (id) => {
        const [subs, oa] = await Promise.all([
          fetchSubProcesses(id).catch(() => []),
          fetchOperationalActivities(id).catch(() => ({ entries: [] })),
        ])
        return [id, { subs: Array.isArray(subs) ? subs : [], acts: (oa && oa.entries) || [] }]
      })
    ).then((pairs) => {
      if (!cancelled) setBerthDetails(Object.fromEntries(pairs))
    })
    return () => { cancelled = true }
  }, [atBerth, isLive])

  const commodityOptions = useMemo(
    () => extractCommodityOptionsFromMaster(masterCommodities),
    [masterCommodities]
  )

  useEffect(() => {
    const avail = new Set(commodityOptions.map((o) => o.value))
    setSelectedCommodityIds((prev) => pruneInvalidCommoditySelection(prev, avail))
  }, [commodityOptions])

  const commodityNameById = useMemo(
    () => buildCommodityNameById(masterCommodities),
    [masterCommodities]
  )
  const commodityIdByName = useMemo(
    () => buildCommodityIdByName(masterCommodities),
    [masterCommodities]
  )
  const commodityIndex = useMemo(
    () => buildPlanCommodityIndex(
      isLive ? arrivalPlans : plans,
      isLive ? atBerth : ops,
      commodityIdByName
    ),
    [isLive, arrivalPlans, atBerth, plans, ops, commodityIdByName]
  )

  const filters = useMemo(() => ({
    purposes: selectedPurposes,
    commodityIds: selectedCommodityIds,
    commodityIndex,
    commodityNameById,
  }), [selectedPurposes, selectedCommodityIds, commodityIndex, commodityNameById])

  const indexPlans = isLive ? arrivalPlans : plans

  const filteredPlans = useMemo(() => filterPlans(plans, filters), [plans, filters])
  const filteredOps = useMemo(
    () => filterOps(ops, filters, commodityIndex, plans),
    [ops, filters, commodityIndex, plans]
  )
  const filteredAtBerth = useMemo(
    () => filterOps(atBerth, filters, commodityIndex, indexPlans),
    [atBerth, filters, commodityIndex, indexPlans]
  )

  const hasActiveFilters = selectedPurposes.length > 0 || selectedCommodityIds.length > 0
  const isFilteredEmpty = hasActiveFilters && (
    isLive
      ? filteredAtBerth.length === 0 && filterPlans(arrivalPlans, filters).length === 0
      : filteredPlans.length === 0 && filteredOps.length === 0 && filteredAtBerth.length === 0
  )

  const purposeOptions = useMemo(() => [
    { value: 'Loading', label: t('purposeLoading') },
    { value: 'Unloading', label: t('purposeUnloading') },
  ], [t])

  // ─── Pipeline (7 stages): mutually exclusive non-rejected plans; rejected only in card 1 sub ──
  const pipelineCounts = useMemo(
    () => computePipelinePartition(filteredPlans, filteredOps),
    [filteredPlans, filteredOps]
  )

  const plansForMetrics = useMemo(
    () => filteredPlans.filter((p) => p.approvalStatus !== 'Rejected'),
    [filteredPlans]
  )

  const rejectedPlanIds = useMemo(() => {
    const s = new Set()
    for (const p of filteredPlans) {
      if (p.approvalStatus === 'Rejected') s.add(p.id)
    }
    return s
  }, [filteredPlans])

  // ─── At-berth phase counts (from live at-berth data, refined by sub-process detail) ──
  const atBerthCounts = useMemo(() => {
    const empty = () => AT_BERTH_PHASES.reduce((acc, ph) => { acc[ph] = 0; return acc }, {})
    const counts = { Loading: empty(), Unloading: empty() }
    for (const o of filteredAtBerth) {
      const phase = phaseForCardDetailed(o, berthDetails[o.id])
      if (phase && counts[o.purpose]) counts[o.purpose][phase] += 1
    }
    return counts
  }, [filteredAtBerth, berthDetails])

  const atBerthTotals = useMemo(() => ({
    Loading: AT_BERTH_PHASES.reduce((s, ph) => s + (atBerthCounts.Loading[ph] || 0), 0),
    Unloading: AT_BERTH_PHASES.reduce((s, ph) => s + (atBerthCounts.Unloading[ph] || 0), 0),
  }), [atBerthCounts])

  const filteredAllOps = useMemo(
    () => filterOps(allOps, filters, commodityIndex, plans),
    [allOps, filters, commodityIndex, plans]
  )

  // ─── Live operational stages (same source as At Berth Now / occupancy).
  // The plan-cohort pipeline hid vessels whose ETA fell outside the selected
  // range: with range=today the pipeline said At-Berth 0 while 3 vessels were
  // alongside. Voyages dedupe by shipmentPlanId (multi-SI ops share a plan). ──
  const pipelineLive = useMemo(() => {
    const atBerthKeys = new Set()
    const readyKeys = new Set()
    const signoffReqKeys = new Set()
    for (const o of filteredAtBerth) {
      if (o.shipmentPlanId != null && rejectedPlanIds.has(o.shipmentPlanId)) continue
      const key = o.shipmentPlanId != null ? `p${o.shipmentPlanId}` : `o${o.id}`
      if (o.status === 'SIGNOFF_APPROVED') {
        readyKeys.add(key)
      } else if (['DOCKED', 'IN_PROGRESS', 'POST_OPS', 'SIGNOFF_REQUESTED'].includes(o.status)) {
        atBerthKeys.add(key)
        if (o.status === 'SIGNOFF_REQUESTED') signoffReqKeys.add(key)
      }
    }
    return {
      atBerth: atBerthKeys.size,
      readyToSail: readyKeys.size,
      signoffRequested: signoffReqKeys.size,
    }
  }, [filteredAtBerth, rejectedPlanIds])

  // ─── Sailed within the selected range, bucketed by cast-off date (from the
  // unwindowed ops list — the ETA-window list misses late departures) ────────
  const sailedInRange = useMemo(() => {
    const s = parseDateLocal(startDate)
    const e = parseDateLocal(endDate)
    const empty = { count: 0, qty: { Loading: 0, Unloading: 0 }, rows: { Loading: [], Unloading: [] } }
    if (!s || !e) return empty
    const startMs = s.getTime()
    const endMs = e.getTime() + 86400000
    const seenVoyages = new Set()
    let count = 0
    const qty = { Loading: 0, Unloading: 0 }
    const rows = { Loading: [], Unloading: [] }
    for (const o of filteredAllOps) {
      if (o.status !== 'SAILED') continue
      if (o.shipmentPlanId != null && rejectedPlanIds.has(o.shipmentPlanId)) continue
      const off = parseIso(o.castOffAt) || parseIso(o.actualCompletionTime) || parseIso(o.sailedAt)
      if (!off) continue
      const tMs = off.getTime()
      if (tMs < startMs || tMs >= endMs) continue
      const key = o.shipmentPlanId != null ? `p${o.shipmentPlanId}` : `o${o.id}`
      if (!seenVoyages.has(key)) {
        seenVoyages.add(key)
        count += 1
      }
      const k = o.purpose === 'Loading' ? 'Loading' : o.purpose === 'Unloading' ? 'Unloading' : null
      const q = Number(o.cargoSiQty)
      if (k && Number.isFinite(q) && q > 0) {
        qty[k] += q
        rows[k].push({ vesselName: o.vesselName || `Op #${o.id}`, qty: q })
      }
    }
    return { count, qty, rows }
  }, [filteredAllOps, rejectedPlanIds, startDate, endDate])

  // Bottom clearance row — live/range figures matching the pipeline stages
  const opStats = useMemo(() => ({
    atBerth: pipelineLive.atBerth,
    signoffApproved: pipelineLive.readyToSail,
    signoffRequested: pipelineLive.signoffRequested,
    sailed: sailedInRange.count,
  }), [pipelineLive, sailedInRange.count])

  const slotOccupancyIsTodayOnly = isLive || isTodayOnlyRange(kpiStartDate, kpiEndDate)
  const slotOccupancyIsRange = !isLive && kpiStartDate !== kpiEndDate
  const slaAtRiskIsTodayOnly = slotOccupancyIsTodayOnly
  const slaAtRiskIsRange = slotOccupancyIsRange

  // ─── Jetty status ─────────────────────────────────────────────────────────
  const jettyStatusCounts = useMemo(() => {
    const m = { Available: 0, 'Out of Service': 0 }
    for (const j of jetties) {
      const s = j.status || 'Available'
      if (s === 'Out of Service') m['Out of Service'] += 1
      else m.Available += 1
    }
    return m
  }, [jetties])

  const jettyStatusLists = useMemo(() => {
    const avail = [], oos = []
    for (const j of jetties) {
      const name = (j?.name || '').trim()
      const label = name.replace(/^Jetty\s+/i, '').trim() || name || '—'
      if ((j?.status || '') === 'Out of Service') oos.push(label)
      else avail.push(label)
    }
    avail.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    oos.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    return { avail, oos }
  }, [jetties])

  // ─── Performance (from plans + ops, both filtered by date range) ──────────
  const performance = useMemo(() => {
    const tolMs = 6 * 3600000
    const waitingHrs = [], waitingWorst = []
    const turnaroundHrs = [], turnaroundWorst = []
    let onTimeEligible = 0, onTimeCount = 0
    const onTimeLateList = []

    // Waiting (TA → TB) and on-time berthing from plans (excl. rejected)
    for (const p of plansForMetrics) {
      const vesselName = (p?.vesselName || '').trim() || `Plan #${p?.id}`
      const jettyName = (p?.jettyName || '').trim() || '—'
      const ta = parseIso(p?.ta)
      const tb = parseIso(p?.tb)
      const etb = parseIso(p?.etb)

      if (ta && tb && tb.getTime() > ta.getTime()) {
        const h = (tb.getTime() - ta.getTime()) / 3600000
        waitingHrs.push(h)
        waitingWorst.push({ vesselName, jettyName, hours: h })
      }
      if (etb && tb) {
        onTimeEligible += 1
        const lateMs = tb.getTime() - (etb.getTime() + tolMs)
        if (lateMs <= 0) onTimeCount += 1
        else onTimeLateList.push({ vesselName, jettyName, lateHours: lateMs / 3600000 })
      }
    }

    // Turnaround (TB → cast-off) from ops (excl. rejected plans).
    // Dedupe by vessel + TB: a voyage with multiple SIs produces one op row per
    // SI sharing the same berth stay — counting each would skew the median.
    const seenTurnaround = new Set()
    for (const o of filteredOps) {
      if (o?.shiftingOut) continue
      if (o.shipmentPlanId != null && rejectedPlanIds.has(o.shipmentPlanId)) continue
      const vesselName = (o?.vesselName || '').trim() || `Op #${o?.id}`
      const jettyName = (o?.jettyName || '').trim() || '—'
      const tb = parseIso(o?.tbAt || o?.dockingStartTime)
      const end = parseIso(o?.castOffAt) || parseIso(o?.actualCompletionTime)
      if (tb && end && end.getTime() > tb.getTime()) {
        const dedupeKey = `${vesselName.toLowerCase()}|${tb.getTime()}`
        if (seenTurnaround.has(dedupeKey)) continue
        seenTurnaround.add(dedupeKey)
        const h = (end.getTime() - tb.getTime()) / 3600000
        turnaroundHrs.push(h)
        turnaroundWorst.push({ vesselName, jettyName, hours: h })
      }
    }

    waitingWorst.sort((a, b) => b.hours - a.hours)
    turnaroundWorst.sort((a, b) => b.hours - a.hours)
    onTimeLateList.sort((a, b) => b.lateHours - a.lateHours)

    return {
      waiting: { medianHours: median(waitingHrs), sampleSize: waitingHrs.length, worst: waitingWorst.slice(0, 10) },
      turnaround: { medianHours: median(turnaroundHrs), sampleSize: turnaroundHrs.length, worst: turnaroundWorst.slice(0, 10) },
      onTime: { ratePct: onTimeEligible >= 1 ? Math.round((onTimeCount / Math.max(1, onTimeEligible)) * 100) : null, eligible: onTimeEligible, onTime: onTimeCount, late: onTimeLateList.slice(0, 10) },
    }
  }, [plansForMetrics, filteredOps, rejectedPlanIds])

  // ─── Berth board (live): one row per operation alongside ──────────────────
  const berthBoard = useMemo(() => {
    const rows = filteredAtBerth.map((o) => {
      const tb = parseIso(o.tbAt || o.dockingStartTime)
      const etc = parseIso(o.estimatedCompletionTime)
      const opsFinished =
        ['SIGNOFF_REQUESTED', 'SIGNOFF_APPROVED'].includes(o.status) || !!o.operationsCompletedAt
      let etcState = 'none'
      let etcDeltaH = null
      if (etc) {
        etcDeltaH = (etc.getTime() - nowTick) / 3600000
        etcState = opsFinished ? 'done' : etcDeltaH < 0 ? 'over' : etcDeltaH < 12 ? 'soon' : 'ok'
      }
      return {
        id: o.id,
        vesselName: o.vesselName || `Op #${o.id}`,
        code: o.jettyOperationCode,
        jettyName: o.jettyName || '—',
        purpose: o.purpose,
        status: o.status,
        phase: phaseForCardDetailed(o, berthDetails[o.id]),
        alongsideHours: tb ? (nowTick - tb.getTime()) / 3600000 : null,
        etcState,
        etcDeltaH,
        norAccepted: !!o.norAcceptedAt,
        signoffPending: o.status === 'SIGNOFF_REQUESTED',
        readyToSail: o.status === 'SIGNOFF_APPROVED',
      }
    })
    rows.sort((a, b) => (b.alongsideHours ?? 0) - (a.alongsideHours ?? 0))
    return rows
  }, [filteredAtBerth, berthDetails, nowTick])

  // ─── Ops finished but not cast off (live clearance-lag alert) ──────────────
  const awaitingDeparture = useMemo(() => {
    const seen = new Set()
    const rows = []
    for (const o of filteredAtBerth) {
      if (o.castOffAt) continue
      const done = parseIso(o.operationsCompletedAt)
      const isDone = ['SIGNOFF_REQUESTED', 'SIGNOFF_APPROVED'].includes(o.status) || !!done
      if (!isDone) continue
      const key = `${(o.vesselName || '').trim().toLowerCase()}|${o.tbAt || o.dockingStartTime || o.id}`
      if (seen.has(key)) continue
      seen.add(key)
      rows.push({ ...o, sinceHours: done ? (nowTick - done.getTime()) / 3600000 : null })
    }
    rows.sort((a, b) => (b.sinceHours ?? 0) - (a.sinceHours ?? 0))
    return rows
  }, [filteredAtBerth, nowTick])

  // ─── Arriving soon (live window: overdue ≤24h + next 72h, not alongside) ──
  const arrivals = useMemo(() => {
    const rows = []
    for (const p of filterPlans(arrivalPlans, filters)) {
      if (p.approvalStatus === 'Rejected') continue
      if (parseIso(p.tb) || parseIso(p.sailedAt)) continue
      const etb = parseIso(p.etb)
      const eta = parseIso(p.eta)
      const when = etb || eta
      if (!when) continue
      const tMs = when.getTime()
      if (tMs > nowTick + 72 * 3600000 || tMs < nowTick - 24 * 3600000) continue
      const names = new Set()
      for (const si of p.shippingInstructions || []) {
        for (const line of si.breakdown || []) {
          if (line?.commodityName) names.add(line.commodityName)
        }
      }
      rows.push({
        id: p.id,
        vesselName: p.vesselName || `Plan #${p.id}`,
        jettyName: p.jettyName,
        purpose: p.purposeCode,
        whenIso: etb ? p.etb : p.eta,
        whenKind: etb ? 'ETB' : 'ETA',
        inHours: (tMs - nowTick) / 3600000,
        overdue: tMs < nowTick,
        anchored: !!parseIso(p.ta),
        qtyMt: Number.isFinite(Number(p.vesselCapacity)) && Number(p.vesselCapacity) > 0
          ? Number(p.vesselCapacity)
          : null,
        commodity: [...names].join(' · ') || '—',
        approvalStatus: p.approvalStatus,
        agentName: p.agentName,
      })
    }
    rows.sort((a, b) => a.inHours - b.inHours)
    return rows
  }, [arrivalPlans, filters, nowTick])

  // ─── Tonnage in the selected range: planned (plans, ETA window) vs sailed
  // (cast-off within range — shares sailedInRange so it matches the pipeline) ──
  const tonnage = useMemo(() => {
    const out = {
      Loading: { planned: 0, sailed: sailedInRange.qty.Loading, plannedRows: [], sailedRows: sailedInRange.rows.Loading },
      Unloading: { planned: 0, sailed: sailedInRange.qty.Unloading, plannedRows: [], sailedRows: sailedInRange.rows.Unloading },
    }
    for (const p of plansForMetrics) {
      const key = p.purposeCode === 'Loading' ? 'Loading' : p.purposeCode === 'Unloading' ? 'Unloading' : null
      const mt = Number(p.vesselCapacity)
      if (key && Number.isFinite(mt) && mt > 0) {
        out[key].planned += mt
        out[key].plannedRows.push({ vesselName: p.vesselName || `Plan #${p.id}`, qty: mt })
      }
    }
    return out
  }, [plansForMetrics, sailedInRange])

  const kpiNoData = hasActiveFilters ? t('v2FilterNoData') : '—'

  const phaseShortLabel = useMemo(() => ({
    'Pre-Checking': t('phasePre'),
    Operational: t('phaseOps'),
    'Post-Checking': t('phasePost'),
  }), [t])

  const purposesUi = useMemo(() => [
    { key: 'Loading', label: t('purposeLoading') },
    { key: 'Unloading', label: t('purposeUnloading') },
  ], [t])

  const dateRangeLabel = useMemo(
    () => formatDateRangeLabel(startDate, endDate),
    [startDate, endDate]
  )

  // ─── Render ───────────────────────────────────────────────────────────────
  if (selectedPortId == null) {
    return (
      <div className="dashboard v2-dashboard">
        <header className="v2-header">
          <div className="v2-header__title-row">
            <h1 className="page-title">{tPages(titleKey)}</h1>
          </div>
        </header>
        <div className="card dashboard-empty-state">
          <p className="text-steel">{tPages('dashboardSelectPortHint')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="dashboard v2-dashboard">
      {/* ── Header ── */}
      <header className="v2-header">
        <div className="v2-header__title-row">
          <div className="v2-header__left">
            <h1 className="page-title">{tPages(titleKey)}</h1>
            {selectedPort && (
              <div className="dashboard-port-chip" role="status">
                <span className="dashboard-port-chip__dot" aria-hidden />
                <span className="dashboard-port-chip__label">{t('portWord')}</span>
                <span className="dashboard-port-chip__name">{selectedPort.name}</span>
                <span className="dashboard-port-chip__meta"> {t('jettyCount', { count: jetties.length })}</span>
              </div>
            )}
          </div>
          <span className="dashboard-header__meta">
            {isLive && lastUpdated && (
              <>
                {t('lastUpdated')} {formatDateTimeDisplay(lastUpdated.toISOString())}
                {' · '}{formatRelativeTime(lastUpdated.toISOString(), t)}
              </>
            )}
          </span>
        </div>

        <div className="v2-filters">
          <DropdownMultiSelect
            id="dashboard-filter-purpose"
            className="v2-filters__dropdown"
            titleLabel={t('v2FilterPurpose')}
            placeholder={t('v2FilterSelectPurpose')}
            options={purposeOptions}
            selectedValues={selectedPurposes}
            onChange={setSelectedPurposes}
            panelClassName="v2-filters__panel"
          />
          <DropdownMultiSelect
            id="dashboard-filter-commodity"
            className="v2-filters__dropdown"
            titleLabel={t('v2FilterCommodityType')}
            placeholder={t('v2FilterSelectCommodity')}
            options={commodityOptions}
            selectedValues={selectedCommodityIds}
            onChange={setSelectedCommodityIds}
            panelClassName="v2-filters__panel"
            emptyText={t('v2FilterNoCommodities')}
            disabled={loading}
          />
          {isAnalytics && (
            <DateRangePicker
              startDate={startDate}
              endDate={endDate}
              onChange={setDateRange}
              t={t}
            />
          )}
        </div>
      </header>

      {isFilteredEmpty && (
        <div className="v2-filter-empty-banner" role="status">
          {t('v2FilterNoData')}
        </div>
      )}

      {apiErr && (
        <div className="dashboard-api-banner" role="alert">
          {t('apiLoadPartial')} {apiErr}
        </div>
      )}

      {/* ── Pipeline Actuals (analytics) ── */}
      {isAnalytics && (
      <section className="card v2-pipeline v2-pipeline--actuals">
          <div className="v2-pipeline__header">
            <h2 className="card__title">
              {t('v2PipelineActualsTitle')}
            </h2>
            <div className="v2-pipeline__header-right">
              {pipelineActualsLoading && (
                <span className="v2-pipeline__refreshing">{t('loadingEllipsis')}</span>
              )}
              <span className="v2-pipeline__period">{dateRangeLabel}</span>
            </div>
          </div>
          <div
            id="v2-pipeline-actuals-body"
            className={`v2-pipeline__flow${pipelineActualsLoading ? ' v2-pipeline__flow--loading' : ''}`}
            role="navigation"
            aria-label={t('v2PipelineActualsTitle')}
          >
              <InteractiveTooltip
                title={t('v2PipelineRequest')}
                subtitle={`${dateRangeLabel} · n=${pipelineActuals?.shipmentRequest ?? 0}`}
                items={(pipelineActuals?.shipmentRequestVessels ?? []).map((v) => ({
                  primary: v.vesselName || '—',
                  secondary: v.purpose || '—',
                }))}
                emptyText={t('v2PipelineActualsTooltipEmpty')}
                placement="right"
                interactiveChild
              >
                <Link to="/shipment-plans" className="v2-pipeline__stage v2-pipeline__stage--request">
                  <div className="v2-pipeline__stage-icon">📝</div>
                  <div className="v2-pipeline__stage-body">
                    <div className="v2-pipeline__stage-label">{t('v2PipelineRequest')}</div>
                    <div className="v2-pipeline__stage-count">{pipelineActuals?.shipmentRequest ?? (pipelineActualsLoading ? '—' : 0)}</div>
                    <div className="v2-pipeline__stage-sub">{t('v2PipelineActualsRequestSub')}</div>
                  </div>
                </Link>
              </InteractiveTooltip>

              <span className="v2-pipeline__arrow" aria-hidden>›</span>

              <InteractiveTooltip
                title={t('v2PipelineIncoming')}
                subtitle={`${dateRangeLabel} · n=${pipelineActuals?.incoming ?? 0}`}
                items={(pipelineActuals?.incomingVessels ?? []).map((v) => ({
                  primary: v.vesselName || '—',
                  secondary: v.purpose || '—',
                }))}
                emptyText={t('v2PipelineActualsTooltipEmpty')}
                placement="right"
                interactiveChild
              >
                <Link to="/allocation-plans" className="v2-pipeline__stage v2-pipeline__stage--incoming">
                  <div className="v2-pipeline__stage-icon">🛳️</div>
                  <div className="v2-pipeline__stage-body">
                    <div className="v2-pipeline__stage-label">{t('v2PipelineIncoming')}</div>
                    <div className="v2-pipeline__stage-count">{pipelineActuals?.incoming ?? (pipelineActualsLoading ? '—' : 0)}</div>
                    <div className="v2-pipeline__stage-sub">{t('v2PipelineActualsIncomingSub')}</div>
                  </div>
                </Link>
              </InteractiveTooltip>

              <span className="v2-pipeline__arrow" aria-hidden>›</span>

              <InteractiveTooltip
                title={t('pipelineAtBerth')}
                subtitle={`${dateRangeLabel} · n=${pipelineActuals?.atBerth ?? 0}`}
                items={(pipelineActuals?.atBerthVessels ?? []).map((v) => ({
                  primary: v.vesselName || '—',
                  secondary: v.purpose || '—',
                }))}
                emptyText={t('v2PipelineActualsTooltipEmpty')}
                placement="right"
                interactiveChild
              >
                <Link to="/at-berth" className="v2-pipeline__stage v2-pipeline__stage--atberth">
                  <div className="v2-pipeline__stage-icon">🚢</div>
                  <div className="v2-pipeline__stage-body">
                    <div className="v2-pipeline__stage-label">{t('pipelineAtBerth')}</div>
                    <div className="v2-pipeline__stage-count">{pipelineActuals?.atBerth ?? (pipelineActualsLoading ? '—' : 0)}</div>
                    <div className="v2-pipeline__stage-sub">{t('v2PipelineActualsAtBerthSub')}</div>
                  </div>
                </Link>
              </InteractiveTooltip>

              <span className="v2-pipeline__arrow" aria-hidden>›</span>

              <InteractiveTooltip
                title={t('v2PipelineReadyToSail')}
                subtitle={`${dateRangeLabel} · n=${pipelineActuals?.readyToSail ?? 0}`}
                items={(pipelineActuals?.readyToSailVessels ?? []).map((v) => ({
                  primary: v.vesselName || '—',
                  secondary: v.purpose || '—',
                }))}
                emptyText={t('v2PipelineActualsTooltipEmpty')}
                placement="right"
                interactiveChild
              >
                <Link to="/verification" className="v2-pipeline__stage v2-pipeline__stage--readytosail">
                  <div className="v2-pipeline__stage-icon">✅</div>
                  <div className="v2-pipeline__stage-body">
                    <div className="v2-pipeline__stage-label">{t('v2PipelineReadyToSail')}</div>
                    <div className="v2-pipeline__stage-count">{pipelineActuals?.readyToSail ?? (pipelineActualsLoading ? '—' : 0)}</div>
                    <div className="v2-pipeline__stage-sub">{t('v2PipelineActualsReadySub')}</div>
                  </div>
                </Link>
              </InteractiveTooltip>

              <span className="v2-pipeline__arrow" aria-hidden>›</span>

              <InteractiveTooltip
                title={t('v2PipelineSailed')}
                subtitle={`${dateRangeLabel} · n=${pipelineActuals?.sailed ?? 0}`}
                items={(pipelineActuals?.sailedVessels ?? []).map((v) => ({
                  primary: v.vesselName || '—',
                  secondary: v.purpose || '—',
                }))}
                emptyText={t('v2PipelineActualsTooltipEmpty')}
                placement="right"
                interactiveChild
              >
                <Link to="/verification" className="v2-pipeline__stage v2-pipeline__stage--sailed">
                  <div className="v2-pipeline__stage-icon">🚀</div>
                  <div className="v2-pipeline__stage-body">
                    <div className="v2-pipeline__stage-label">{t('v2PipelineSailed')}</div>
                    <div className="v2-pipeline__stage-count">{pipelineActuals?.sailed ?? (pipelineActualsLoading ? '—' : 0)}</div>
                    <div className="v2-pipeline__stage-sub">{t('v2PipelineActualsSailedSub')}</div>
                  </div>
                </Link>
              </InteractiveTooltip>
          </div>
        </section>
      )}

      {isAnalytics && legacyPipelineEnabled && (
      <section className="card v2-pipeline">
        <div className="v2-pipeline__header">
          <h2 className="card__title">{t('vesselPipeline')}</h2>
          <div className="v2-pipeline__header-right">
            {loading && <span className="v2-pipeline__refreshing">{t('loadingEllipsis')}</span>}
            <span className="v2-pipeline__period">{dateRangeLabel}</span>
          </div>
        </div>
        <div className={`v2-pipeline__flow${loading ? ' v2-pipeline__flow--loading' : ''}`} role="navigation" aria-label={t('vesselPipeline')}>
          {/*
            Stage 1: planPipelineTotal (non-rejected in ETA window) — unchanged.
            Stage 2: Draft/Submitted pending approval (jettyId ignored).
            Stage 3: Approved, no jetty, not alongside.
            Stage 4: Approved + jetty assigned only (not Draft/Submitted).
            Stages 5–7: ops by shipmentPlanId; plan.tb / plan.sailedAt fallbacks (dashboardPipelinePartition).
          */}

          {/* Total card: the whole plan cohort in range — NOT a flow stage.
              Rendered outside the arrow chain so the flow visibly starts at
              Shipment Request. */}
          <Link to="/shipment-plans" className="v2-pipeline__stage v2-pipeline__stage--plans v2-pipeline__stage--total">
            <div className="v2-pipeline__stage-icon">📋</div>
            <div className="v2-pipeline__stage-body">
              <div className="v2-pipeline__stage-label">
                {t('v2PipelinePlans')} <span className="v2-basis-chip v2-basis-chip--range">{t('v2PipelineTotalChip')}</span>
              </div>
              <div className="v2-pipeline__stage-count">{pipelineCounts.planPipelineTotal}</div>
              <div className="v2-pipeline__stage-sub">
                {t('v2PipelinePlansSub', {
                  approved: pipelineCounts.approvedPlans,
                  rejected: pipelineCounts.rejectedPlans,
                  total: pipelineCounts.planCountTotal,
                })}
              </div>
            </div>
          </Link>

          <span className="v2-pipeline__divider" aria-hidden />

          {/* Stage 1 of the flow: Shipment Request (Draft/Submitted pending approval, not berthed) */}
          <Link to="/shipment-plans" className="v2-pipeline__stage v2-pipeline__stage--request">
            <div className="v2-pipeline__stage-icon">📝</div>
            <div className="v2-pipeline__stage-body">
              <div className="v2-pipeline__stage-label">{t('v2PipelineRequest')}</div>
              <div className="v2-pipeline__stage-count">{pipelineCounts.shipmentRequest}</div>
              <div className="v2-pipeline__stage-sub">{t('v2PipelineRequestSub')}</div>
            </div>
          </Link>

          <span className="v2-pipeline__arrow" aria-hidden>›</span>

          {/* Stage 3: Incoming (approved, no jetty, not berthed) */}
          <Link to="/allocation-plans" className="v2-pipeline__stage v2-pipeline__stage--incoming">
            <div className="v2-pipeline__stage-icon">🛳️</div>
            <div className="v2-pipeline__stage-body">
              <div className="v2-pipeline__stage-label">{t('v2PipelineIncoming')}</div>
              <div className="v2-pipeline__stage-count">{pipelineCounts.incoming}</div>
              <div className="v2-pipeline__stage-sub">{t('v2PipelineIncomingSub')}</div>
            </div>
          </Link>

          <span className="v2-pipeline__arrow" aria-hidden>›</span>

          {/* Stage 4: Planned Berthing (Approved + jetty assigned, not berthed) */}
          <Link to="/allocation-plans" className="v2-pipeline__stage v2-pipeline__stage--planned">
            <div className="v2-pipeline__stage-icon">⚓</div>
            <div className="v2-pipeline__stage-body">
              <div className="v2-pipeline__stage-label">{t('pipelinePlannedBerthing')}</div>
              <div className="v2-pipeline__stage-count">{pipelineCounts.plannedBerthing}</div>
              <div className="v2-pipeline__stage-sub">{t('pipelinePlannedSub')}</div>
            </div>
          </Link>

          <span className="v2-pipeline__arrow" aria-hidden>›</span>

          {/* Stage 5: At Berth (docked / in-progress / post-ops / signoff requested) */}
          <Link to="/at-berth" className="v2-pipeline__stage v2-pipeline__stage--atberth">
            <div className="v2-pipeline__stage-icon">🚢</div>
            <div className="v2-pipeline__stage-body">
              <div className="v2-pipeline__stage-label">{t('pipelineAtBerth')}</div>
              <div className="v2-pipeline__stage-count">{pipelineCounts.atBerthCount}</div>
              <div className="v2-pipeline__stage-sub">{t('pipelineAtBerthSub')}</div>
            </div>
          </Link>

          <span className="v2-pipeline__arrow" aria-hidden>›</span>

          {/* Stage 6: Ready to Sail (sign-off approved, awaiting departure) */}
          <Link to="/verification" className="v2-pipeline__stage v2-pipeline__stage--readytosail">
            <div className="v2-pipeline__stage-icon">✅</div>
            <div className="v2-pipeline__stage-body">
              <div className="v2-pipeline__stage-label">{t('v2PipelineReadyToSail')}</div>
              <div className="v2-pipeline__stage-count">{pipelineCounts.readyToSail}</div>
              <div className="v2-pipeline__stage-sub">{t('v2PipelineReadyToSailSub')}</div>
            </div>
          </Link>

          <span className="v2-pipeline__arrow" aria-hidden>›</span>

          {/* Stage 7: Sailed — plan partition (ETA window), so stages 2-7 sum to the total */}
          <Link to="/verification" className="v2-pipeline__stage v2-pipeline__stage--sailed">
            <div className="v2-pipeline__stage-icon">🚀</div>
            <div className="v2-pipeline__stage-body">
              <div className="v2-pipeline__stage-label">{t('v2PipelineSailed')}</div>
              <div className="v2-pipeline__stage-count">{pipelineCounts.sailed}</div>
              <div className="v2-pipeline__stage-sub">{t('v2PipelineSailedSub')}</div>
            </div>
          </Link>

        </div>
        {(pipelineCounts.unclassified > 0 || pipelineCounts.orphanPipelineOps > 0) && (
          <div className="v2-pipeline__hints" role="status">
            {pipelineCounts.unclassified > 0 && (
              <p className="v2-pipeline__hint">{t('v2PipelineUnclassified', { n: pipelineCounts.unclassified })}</p>
            )}
            {pipelineCounts.orphanPipelineOps > 0 && (
              <p className="v2-pipeline__hint">{t('v2PipelineOrphanOps', { n: pipelineCounts.orphanPipelineOps })}</p>
            )}
          </div>
        )}
      </section>
      )}

      {/* ── KPI Row: Occupancy + Performance metrics + SLA (+ live ops status) ── */}
      <div className="v2-kpi-row v2-kpi-row--4" aria-label={t('kpiGridAria')}>
        {/* Slot Occupancy */}
        <div className="v2-kpi-card">
          <div className="v2-kpi-card__label">
            {t('slotOccupancy')}{' '}
            {slotOccupancyIsTodayOnly ? (
              <span className="v2-basis-chip">{t('v2BasisToday')}</span>
            ) : slotOccupancyIsRange ? (
              <span className="v2-basis-chip v2-basis-chip--range">
                {t('v2BasisAvg', { n: slotOccupancyData?.dayCount ?? 0 })}
              </span>
            ) : (
              <span className="v2-basis-chip v2-basis-chip--range">{formatDateDisplay(startDate)}</span>
            )}
          </div>
          <div className="v2-kpi-card__value">
            {slotOccupancyLoading
              ? '—'
              : hasActiveFilters && slotOccupancyData?.usedSlots === 0 && slotOccupancyData?.totalSlots > 0
                ? kpiNoData
                : slotOccupancyData && slotOccupancyData.totalSlots > 0
                  ? (
                    <>
                      {slotOccupancyData.usedSlots}/{slotOccupancyData.totalSlots}{' '}
                      <span className="v2-kpi-card__unit">{slotOccupancyData.pct}%</span>
                    </>
                  )
                  : '—'}
          </div>
          <div className="v2-kpi-card__bar-wrap">
            <div
              className={`v2-kpi-card__bar${slotOccupancyData?.overCapacity ? ' v2-kpi-card__bar--over' : ''}`}
              style={{
                width: slotOccupancyData?.totalSlots > 0
                  ? `${Math.min(100, slotOccupancyData.pct)}%`
                  : '0%',
              }}
            />
          </div>
          <div className="v2-kpi-card__sub">
            {slotOccupancyIsRange
              ? t('slotOccupancyHintAvg', { n: slotOccupancyData?.dayCount ?? 0 })
              : slotOccupancyIsTodayOnly
                ? t('slotOccupancyHint')
                : t('slotOccupancyHintEod')}{' '}
            {(slotOccupancyData?.items?.length ?? 0) > 0 && (
              <button
                type="button"
                className="v2-kpi-card__detail-link v2-kpi-card__detail-link--clickable"
                onClick={() => setActiveModal({
                  title: t('slotTooltipTitle'),
                  subtitle: slotOccupancyData.mode === 'exact'
                    ? t('slotTooltipSubtitle')
                    : t('slotOccupancyHintAvg', { n: slotOccupancyData.dayCount ?? 0 }),
                  columns: slotOccupancyData.mode === 'exact'
                    ? [{ label: 'Occupant', cell: (r) => r.primary }]
                    : [
                      { label: 'Date', cell: (r) => r.primary },
                      { label: 'Occupancy', cell: (r) => r.secondary },
                    ],
                  rows: slotOccupancyData.items ?? [],
                  emptyText: t('slotEmpty'),
                })}
              >
                {t('slotDetails')}
              </button>
            )}
          </div>
          <Link to="/at-berth" className="v2-kpi-card__link">{t('viewAtBerth')}</Link>
        </div>

        {isAnalytics && (
        <>
        {/* Waiting to Berth */}
        <div className="v2-kpi-card">
          <div className="v2-kpi-card__label">{t('perfWaiting')}</div>
          <button
            type="button"
            className="v2-kpi-card__value v2-kpi-card__value--clickable"
            onClick={() => setActiveModal({
              title: t('perfWaitingTooltip'),
              subtitle: `${dateRangeLabel} · n=${performance.waiting.sampleSize}`,
              columns: [
                { label: 'Vessel', cell: (r) => r.primary },
                { label: 'Detail', cell: (r) => r.secondary },
              ],
              rows: performance.waiting.worst.map((x) => ({
                primary: `${x.vesselName} — ${x.jettyName}`,
                secondary: `Wait: ${formatDurationHours(x.hours)}`,
              })),
              emptyText: t('perfWaitingEmpty'),
            })}
          >
            {loading
              ? '—'
              : hasActiveFilters && performance.waiting.sampleSize === 0
                ? kpiNoData
                : performance.waiting.medianHours == null
                  ? '—'
                  : formatDurationHours(performance.waiting.medianHours)}
          </button>
          <div className="v2-kpi-card__sub">{t('v2PerfWaitingSub', { n: performance.waiting.sampleSize })}</div>
        </div>

        {/* Turnaround */}
        <div className="v2-kpi-card">
          <div className="v2-kpi-card__label">{t('perfTurnaround')}</div>
          <button
            type="button"
            className="v2-kpi-card__value v2-kpi-card__value--clickable"
            onClick={() => setActiveModal({
              title: t('perfTurnaroundTooltip'),
              subtitle: `${dateRangeLabel} · n=${performance.turnaround.sampleSize}`,
              columns: [
                { label: 'Vessel', cell: (r) => r.primary },
                { label: 'Detail', cell: (r) => r.secondary },
              ],
              rows: performance.turnaround.worst.map((x) => ({
                primary: `${x.vesselName} — ${x.jettyName}`,
                secondary: `Turnaround: ${formatDurationHours(x.hours)}`,
              })),
              emptyText: t('perfTurnaroundEmpty'),
            })}
          >
            {loading
              ? '—'
              : hasActiveFilters && performance.turnaround.sampleSize === 0
                ? kpiNoData
                : performance.turnaround.medianHours == null
                  ? '—'
                  : formatDurationHours(performance.turnaround.medianHours)}
          </button>
          <div className="v2-kpi-card__sub">{t('v2PerfTurnaroundSub', { n: performance.turnaround.sampleSize })}</div>
        </div>
        </>
        )}

        {/* SLA at Risk */}
        <div className={`v2-kpi-card${slaAtRiskData && slaAtRiskData.count > 0 ? ' v2-kpi-card--accent-red' : ''}`}>
          <div className="v2-kpi-card__label">
            {t('slaAtRisk')}{' '}
            {slaAtRiskIsTodayOnly ? (
              <span className="v2-basis-chip">{t('v2BasisToday')}</span>
            ) : slaAtRiskIsRange ? (
              <span className="v2-basis-chip v2-basis-chip--range">
                {t('v2BasisAvg', { n: slaAtRiskData?.dayCount ?? 0 })}
              </span>
            ) : (
              <span className="v2-basis-chip v2-basis-chip--range">{formatDateDisplay(startDate)}</span>
            )}
          </div>
          {(slaAtRiskData?.items?.length ?? 0) > 0 ? (
            <button
              type="button"
              className="v2-kpi-card__value v2-kpi-card__value--clickable"
              onClick={() => setActiveModal({
                title: t('slaTooltipTitle'),
                subtitle: slaAtRiskData.mode === 'exact'
                  ? t('slaTooltipSubtitle')
                  : t('slaSubAvg', { n: slaAtRiskData.dayCount ?? 0, h: slaAtRiskData.overHoursSum ?? 0 }),
                columns: slaAtRiskData.mode === 'exact'
                  ? [
                    { label: 'Vessel', cell: (r) => r.primary },
                    { label: 'Detail', cell: (r) => r.secondary },
                  ]
                  : [
                    { label: 'Date', cell: (r) => r.primary },
                    { label: 'At risk', cell: (r) => r.secondary },
                  ],
                rows: slaAtRiskData.items ?? [],
                emptyText: t('slaEmpty'),
              })}
            >
              {slaAtRiskLoading
                ? '—'
                : slaAtRiskData != null
                  ? formatSlaCount(slaAtRiskData.count)
                  : '—'}
            </button>
          ) : (
            <div className="v2-kpi-card__value">
              {slaAtRiskLoading
                ? '—'
                : slaAtRiskData != null
                  ? formatSlaCount(slaAtRiskData.count)
                  : '—'}
            </div>
          )}
          <div className="v2-kpi-card__sub">
            {slaAtRiskIsRange
              ? t('slaSubAvg', {
                n: slaAtRiskData?.dayCount ?? 0,
                h: slaAtRiskData?.overHoursSum ?? 0,
              })
              : slaAtRiskIsTodayOnly
                ? t('slaSub')
                : t('slaSubEod')}
          </div>
        </div>

        {isLive && (
        <>
        {/* Jetty Status */}
        <div className="v2-kpi-card">
          <div className="v2-kpi-card__label">{t('jettyStatus')} <span className="v2-basis-chip">{t('v2BasisLive')}</span></div>
          <div className="v2-kpi-card__jetty-row">
            <InteractiveTooltip title={t('jettyTooltipAvail')} items={jettyStatusLists.avail.map((l) => ({ primary: l }))} emptyText={t('jettyEmptyAvail')}>
              <span className="v2-kpi-jetty-chip v2-kpi-jetty-chip--ok">
                ✓ {t('available')} <strong>{jettyStatusCounts.Available}</strong>
              </span>
            </InteractiveTooltip>
            <InteractiveTooltip title={t('jettyTooltipOos')} items={jettyStatusLists.oos.map((l) => ({ primary: l }))} emptyText={t('jettyEmptyOos')}>
              <span className="v2-kpi-jetty-chip v2-kpi-jetty-chip--bad">
                ✕ {t('outOfService')} <strong>{jettyStatusCounts['Out of Service']}</strong>
              </span>
            </InteractiveTooltip>
          </div>
        </div>

        {/* Awaiting departure: ops finished, not cast off (clearance lag) */}
        <div className={`v2-kpi-card${awaitingDeparture.length > 0 ? ' v2-kpi-card--accent-amber' : ''}`}>
          <div className="v2-kpi-card__label">{t('v2AwaitDeparture')} <span className="v2-basis-chip">{t('v2BasisLive')}</span></div>
          <InteractiveTooltip
            title={t('v2AwaitTooltipTitle')}
            subtitle={t('v2AwaitDepartureSub')}
            items={awaitingDeparture.slice(0, 8).map((o) => ({
              primary: o.vesselName || `Op #${o.id}`,
              secondary: `${o.jettyName || '—'}${o.sinceHours != null ? ` · ${formatDurationHours(o.sinceHours)} ${t('v2AwaitSinceSuffix')}` : ''}`,
            }))}
            emptyText={t('v2AwaitEmpty')}
            maxWidth={360}
          >
            <div className="v2-kpi-card__value">{loading ? '—' : awaitingDeparture.length}</div>
          </InteractiveTooltip>
          <div className="v2-kpi-card__sub">{t('v2AwaitDepartureSub')}</div>
        </div>
        </>
        )}
      </div>

      {isLive && (
      <>
      {/* ── At Berth Now (full width) ── */}
      <section className="card v2-atberth">
        <div className="v2-atberth__head">
          <h2 className="card__title">{t('atBerthNow')} <span className="v2-basis-chip">{t('v2BasisLive')}</span></h2>
          <Link to="/at-berth" className="btn btn--small btn--primary">{t('viewAll')}</Link>
        </div>
        {loading ? (
          <p className="text-steel">{t('loadingEllipsis')}</p>
        ) : isFilteredEmpty ? (
          <p className="text-steel v2-atberth__empty">{t('v2FilterNoData')}</p>
        ) : (
          <>
            <div className="v2-atberth__summary-row">
              {purposesUi.map(({ key: purpose, label }) => (
                <div
                  key={purpose}
                  className={`v2-atberth__summary-card v2-atberth__summary-card--${purpose.toLowerCase()}`}
                >
                  <span className="v2-atberth__summary-label">{label}</span>
                  <span className="v2-atberth__summary-count">{atBerthTotals[purpose]}</span>
                  <span className="v2-atberth__summary-sub">
                    {AT_BERTH_PHASES.map((ph) => `${phaseShortLabel[ph]}: ${atBerthCounts[purpose][ph]}`).join(' · ')}
                  </span>
                </div>
              ))}
            </div>

            {berthBoard.length > 0 && (
              <div className="table-wrap v2-berth-board">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t('v2BoardVessel')}</th>
                      <th>{t('v2BoardJetty')}</th>
                      <th>{t('v2FilterPurpose')}</th>
                      <th>{t('v2BoardPhase')}</th>
                      <th className="v2-board-r">{t('v2BoardAlongside')}</th>
                      <th className="v2-board-r">{t('v2BoardEtc')}</th>
                      <th>{t('v2BoardFlags')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {berthBoard.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <b>{r.vesselName}</b>
                          {r.code ? <span className="v2-board-code">{r.code}</span> : null}
                        </td>
                        <td>{r.jettyName}</td>
                        <td>
                          <span className={`v2-board-chip v2-board-chip--${r.purpose === 'Loading' ? 'load' : 'disch'}`}>
                            {r.purpose === 'Loading' ? t('purposeLoading') : t('purposeUnloading')}
                          </span>
                        </td>
                        <td>
                          {r.phase
                            ? `${PHASE_EMOJI[r.phase] || ''} ${phaseShortLabel[r.phase]}`
                            : r.readyToSail ? `✅ ${t('clearanceReady')}` : `⚠ ${t('clearancePendingSignOff')}`}
                        </td>
                        <td className="v2-board-r">{formatDurationHours(r.alongsideHours)}</td>
                        <td className="v2-board-r">
                          {r.etcState === 'none' ? (
                            <span className="v2-board-chip v2-board-chip--ghost">{t('v2EtcNone')}</span>
                          ) : r.etcState === 'done' ? (
                            <span className="v2-board-chip v2-board-chip--ok">{t('v2EtcDone')}</span>
                          ) : r.etcState === 'over' ? (
                            <span className="v2-board-chip v2-board-chip--over">+{formatDurationHours(-r.etcDeltaH)}</span>
                          ) : (
                            <span className={`v2-board-chip ${r.etcState === 'soon' ? 'v2-board-chip--soon' : 'v2-board-chip--ok'}`}>
                              {formatDurationHours(r.etcDeltaH)}
                            </span>
                          )}
                        </td>
                        <td>
                          {!r.norAccepted && <span className="v2-board-flag v2-board-flag--warn">{t('v2FlagNoNor')}</span>}
                          {r.signoffPending && <span className="v2-board-flag v2-board-flag--warn">{t('clearancePendingSignOff')}</span>}
                          {r.readyToSail && <span className="v2-board-flag v2-board-flag--ok">{t('clearanceReady')}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="v2-clearance-row">
              <Link to="/at-berth" className="v2-clearance-card v2-clearance-card--atberth">
                <span aria-hidden>🚢</span>
                <span>{t('pipelineAtBerth')}</span>
                <strong>{opStats.atBerth}</strong>
              </Link>
              <Link to="/verification" className="v2-clearance-card v2-clearance-card--ready">
                <span aria-hidden>⚓</span>
                <span>{t('clearanceReady')}</span>
                <strong>{opStats.signoffApproved}</strong>
              </Link>
              <div className={`v2-clearance-card v2-clearance-card--pending${opStats.signoffRequested > 0 ? ' is-active' : ''}`}>
                <span aria-hidden>⚠</span>
                <span>{t('clearancePendingSignOff')}</span>
                <strong>{opStats.signoffRequested}</strong>
              </div>
              <div className="v2-clearance-card v2-clearance-card--sailed">
                <span aria-hidden>🚀</span>
                <span>{t('clearanceSailed')}</span>
                <strong>{opStats.sailed}</strong>
              </div>
            </div>
          </>
        )}
      </section>

      {/* ── Arriving soon (live, next 72h) ── */}
      <section className="card v2-arrivals">
        <div className="v2-atberth__head">
          <h2 className="card__title">{t('v2ArrivalsTitle')} <span className="v2-basis-chip">{t('v2BasisLive')}</span></h2>
          <Link to="/allocation-plans" className="btn btn--small btn--primary">{t('viewAll')}</Link>
        </div>
        <p className="v2-arrivals__hint">{t('v2ArrivalsHint')}</p>
        {loading ? (
          <p className="text-steel">{t('loadingEllipsis')}</p>
        ) : arrivals.length === 0 ? (
          <p className="text-steel">{t('v2ArrivalsEmpty')}</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('v2BoardVessel')}</th>
                  <th>{t('v2ArrivalsWhen')}</th>
                  <th>{t('v2BoardJetty')}</th>
                  <th>{t('v2FilterPurpose')}</th>
                  <th>{t('v2ArrivalsCommodity')}</th>
                  <th className="v2-board-r">{t('v2ArrivalsQty')}</th>
                  <th>{t('v2ArrivalsStatus')}</th>
                </tr>
              </thead>
              <tbody>
                {arrivals.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <b>{a.vesselName}</b>
                      {a.agentName ? <span className="v2-board-code">{a.agentName}</span> : null}
                    </td>
                    <td>
                      {a.whenKind} {formatDateTimeDisplay(a.whenIso)}
                      {' '}
                      {a.overdue ? (
                        <span className="v2-board-chip v2-board-chip--over">{t('v2ArrivalsOverdue')}</span>
                      ) : (
                        <span className="v2-board-chip v2-board-chip--ghost">{formatDurationHours(a.inHours)}</span>
                      )}
                      {a.anchored && <span className="v2-board-chip v2-board-chip--soon">{t('v2ArrivalsAnchored')}</span>}
                    </td>
                    <td>{a.jettyName || '—'}</td>
                    <td>
                      {a.purpose ? (
                        <span className={`v2-board-chip v2-board-chip--${a.purpose === 'Loading' ? 'load' : 'disch'}`}>
                          {a.purpose === 'Loading' ? t('purposeLoading') : t('purposeUnloading')}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="v2-arrivals__commodity">{a.commodity}</td>
                    <td className="v2-board-r">{a.qtyMt != null ? a.qtyMt.toLocaleString(getAppLocaleTag()) : '—'}</td>
                    <td>
                      <span className={`v2-board-chip ${a.approvalStatus === 'Approved' ? 'v2-board-chip--ok' : 'v2-board-chip--ghost'}`}>
                        {a.approvalStatus}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      </>
      )}

      {isAnalytics && (
      <>
      {/* ── Cargo tonnage (selected range) ── */}
      <section className="card v2-tonnage">
        <h2 className="card__title">{t('v2TonnageTitle')} <span className="v2-basis-chip v2-basis-chip--range">{dateRangeLabel}</span></h2>
        <div className="v2-tonnage__row">
          {purposesUi.map(({ key, label }) => {
            const tData = tonnage[key]
            const pct = tData.planned > 0 ? Math.min(100, Math.round((tData.sailed / tData.planned) * 100)) : null
            const openTonnageDetail = () => {
              const rows = [
                ...tData.plannedRows.map((r) => ({ type: 'Planned', vesselName: r.vesselName, qty: r.qty })),
                ...tData.sailedRows.map((r) => ({ type: 'Sailed', vesselName: r.vesselName, qty: r.qty })),
              ].sort((a, b) => (a.type === b.type ? b.qty - a.qty : a.type.localeCompare(b.type)))
              setActiveModal({
                title: `${label} — ${t('v2TonnageTitle')}`,
                subtitle: dateRangeLabel,
                stats: [
                  { label: t('v2TonnagePlanned'), value: `${Math.round(tData.planned).toLocaleString(getAppLocaleTag())} MT` },
                  { label: t('v2TonnageSailed'), value: `${Math.round(tData.sailed).toLocaleString(getAppLocaleTag())} MT` },
                  { label: '%', value: pct != null ? `${pct}%` : '—' },
                ],
                columns: [
                  { label: 'Type', cell: (r) => r.type },
                  { label: 'Vessel', cell: (r) => r.vesselName },
                  { label: 'Qty (MT)', cell: (r) => Math.round(r.qty).toLocaleString(getAppLocaleTag()), align: 'right' },
                ],
                rows,
                emptyText: t('v2TonnageNoPlanned'),
              })
            }
            return (
              <button
                key={key}
                type="button"
                className={`v2-tonnage__card v2-tonnage__card--${key.toLowerCase()} v2-tonnage__card--clickable`}
                onClick={openTonnageDetail}
              >
                <div className="v2-tonnage__label">{label}</div>
                <div className="v2-tonnage__vals">
                  <span>{t('v2TonnagePlanned')}: <b>{Math.round(tData.planned).toLocaleString(getAppLocaleTag())}</b> MT</span>
                  <span>{t('v2TonnageSailed')}: <b>{Math.round(tData.sailed).toLocaleString(getAppLocaleTag())}</b> MT</span>
                </div>
                <div className="v2-tonnage__bar-wrap">
                  <div className="v2-tonnage__bar" style={{ width: `${pct ?? 0}%` }} />
                </div>
                <div className="v2-tonnage__sub">
                  {pct != null ? t('v2TonnagePct', { pct }) : t('v2TonnageNoPlanned')}
                </div>
              </button>
            )
          })}
        </div>
      </section>

      <DashboardV2WeeklyTrends
        data={weeklyTrends?.weeks}
        totalSlots={weeklyTrends?.totalSlots}
        loading={loading && !weeklyTrends}
        refreshing={weeklyLoading}
        filtered={hasActiveFilters}
        dateRangeLabel={dateRangeLabel}
      />
      </>
      )}

      <WidgetDetailModal modal={activeModal} onClose={closeModal} />
    </div>
  )
}
