import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { fetchOperations, fetchAtBerth } from '../api/operations'
import { fetchShipmentPlans } from '../api/shipmentPlans'
import { fetchAllocationOverview } from '../api/allocation'
import { fetchDashboardV2Weekly } from '../api/dashboardV2'
import { fetchJetties } from '../api/jetties'
import { useTranslation } from 'react-i18next'
import { usePortScope } from '../context/PortScopeContext'
import { getAppLocaleTag } from '../utils/formatDateTimeDisplay'
import InteractiveTooltip from '../components/InteractiveTooltip'
import DashboardV2WeeklyTrends from '../components/DashboardV2WeeklyTrends'
import { computePipelinePartition } from '../utils/dashboardPipelinePartition'
import '../styles/dashboard.css'
import '../styles/allocation.css'

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

function formatDisplayDate(isoDate) {
  if (!isoDate) return ''
  const [y, m, d] = isoDate.split('-')
  return `${d}/${m}/${y}`
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

// ─── Summary KPI card ─────────────────────────────────────────────────────────
function SummaryCard({ label, value, sub, to, accent }) {
  const inner = (
    <div className={`v2-kpi-card${accent ? ` v2-kpi-card--${accent}` : ''}`}>
      <div className="v2-kpi-card__label">{label}</div>
      <div className="v2-kpi-card__value">{value ?? '—'}</div>
      {sub && <div className="v2-kpi-card__sub">{sub}</div>}
    </div>
  )
  return to ? <Link to={to} className="v2-kpi-card-link">{inner}</Link> : inner
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function DashboardV2() {
  const { t } = useTranslation('dashboard')
  const { t: tPages } = useTranslation('pages')
  const { selectedPortId, selectedPort } = usePortScope()
  const defaultRange = getMonthRange(0)
  const [dateRange, setDateRange] = useState(defaultRange)

  const [plans, setPlans] = useState([])
  const [ops, setOps] = useState([])
  const [atBerth, setAtBerth] = useState([])
  const [berths, setBerths] = useState([])
  const [jetties, setJetties] = useState([])
  const [loading, setLoading] = useState(true)
  const [apiErr, setApiErr] = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [weeklyTrends, setWeeklyTrends] = useState(null)

  const { startDate, endDate } = dateRange

  const refresh = useCallback(async () => {
    if (selectedPortId == null) {
      setLoading(false)
      setPlans([])
      setOps([])
      setAtBerth([])
      setBerths([])
      setJetties([])
      setWeeklyTrends(null)
      setApiErr(null)
      return
    }

    setLoading(true)
    setApiErr(null)
    const errs = []

    const run = async (label, fn) => {
      try { return { ok: true, v: await fn() } } catch (e) {
        errs.push(`${label}: ${e?.message || 'failed'}`)
        return { ok: false, v: null }
      }
    }

    const [rPlans, rOps, rAtBerth, rAlloc, rJetties, rWeekly] = await Promise.all([
      run('plans', () => fetchShipmentPlans({ startDate, endDate })),
      run('operations', () => fetchOperations({ startDate, endDate })),
      run('at-berth', fetchAtBerth),
      run('allocation', fetchAllocationOverview),
      run('jetties', () => fetchJetties(selectedPortId)),
      run('weekly-trends', () => fetchDashboardV2Weekly({ startDate, endDate })),
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
    if (rWeekly.ok && rWeekly.v && Array.isArray(rWeekly.v.weeks)) {
      setWeeklyTrends({ weeks: rWeekly.v.weeks, totalSlots: rWeekly.v.totalSlots ?? 0 })
    } else {
      setWeeklyTrends(null)
    }
    setLastUpdated(new Date())
    setLoading(false)
  }, [selectedPortId, startDate, endDate])

  useEffect(() => { refresh() }, [refresh])

  // ─── Pipeline (7 stages): mutually exclusive non-rejected plans; rejected only in card 1 sub ──
  const pipelineCounts = useMemo(() => computePipelinePartition(plans, ops), [plans, ops])

  const plansForMetrics = useMemo(
    () => plans.filter((p) => p.approvalStatus !== 'Rejected'),
    [plans]
  )

  const rejectedPlanIds = useMemo(() => {
    const s = new Set()
    for (const p of plans) {
      if (p.approvalStatus === 'Rejected') s.add(p.id)
    }
    return s
  }, [plans])

  // ─── At-berth phase counts (from live at-berth data) ─────────────────────
  const atBerthCounts = useMemo(() => {
    const empty = () => AT_BERTH_PHASES.reduce((acc, ph) => { acc[ph] = 0; return acc }, {})
    const counts = { Loading: empty(), Unloading: empty() }
    for (const o of atBerth) {
      const phase = phaseForCard(o.status)
      if (phase && counts[o.purpose]) counts[o.purpose][phase] += 1
    }
    return counts
  }, [atBerth])

  const atBerthTotals = useMemo(() => ({
    Loading: AT_BERTH_PHASES.reduce((s, ph) => s + (atBerthCounts.Loading[ph] || 0), 0),
    Unloading: AT_BERTH_PHASES.reduce((s, ph) => s + (atBerthCounts.Unloading[ph] || 0), 0),
  }), [atBerthCounts])

  // Bottom clearance row — use pipeline counts for consistency
  const opStats = useMemo(() => {
    const signoffRequested = ops.filter(
      (o) =>
        o.status === 'SIGNOFF_REQUESTED' &&
        (o.shipmentPlanId == null || !rejectedPlanIds.has(o.shipmentPlanId))
    ).length
    return {
      signoffApproved: pipelineCounts.readyToSail,
      signoffRequested,
      sailed: pipelineCounts.sailed,
    }
  }, [ops, rejectedPlanIds, pipelineCounts.readyToSail, pipelineCounts.sailed])

  // ─── Slot occupancy (from live allocation berths) ─────────────────────────
  const slotOccupancy = useMemo(() => {
    let totalSlots = 0
    let usedSlots = 0
    for (const b of berths) {
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
  }, [berths])

  const slotOccupancyItems = useMemo(() => {
    const out = []
    for (const b of berths) {
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
  }, [berths])

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

  // ─── SLA at risk ─────────────────────────────────────────────────────────
  const slaAtRisk = useMemo(() => {
    const now = Date.now()
    const byPlan = new Map()
    const unlinked = []
    for (const o of ops) {
      if (o.shipmentPlanId != null && rejectedPlanIds.has(o.shipmentPlanId)) continue
      if (['SAILED', 'PENDING', 'ALLOCATED'].includes(o.status)) continue
      const etc = parseIso(o.estimatedCompletionTime)
      if (!etc || etc.getTime() >= now) continue
      const overHours = (now - etc.getTime()) / 3600000
      const row = { ...o, overHours }
      const pid = o.shipmentPlanId != null ? Number(o.shipmentPlanId) : null
      if (pid != null && !Number.isNaN(pid)) {
        const prev = byPlan.get(pid)
        if (!prev || overHours > prev.overHours) byPlan.set(pid, row)
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
    return risky.slice(0, 5)
  }, [ops, rejectedPlanIds])

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

    // Turnaround (TB → cast-off) from ops (excl. rejected plans)
    for (const o of ops) {
      if (o?.shiftingOut) continue
      if (o.shipmentPlanId != null && rejectedPlanIds.has(o.shipmentPlanId)) continue
      const vesselName = (o?.vesselName || '').trim() || `Op #${o?.id}`
      const jettyName = (o?.jettyName || '').trim() || '—'
      const tb = parseIso(o?.tbAt || o?.dockingStartTime)
      const end = parseIso(o?.castOffAt) || parseIso(o?.actualCompletionTime)
      if (tb && end && end.getTime() > tb.getTime()) {
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
  }, [plansForMetrics, ops, rejectedPlanIds])

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
    return `${s.toLocaleDateString(getAppLocaleTag(), { day: '2-digit', month: 'short', year: 'numeric' })} – ${e.toLocaleDateString(getAppLocaleTag(), { day: '2-digit', month: 'short', year: 'numeric' })}`
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
              <>{t('lastUpdated')} {lastUpdated.toLocaleString(getAppLocaleTag(), { dateStyle: 'short', timeStyle: 'short' })}</>
            )}
          </span>
        </div>

        <DateRangePicker
          startDate={startDate}
          endDate={endDate}
          onChange={setDateRange}
          t={t}
        />
      </header>

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

          {/* Stage 1: Shipment Plans */}
          <Link to="/shipment-plans" className="v2-pipeline__stage v2-pipeline__stage--plans">
            <div className="v2-pipeline__stage-icon">📋</div>
            <div className="v2-pipeline__stage-body">
              <div className="v2-pipeline__stage-label">{t('v2PipelinePlans')}</div>
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

          <span className="v2-pipeline__arrow" aria-hidden>›</span>

          {/* Stage 2: Shipment Request (Draft/Submitted pending approval, not berthed) */}
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

          {/* Stage 7: Sailed */}
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

      {/* ── KPI Row 1: Occupancy + Performance metrics + SLA ── */}
      <div className="v2-kpi-row v2-kpi-row--5" aria-label={t('kpiGridAria')}>
        {/* Slot Occupancy */}
        <div className="v2-kpi-card">
          <div className="v2-kpi-card__label">{t('slotOccupancy')}</div>
          <div className="v2-kpi-card__value">
            {slotOccupancy.totalSlots > 0
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
              {loading ? '—' : performance.waiting.medianHours == null ? '—' : formatDurationHours(performance.waiting.medianHours)}
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
              {loading ? '—' : performance.turnaround.medianHours == null ? '—' : formatDurationHours(performance.turnaround.medianHours)}
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
              {loading ? '—' : performance.onTime.ratePct == null ? '—' : `${performance.onTime.ratePct}%`}
            </div>
          </InteractiveTooltip>
          <div className="v2-kpi-card__sub">{t('v2PerfOnTimeSub', { eligible: performance.onTime.eligible })}</div>
        </div>

        {/* SLA at Risk */}
        <div className={`v2-kpi-card${slaAtRisk.length > 0 ? ' v2-kpi-card--accent-red' : ''}`}>
          <div className="v2-kpi-card__label">{t('slaAtRisk')}</div>
          <InteractiveTooltip
            title={t('slaTooltipTitle')}
            subtitle={t('slaTooltipSubtitle')}
            items={slaAtRisk.map((o) => ({
              primary: o.vesselName || `Op #${o.id}`,
              secondary: `${o.jettyName || '—'} · +${o.overHours < 1 ? `${Math.round(o.overHours * 60)}m` : `${o.overHours.toFixed(1)}h`} over ETC`,
            }))}
            emptyText={t('slaEmpty')}
            maxWidth={360}
          >
            <div className="v2-kpi-card__value">{slaAtRisk.length}</div>
          </InteractiveTooltip>
          <div className="v2-kpi-card__sub">{t('slaSub')}</div>
        </div>
      </div>

      {/* ── KPI Row 2: Operational status ── */}
      <div className="v2-kpi-row v2-kpi-row--ops">
        {/* Jetty Status */}
        <div className="v2-kpi-card">
          <div className="v2-kpi-card__label">{t('jettyStatus')}</div>
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

        {/* Ready to Sail */}
        <Link to="/verification" className="v2-kpi-card v2-kpi-card-link v2-kpi-card--accent-green">
          <div className="v2-kpi-card__label">{t('readyToSail')}</div>
          <div className="v2-kpi-card__value">{opStats.signoffApproved}</div>
          <div className="v2-kpi-card__sub">{t('clearanceLink')}</div>
        </Link>
      </div>

      {/* ── At Berth Now (full width) ── */}
      <section className="card v2-atberth">
        <div className="v2-atberth__head">
          <h2 className="card__title">{t('atBerthNow')}</h2>
          <Link to="/at-berth" className="btn btn--small btn--primary">{t('viewAll')}</Link>
        </div>
        {loading ? (
          <p className="text-steel">{t('loadingEllipsis')}</p>
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

      <DashboardV2WeeklyTrends
        data={weeklyTrends?.weeks}
        totalSlots={weeklyTrends?.totalSlots}
        loading={loading}
        dateRangeLabel={dateRangeLabel}
      />
    </div>
  )
}
