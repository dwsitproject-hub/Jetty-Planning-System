import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { fetchOperations, fetchAtBerth, fetchSubProcesses, fetchOperationalActivities } from '../api/operations'
import { fetchShipmentPlans } from '../api/shipmentPlans'
import { fetchAllocationOverview } from '../api/allocation'
import { fetchDashboardV2Weekly, fetchDashboardV2PipelineActuals } from '../api/dashboardV2'
import { fetchJetties } from '../api/jetties'
import { fetchSiLookups } from '../api/siLookups'
import { useTranslation } from 'react-i18next'
import { usePortScope } from '../context/PortScopeContext'
import { formatDateDisplay, formatDateTimeDisplay, getAppLocaleTag } from '../utils/formatDateTimeDisplay'
import InteractiveTooltip from '../components/InteractiveTooltip'
import DashboardV2WeeklyTrends from '../components/DashboardV2WeeklyTrends'
import DropdownMultiSelect from '../components/DropdownMultiSelect'
import { computePipelinePartition } from '../utils/dashboardPipelinePartition'
import {
  isPipelineActualsBetaEnabled,
  readPipelineActualsCollapsed,
  writePipelineActualsCollapsed,
} from '../utils/pipelineActualsBeta'
import {
  buildPlanCommodityIndex,
  buildCommodityIdByName,
  buildCommodityNameById,
  extractCommodityOptionsFromMaster,
  filterPlans,
  filterOps,
  planMatchesFilters,
  pruneInvalidCommoditySelection,
} from '../utils/dashboardFilters'
import '../styles/dashboard.css'
import '../styles/allocation.css'
import { getEtcBreach } from '../utils/etcBreach'

// ─── Constants ────────────────────────────────────────────────────────────────
const AT_BERTH_PHASES = ['Pre-Checking', 'Operational', 'Post-Checking']
const PHASE_EMOJI = { 'Pre-Checking': '📋', Operational: '⚙️', 'Post-Checking': '✅' }
// SIGNOFF_APPROVED is separated into its own "Ready to Sail" pipeline stage
// ─── Date helpers ─────────────────────────────────────────────────────────────
/** Format a local Date to YYYY-MM-DD without UTC conversion. */
function fmtLocalDate(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function getMonthRange(monthOffset = 0) {
  const now = new Date()
  const first = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1)
  const last = new Date(now.getFullYear(), now.getMonth() + monthOffset + 1, 0)
  return { startDate: fmtLocalDate(first), endDate: fmtLocalDate(last) }
}

function getRelativeRange(days) {
  const end = new Date()
  const start = new Date()
  start.setDate(end.getDate() - (days - 1))
  return { startDate: fmtLocalDate(start), endDate: fmtLocalDate(end) }
}

function parseDateLocal(isoDate) {
  if (!isoDate) return null
  const d = new Date(isoDate + 'T00:00:00')
  return Number.isNaN(d.getTime()) ? null : d
}

function parseIso(value) {
  if (value == null || value === '') return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function formatDurationHours(hours) {
  if (hours == null || !Number.isFinite(hours) || hours < 0) return '—'
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`
  if (hours >= 48) return `${(hours / 24).toFixed(1)}d`
  return `${hours.toFixed(1)}h`
}

function median(values) {
  const arr = Array.isArray(values) ? values.filter((n) => Number.isFinite(n)).slice() : []
  if (arr.length === 0) return null
  arr.sort((a, b) => a - b)
  const mid = Math.floor(arr.length / 2)
  return arr.length % 2 === 1 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2
}

function formatRelativeTime(iso, t) {
  const d = parseIso(iso)
  if (!d) return '—'
  const sec = Math.floor((Date.now() - d.getTime()) / 1000)
  if (sec < 60) return t('relativeJustNow')
  if (sec < 3600) return t('relativeMinutesAgo', { n: Math.floor(sec / 60) })
  if (sec < 86400) return t('relativeHoursAgo', { n: Math.floor(sec / 3600) })
  return t('relativeDaysAgo', { n: Math.floor(sec / 86400) })
}

function phaseForCard(status) {
  const s = String(status || '')
  if (s === 'SIGNOFF_REQUESTED' || s === 'SIGNOFF_APPROVED') return null
  if (s === 'IN_PROGRESS') return 'Operational'
  if (s === 'POST_OPS') return 'Post-Checking'
  return 'Pre-Checking'
}

/**
 * Phase refined by actual sub-process / activity data when available; falls
 * back to the status-based mapping. Same contract as phaseForCard (null for
 * sign-off statuses) so existing counts keep their semantics.
 */
function phaseForCardDetailed(op, detail) {
  const s = String(op?.status || '')
  if (s === 'SIGNOFF_REQUESTED' || s === 'SIGNOFF_APPROVED') return null
  if (s === 'POST_OPS') return 'Post-Checking'
  if (detail) {
    const postStarted = (detail.subs || []).some(
      (x) => x.phase === 'Post-Checking' && (x.startAt || x.occurredAt)
    )
    if (postStarted) return 'Post-Checking'
    const opsStarted = (detail.acts || []).some((a) => a.entryType === 'activity' && a.startAt)
    if (opsStarted) return 'Operational'
  }
  return phaseForCard(s)
}

// ─── Date Range Picker ────────────────────────────────────────────────────────
const PRESETS = [
  { key: 'thisMonth', labelKey: 'v2DateThisMonth', getRange: () => getMonthRange(0) },
  { key: 'lastMonth', labelKey: 'v2DateLastMonth', getRange: () => getMonthRange(-1) },
  { key: 'last7d', labelKey: 'v2DateLast7d', getRange: () => getRelativeRange(7) },
  { key: 'last30d', labelKey: 'v2DateLast30d', getRange: () => getRelativeRange(30) },
]

function DateRangePicker({ startDate, endDate, onChange, t }) {
  const [activePreset, setActivePreset] = useState('thisMonth')

  const handlePreset = (preset) => {
    setActivePreset(preset.key)
    onChange(preset.getRange())
  }

  const handleStartChange = (e) => {
    setActivePreset('custom')
    onChange({ startDate: e.target.value, endDate })
  }

  const handleEndChange = (e) => {
    setActivePreset('custom')
    onChange({ startDate, endDate: e.target.value })
  }

  return (
    <div className="v2-date-range">
      <div className="v2-date-range__presets">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            className={`v2-date-range__preset${activePreset === p.key ? ' is-active' : ''}`}
            onClick={() => handlePreset(p)}
          >
            {t(p.labelKey)}
          </button>
        ))}
      </div>
      <div className="v2-date-range__inputs">
        <label className="v2-date-range__label">
          <span>{t('v2DateFrom')}</span>
          <input
            type="date"
            className="v2-date-range__input"
            value={startDate}
            onChange={handleStartChange}
          />
        </label>
        <span className="v2-date-range__sep">–</span>
        <label className="v2-date-range__label">
          <span>{t('v2DateTo')}</span>
          <input
            type="date"
            className="v2-date-range__input"
            value={endDate}
            onChange={handleEndChange}
          />
        </label>
      </div>
    </div>
  )
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function DashboardV2() {
  const { t } = useTranslation('dashboard')
  const { t: tPages } = useTranslation('pages')
  const { selectedPortId, selectedPort } = usePortScope()
  const defaultRange = getMonthRange(0)
  const [dateRange, setDateRange] = useState(defaultRange)
  const [selectedPurposes, setSelectedPurposes] = useState([])
  const [selectedCommodityIds, setSelectedCommodityIds] = useState([])
  const [masterCommodities, setMasterCommodities] = useState([])

  const [plans, setPlans] = useState([])
  const [ops, setOps] = useState([])
  const [atBerth, setAtBerth] = useState([])
  const [berths, setBerths] = useState([])
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
  const [pipelineActualsCollapsed, setPipelineActualsCollapsed] = useState(readPipelineActualsCollapsed)
  const pipelineActualsBetaEnabled = isPipelineActualsBetaEnabled()

  const { startDate, endDate } = dateRange

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
      setBerths([])
      setJetties([])
      setArrivalPlans([])
      setAllOps([])
      setWeeklyTrends(null)
      setPipelineActuals(null)
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

    // Arrivals window is live (yesterday → +3 days), independent of the selected range
    const arrivalsStart = new Date()
    arrivalsStart.setDate(arrivalsStart.getDate() - 1)
    const arrivalsEnd = new Date()
    arrivalsEnd.setDate(arrivalsEnd.getDate() + 3)

    const [rPlans, rOps, rAtBerth, rAlloc, rJetties, rArrivals, rAllOps] = await Promise.all([
      run('plans', () => fetchShipmentPlans({ startDate, endDate })),
      run('operations', () => fetchOperations({ startDate, endDate })),
      run('at-berth', fetchAtBerth),
      run('allocation', fetchAllocationOverview),
      run('jetties', () => fetchJetties(selectedPortId)),
      run('arrivals', () => fetchShipmentPlans({
        startDate: fmtLocalDate(arrivalsStart),
        endDate: fmtLocalDate(arrivalsEnd),
      })),
      // Unwindowed ops: "sailed" must be bucketed by cast-off date, and the ops
      // list endpoint filters by ETA — an op can cast off far outside its ETA window.
      run('operations-all', () => fetchOperations()),
    ])

    setPlans(Array.isArray(rPlans.v) ? rPlans.v : [])
    setOps(Array.isArray(rOps.v) ? rOps.v : [])
    setAtBerth(Array.isArray(rAtBerth.v) ? rAtBerth.v : [])
    if (rAlloc.ok && rAlloc.v) {
      setBerths(Array.isArray(rAlloc.v.berths) ? rAlloc.v.berths : [])
    } else {
      setBerths([])
    }
    setJetties(Array.isArray(rJetties.v) ? rJetties.v : [])
    setArrivalPlans(Array.isArray(rArrivals.v) ? rArrivals.v : [])
    setAllOps(Array.isArray(rAllOps.v) ? rAllOps.v : [])
    if (errs.length > 0) setApiErr(errs.join('; '))
    else setApiErr(null)
    setLastUpdated(new Date())
    setLoading(false)
  }, [selectedPortId, startDate, endDate])

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
    if (!pipelineActualsBetaEnabled || pipelineActualsCollapsed) {
      return
    }
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
  }, [pipelineActualsBetaEnabled, pipelineActualsCollapsed, selectedPortId, startDate, endDate, selectedPurposes, selectedCommodityIds])

  const togglePipelineActualsCollapsed = useCallback(() => {
    setPipelineActualsCollapsed((prev) => {
      const next = !prev
      writePipelineActualsCollapsed(next)
      return next
    })
  }, [])

  useEffect(() => { refresh() }, [refresh])
  useEffect(() => { refreshWeekly() }, [refreshWeekly])
  useEffect(() => { refreshPipelineActuals() }, [refreshPipelineActuals])

  // Background poll: live sections stay current on wall screens (no loading flash)
  useEffect(() => {
    const id = setInterval(() => { refresh({ silent: true }) }, 60000)
    return () => clearInterval(id)
  }, [refresh])

  // Re-render tick so "updated Xm ago" and alongside-hours stay fresh
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 30000)
    return () => clearInterval(id)
  }, [])

  // Phase detail for vessels alongside (sub-processes + operational activities).
  // Best-effort: rows render from status alone until details arrive.
  useEffect(() => {
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
  }, [atBerth])

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
    () => buildPlanCommodityIndex(plans, ops, commodityIdByName),
    [plans, ops, commodityIdByName]
  )

  const filters = useMemo(() => ({
    purposes: selectedPurposes,
    commodityIds: selectedCommodityIds,
    commodityIndex,
    commodityNameById,
  }), [selectedPurposes, selectedCommodityIds, commodityIndex, commodityNameById])

  const filteredPlans = useMemo(() => filterPlans(plans, filters), [plans, filters])
  const filteredOps = useMemo(
    () => filterOps(ops, filters, commodityIndex, plans),
    [ops, filters, commodityIndex, plans]
  )
  const filteredAtBerth = useMemo(
    () => filterOps(atBerth, filters, commodityIndex, plans),
    [atBerth, filters, commodityIndex, plans]
  )

  const hasActiveFilters = selectedPurposes.length > 0 || selectedCommodityIds.length > 0
  const isFilteredEmpty = hasActiveFilters
    && filteredPlans.length === 0
    && filteredOps.length === 0
    && filteredAtBerth.length === 0

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
    const empty = { count: 0, qty: { Loading: 0, Unloading: 0 } }
    if (!s || !e) return empty
    const startMs = s.getTime()
    const endMs = e.getTime() + 86400000
    const seenVoyages = new Set()
    let count = 0
    const qty = { Loading: 0, Unloading: 0 }
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
      if (k && Number.isFinite(q) && q > 0) qty[k] += q
    }
    return { count, qty }
  }, [filteredAllOps, rejectedPlanIds, startDate, endDate])

  // Bottom clearance row — live/range figures matching the pipeline stages
  const opStats = useMemo(() => ({
    signoffApproved: pipelineLive.readyToSail,
    signoffRequested: pipelineLive.signoffRequested,
    sailed: sailedInRange.count,
  }), [pipelineLive, sailedInRange.count])

  const filteredBerths = useMemo(() => {
    if (!hasActiveFilters) return berths
    return berths.map((b) => {
      const occs = Array.isArray(b?.occupants) ? b.occupants : []
      const filteredOccs = occs.filter((occ) => {
        const pid = occ?.shipmentPlanId
        if (pid == null) return false
        const plan = plans.find((p) => Number(p.id) === Number(pid))
        return plan && planMatchesFilters(plan, filters)
      })
      return {
        ...b,
        occupants: filteredOccs,
        occupiedCount: filteredOccs.length,
        currentVesselId: filteredOccs[0]?.vesselId ?? null,
        currentVesselName: filteredOccs[0]?.vesselName ?? null,
        currentOperationId: filteredOccs[0]?.operationId ?? null,
      }
    })
  }, [berths, plans, filters, hasActiveFilters])

  // ─── Slot occupancy (from live allocation berths) ─────────────────────────
  const slotOccupancy = useMemo(() => {
    let totalSlots = 0
    let usedSlots = 0
    for (const b of filteredBerths) {
      if ((b?.status || '') === 'Out of Service') continue
      const cap = Number.isFinite(Number(b?.capacity)) && Number(b?.capacity) >= 1 ? Number(b.capacity) : 1
      const occ = b?.occupiedCount != null && Number.isFinite(Number(b.occupiedCount))
        ? Number(b.occupiedCount)
        : b?.currentVesselId ? 1 : 0
      totalSlots += cap
      usedSlots += Math.min(Math.max(0, occ), cap)
    }
    const pct = totalSlots > 0 ? Math.round((usedSlots / totalSlots) * 100) : 0
    return { totalSlots, usedSlots, pct, overCapacity: usedSlots > totalSlots && totalSlots > 0 }
  }, [filteredBerths])

  const slotOccupancyItems = useMemo(() => {
    const out = []
    for (const b of filteredBerths) {
      const cap = Number.isFinite(Number(b?.capacity)) && Number(b?.capacity) >= 1 ? Number(b.capacity) : 1
      const occs = Array.isArray(b?.occupants) ? b.occupants : []
      for (let i = 0; i < Math.min(cap, occs.length); i++) {
        const occ = occs[i]
        const slot = `${b.id}-${String(i + 1).padStart(2, '0')}`
        const name = (occ?.vesselName || '').trim() || String(occ?.vesselId || '—')
        out.push({ primary: `${slot} — ${name}` })
      }
    }
    return out
  }, [filteredBerths])

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

  // ─── SLA at risk (live at-berth feed, not the ETA-window ops: a vessel that
  // arrived before the selected range but is alongside and past ETC must count) ──
  const slaAtRisk = useMemo(() => {
    const now = Date.now()
    const byPlan = new Map()
    const unlinked = []
    for (const o of filteredAtBerth) {
      if (o.shipmentPlanId != null && rejectedPlanIds.has(o.shipmentPlanId)) continue
      const breach = getEtcBreach(o, now)
      if (!breach) continue
      const row = { ...o, overHours: breach.overHours, overMs: breach.overMs }
      const pid = o.shipmentPlanId != null ? Number(o.shipmentPlanId) : null
      if (pid != null && !Number.isNaN(pid)) {
        const prev = byPlan.get(pid)
        if (!prev || breach.overHours > prev.overHours) byPlan.set(pid, row)
      } else {
        unlinked.push(row)
      }
    }
    // Ops without a plan link: dedupe by vessel + jetty (duplicate op rows test data)
    const unlinkedByKey = new Map()
    for (const row of unlinked) {
      const key = `${(row.vesselName || '').trim().toLowerCase()}|${(row.jettyName || '').trim().toLowerCase()}`
      const prev = unlinkedByKey.get(key)
      if (!prev || row.overHours > prev.overHours) unlinkedByKey.set(key, row)
    }
    const risky = [...byPlan.values(), ...unlinkedByKey.values()]
    risky.sort((a, b) => b.overHours - a.overHours)
    // count = ALL breaches; top = worst 5 for the tooltip (count was previously
    // capped at 5 because the card displayed the sliced array's length)
    return { count: risky.length, top: risky.slice(0, 5) }
  }, [filteredAtBerth, rejectedPlanIds])

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
      Loading: { planned: 0, sailed: sailedInRange.qty.Loading },
      Unloading: { planned: 0, sailed: sailedInRange.qty.Unloading },
    }
    for (const p of plansForMetrics) {
      const key = p.purposeCode === 'Loading' ? 'Loading' : p.purposeCode === 'Unloading' ? 'Unloading' : null
      const mt = Number(p.vesselCapacity)
      if (key && Number.isFinite(mt) && mt > 0) out[key].planned += mt
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

  const dateRangeLabel = useMemo(() => {
    const s = parseDateLocal(startDate)
    const e = parseDateLocal(endDate)
    if (!s || !e) return ''
    return `${formatDateDisplay(startDate)} – ${formatDateDisplay(endDate)}`
  }, [startDate, endDate])

  // ─── Render ───────────────────────────────────────────────────────────────
  if (selectedPortId == null) {
    return (
      <div className="dashboard v2-dashboard">
        <header className="v2-header">
          <div className="v2-header__title-row">
            <h1 className="page-title">{tPages('dashboard')}</h1>
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
            <h1 className="page-title">{tPages('dashboard')}</h1>
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
            {lastUpdated && (
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
          <DateRangePicker
            startDate={startDate}
            endDate={endDate}
            onChange={setDateRange}
            t={t}
          />
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

      {/* ── Pipeline (7 stages) ── */}
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

      {/* ── Pipeline Actuals (beta, staging opt-in) — additive; plan pipeline above unchanged ── */}
      {pipelineActualsBetaEnabled && (
        <section
          className={`card v2-pipeline v2-pipeline--actuals${pipelineActualsCollapsed ? ' v2-pipeline--collapsed' : ''}`}
        >
          <div className="v2-pipeline__header">
            <h2 className="card__title">
              {t('v2PipelineActualsTitle')}{' '}
              <span className="v2-basis-chip v2-basis-chip--beta">{t('v2PipelineActualsBeta')}</span>
              <span className="v2-basis-chip v2-basis-chip--actuals">{t('v2PipelineActualsBasis')}</span>
            </h2>
            <div className="v2-pipeline__header-right">
              {!pipelineActualsCollapsed && pipelineActualsLoading && (
                <span className="v2-pipeline__refreshing">{t('loadingEllipsis')}</span>
              )}
              <span className="v2-pipeline__period">{dateRangeLabel}</span>
              <button
                type="button"
                className="v2-pipeline__toggle"
                onClick={togglePipelineActualsCollapsed}
                aria-expanded={!pipelineActualsCollapsed}
                aria-controls="v2-pipeline-actuals-body"
                title={pipelineActualsCollapsed ? t('v2PipelineActualsExpand') : t('v2PipelineActualsCollapse')}
              >
                <span className="v2-pipeline__toggle-label">
                  {pipelineActualsCollapsed ? t('v2PipelineActualsExpand') : t('v2PipelineActualsCollapse')}
                </span>
                <svg
                  className={`v2-pipeline__toggle-icon${pipelineActualsCollapsed ? '' : ' v2-pipeline__toggle-icon--expanded'}`}
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            </div>
          </div>
          {!pipelineActualsCollapsed && (
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
                title={t('pipelinePlannedBerthing')}
                subtitle={`${dateRangeLabel} · n=${pipelineActuals?.plannedBerthing ?? 0}`}
                items={(pipelineActuals?.plannedBerthingVessels ?? []).map((v) => ({
                  primary: v.vesselName || '—',
                  secondary: v.purpose || '—',
                }))}
                emptyText={t('v2PipelineActualsTooltipEmpty')}
                placement="right"
                interactiveChild
              >
                <Link to="/allocation-plans" className="v2-pipeline__stage v2-pipeline__stage--planned">
                  <div className="v2-pipeline__stage-icon">⚓</div>
                  <div className="v2-pipeline__stage-body">
                    <div className="v2-pipeline__stage-label">{t('pipelinePlannedBerthing')}</div>
                    <div className="v2-pipeline__stage-count">{pipelineActuals?.plannedBerthing ?? (pipelineActualsLoading ? '—' : 0)}</div>
                    <div className="v2-pipeline__stage-sub">{t('v2PipelineActualsPlannedSub')}</div>
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
          )}
        </section>
      )}

      {/* ── KPI Row 1: Occupancy + Performance metrics + SLA ── */}
      <div className="v2-kpi-row v2-kpi-row--5" aria-label={t('kpiGridAria')}>
        {/* Slot Occupancy */}
        <div className="v2-kpi-card">
          <div className="v2-kpi-card__label">{t('slotOccupancy')} <span className="v2-basis-chip">{t('v2BasisLive')}</span></div>
          <div className="v2-kpi-card__value">
            {loading
              ? '—'
              : hasActiveFilters && slotOccupancy.usedSlots === 0 && slotOccupancy.totalSlots > 0
                ? kpiNoData
                : slotOccupancy.totalSlots > 0
                  ? <>{slotOccupancy.usedSlots}/{slotOccupancy.totalSlots} <span className="v2-kpi-card__unit">{slotOccupancy.pct}%</span></>
                  : '—'}
          </div>
          <div className="v2-kpi-card__bar-wrap">
            <div
              className={`v2-kpi-card__bar${slotOccupancy.overCapacity ? ' v2-kpi-card__bar--over' : ''}`}
              style={{ width: slotOccupancy.totalSlots > 0 ? `${Math.min(100, slotOccupancy.pct)}%` : '0%' }}
            />
          </div>
          <div className="v2-kpi-card__sub">
            {t('slotOccupancyHint')}{' '}
            <InteractiveTooltip
              title={t('slotTooltipTitle')}
              subtitle={t('slotTooltipSubtitle')}
              items={slotOccupancyItems}
              emptyText={t('slotEmpty')}
              maxWidth={360}
            >
              <span className="v2-kpi-card__detail-link">{t('slotDetails')}</span>
            </InteractiveTooltip>
          </div>
          <Link to="/at-berth" className="v2-kpi-card__link">{t('viewAtBerth')}</Link>
        </div>

        {/* Waiting to Berth */}
        <div className="v2-kpi-card">
          <div className="v2-kpi-card__label">{t('perfWaiting')}</div>
          <InteractiveTooltip
            title={t('perfWaitingTooltip')}
            subtitle={`${dateRangeLabel} · n=${performance.waiting.sampleSize}`}
            items={performance.waiting.worst.map((x) => ({
              primary: `${x.vesselName} — ${x.jettyName}`,
              secondary: `Wait: ${formatDurationHours(x.hours)}`,
            }))}
            emptyText={t('perfWaitingEmpty')}
            maxWidth={360}
          >
            <div className="v2-kpi-card__value">
              {loading
                ? '—'
                : hasActiveFilters && performance.waiting.sampleSize === 0
                  ? kpiNoData
                  : performance.waiting.medianHours == null
                    ? '—'
                    : formatDurationHours(performance.waiting.medianHours)}
            </div>
          </InteractiveTooltip>
          <div className="v2-kpi-card__sub">{t('v2PerfWaitingSub', { n: performance.waiting.sampleSize })}</div>
        </div>

        {/* Turnaround */}
        <div className="v2-kpi-card">
          <div className="v2-kpi-card__label">{t('perfTurnaround')}</div>
          <InteractiveTooltip
            title={t('perfTurnaroundTooltip')}
            subtitle={`${dateRangeLabel} · n=${performance.turnaround.sampleSize}`}
            items={performance.turnaround.worst.map((x) => ({
              primary: `${x.vesselName} — ${x.jettyName}`,
              secondary: `Turnaround: ${formatDurationHours(x.hours)}`,
            }))}
            emptyText={t('perfTurnaroundEmpty')}
            maxWidth={360}
          >
            <div className="v2-kpi-card__value">
              {loading
                ? '—'
                : hasActiveFilters && performance.turnaround.sampleSize === 0
                  ? kpiNoData
                  : performance.turnaround.medianHours == null
                    ? '—'
                    : formatDurationHours(performance.turnaround.medianHours)}
            </div>
          </InteractiveTooltip>
          <div className="v2-kpi-card__sub">{t('v2PerfTurnaroundSub', { n: performance.turnaround.sampleSize })}</div>
        </div>

        {/* On-time Berthing */}
        <div className="v2-kpi-card">
          <div className="v2-kpi-card__label">{t('perfOnTime')}</div>
          <InteractiveTooltip
            title={t('perfOnTimeTooltip')}
            subtitle={`${dateRangeLabel} · eligible=${performance.onTime.eligible}`}
            items={performance.onTime.late.map((x) => ({
              primary: `${x.vesselName} — ${x.jettyName}`,
              secondary: `Late: +${formatDurationHours(x.lateHours)}`,
            }))}
            emptyText={t('perfOnTimeEmpty')}
            maxWidth={360}
          >
            <div className={`v2-kpi-card__value${performance.onTime.ratePct != null && performance.onTime.ratePct < 80 ? ' v2-kpi-card__value--warn' : ''}`}>
              {loading
                ? '—'
                : hasActiveFilters && performance.onTime.eligible === 0
                  ? kpiNoData
                  : performance.onTime.ratePct == null
                    ? '—'
                    : `${performance.onTime.ratePct}%`}
            </div>
          </InteractiveTooltip>
          <div className="v2-kpi-card__sub">{t('v2PerfOnTimeSub', { eligible: performance.onTime.eligible })}</div>
        </div>

        {/* SLA at Risk */}
        <div className={`v2-kpi-card${slaAtRisk.count > 0 ? ' v2-kpi-card--accent-red' : ''}`}>
          <div className="v2-kpi-card__label">{t('slaAtRisk')} <span className="v2-basis-chip">{t('v2BasisLive')}</span></div>
          <InteractiveTooltip
            title={t('slaTooltipTitle')}
            subtitle={t('slaTooltipSubtitle')}
            items={slaAtRisk.top.map((o) => ({
              primary: o.vesselName || `Op #${o.id}`,
              secondary: `${o.jettyName || '—'} · +${o.overHours < 1 ? `${Math.round(o.overHours * 60)}m` : `${o.overHours.toFixed(1)}h`} over ETC`,
            }))}
            emptyText={t('slaEmpty')}
            maxWidth={360}
          >
            <div className="v2-kpi-card__value">
              {loading ? '—' : isFilteredEmpty ? kpiNoData : slaAtRisk.count}
            </div>
          </InteractiveTooltip>
          <div className="v2-kpi-card__sub">{t('slaSub')}</div>
        </div>
      </div>

      {/* ── KPI Row 2: Operational status ── */}
      <div className="v2-kpi-row v2-kpi-row--ops">
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
      </div>

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
              <Link to="/verification" className="v2-clearance-card v2-clearance-card--ready">
                <span aria-hidden>⚓</span>
                <span>{t('clearanceReady')}</span>
                <strong>{opStats.signoffApproved}</strong>
              </Link>
              <div className="v2-clearance-card v2-clearance-card--sailed">
                <span aria-hidden>🚀</span>
                <span>{t('clearanceSailed')}</span>
                <strong>{opStats.sailed}</strong>
              </div>
              <div className={`v2-clearance-card v2-clearance-card--pending${opStats.signoffRequested > 0 ? ' is-active' : ''}`}>
                <span aria-hidden>⚠</span>
                <span>{t('clearancePendingSignOff')}</span>
                <strong>{opStats.signoffRequested}</strong>
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

      {/* ── Cargo tonnage (selected range) ── */}
      <section className="card v2-tonnage">
        <h2 className="card__title">{t('v2TonnageTitle')} <span className="v2-basis-chip v2-basis-chip--range">{dateRangeLabel}</span></h2>
        <div className="v2-tonnage__row">
          {purposesUi.map(({ key, label }) => {
            const tData = tonnage[key]
            const pct = tData.planned > 0 ? Math.min(100, Math.round((tData.sailed / tData.planned) * 100)) : null
            return (
              <div key={key} className={`v2-tonnage__card v2-tonnage__card--${key.toLowerCase()}`}>
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
              </div>
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
    </div>
  )
}
