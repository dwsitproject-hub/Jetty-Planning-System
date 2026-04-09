import { useState, useEffect, useCallback, useMemo, Fragment } from 'react'
import { Link } from 'react-router-dom'
import { dashboardWeather } from '../data/mockData'
import { fetchAtBerth, fetchOperations } from '../api/operations'
import { fetchShippingInstructions } from '../api/shippingInstructions'
import { fetchAllocationOverview } from '../api/allocation'
import { fetchJetties } from '../api/jetties'
import { fetchActivityLogs } from '../api/activityLogs'
import { usePortScope } from '../context/PortScopeContext'
import { useRbac } from '../context/RbacContext'
import { formatDateTimeDisplay } from '../utils/formatDateTimeDisplay'
import { isPlannedBerthingQueueRow } from '../utils/dashboardQueueClassification'
import { atBerthExecutionOpenPath } from '../utils/atBerthOpenPath'
import DashboardActivityChart from '../components/DashboardActivityChart'
import InteractiveTooltip from '../components/InteractiveTooltip'
import '../styles/dashboard.css'
import '../styles/allocation.css'

const PHASES = ['Pre-Checking', 'Operational', 'Post-Checking']
const PHASE_EMOJI = { 'Pre-Checking': '📋', Operational: '⚙️', 'Post-Checking': '✅' }
/** Short labels for compact dashboard cards (data keys stay PHASES). */
const PHASE_SHORT_LABEL = { 'Pre-Checking': 'Pre', Operational: 'Ops', 'Post-Checking': 'Post' }
const PURPOSES = [
  { key: 'Loading', label: 'Loading' },
  { key: 'Unloading', label: 'Unloading' },
]

const PIPELINE_STAGES = [
  { id: 'si', label: 'Shipping Instruction', path: '/shipping-instruction', color: 'si' },
  { id: 'planned-berthing', label: 'Planned berthing', path: '/allocation', color: 'planned-berthing' },
  { id: 'at-berth', label: 'At-Berth', path: '/at-berth', color: 'at-berth' },
  { id: 'clearance', label: 'Clearance', path: '/verification', color: 'clearance' },
]

const ACTIVITY_PAGE_KEYS = ['allocation', 'shipping-instruction', 'verification', 'at-berth', 'loading']
const PERF_WINDOWS = [
  { key: '7d', label: 'Last 7 days', ms: 7 * 24 * 3600000 },
  { key: '24h', label: 'Last 24 hours', ms: 24 * 3600000 },
]

function statusToPhase(status) {
  if (status === 'IN_PROGRESS') return 'Operational'
  if (status === 'COMPLETED') return 'Post-Checking'
  return 'Pre-Checking'
}

function parseIso(value) {
  if (value == null || value === '') return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function formatRelativeTime(iso) {
  const d = parseIso(iso)
  if (!d) return '—'
  const sec = Math.floor((Date.now() - d.getTime()) / 1000)
  if (sec < 60) return 'just now'
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  return `${Math.floor(sec / 86400)}d ago`
}

function median(values) {
  const arr = Array.isArray(values) ? values.filter((n) => Number.isFinite(n)).slice() : []
  if (arr.length === 0) return null
  arr.sort((a, b) => a - b)
  const mid = Math.floor(arr.length / 2)
  if (arr.length % 2 === 1) return arr[mid]
  return (arr[mid - 1] + arr[mid]) / 2
}

function formatDurationHours(hours) {
  if (hours == null || !Number.isFinite(hours) || hours < 0) return '—'
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`
  if (hours >= 48) return `${(hours / 24).toFixed(1)}d`
  return `${hours.toFixed(1)}h`
}

export default function Dashboard() {
  const { current, forecast } = dashboardWeather
  const { selectedPortId, selectedPort } = usePortScope()
  const { canView } = useRbac()

  const [atBerth, setAtBerth] = useState([])
  const [allOps, setAllOps] = useState([])
  const [sis, setSis] = useState([])
  const [queue, setQueue] = useState([])
  const [berths, setBerths] = useState([])
  const [jetties, setJetties] = useState([])
  const [activityItems, setActivityItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [apiErr, setApiErr] = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [perfWindow, setPerfWindow] = useState('7d')

  const canViewActivityLog = canView('activity-log')

  const refresh = useCallback(async () => {
    if (selectedPortId == null) {
      setLoading(false)
      setAtBerth([])
      setAllOps([])
      setSis([])
      setQueue([])
      setBerths([])
      setJetties([])
      setActivityItems([])
      setApiErr(null)
      return
    }

    setLoading(true)
    setApiErr(null)
    const errs = []

    const run = async (label, fn) => {
      try {
        const v = await fn()
        return { ok: true, v }
      } catch (e) {
        errs.push(`${label}: ${e?.message || 'failed'}`)
        return { ok: false, v: null }
      }
    }

    const [
      rAtBerth,
      rOps,
      rSi,
      rAlloc,
      rJetties,
      ...activityResults
    ] = await Promise.all([
      run('at-berth', fetchAtBerth),
      run('operations', () => fetchOperations()),
      run('shipping instructions', fetchShippingInstructions),
      run('allocation', fetchAllocationOverview),
      run('jetties', () => fetchJetties(selectedPortId)),
      ...(canViewActivityLog
        ? ACTIVITY_PAGE_KEYS.map((pageKey) =>
            run(`activity:${pageKey}`, () => fetchActivityLogs({ pageKey, limit: 8 }))
          )
        : []),
    ])

    setAtBerth(Array.isArray(rAtBerth.v) ? rAtBerth.v : [])
    setAllOps(Array.isArray(rOps.v) ? rOps.v : [])
    setSis(Array.isArray(rSi.v) ? rSi.v : [])
    if (rAlloc.ok && rAlloc.v) {
      setQueue(Array.isArray(rAlloc.v.queue) ? rAlloc.v.queue : [])
      setBerths(Array.isArray(rAlloc.v.berths) ? rAlloc.v.berths : [])
    } else {
      setQueue([])
      setBerths([])
    }
    setJetties(Array.isArray(rJetties.v) ? rJetties.v : [])

    if (canViewActivityLog) {
      const merged = []
      for (const r of activityResults) {
        if (r.ok && r.v?.items) merged.push(...r.v.items)
      }
      merged.sort((a, b) => {
        const ta = parseIso(a.createdAt)?.getTime() ?? 0
        const tb = parseIso(b.createdAt)?.getTime() ?? 0
        return tb - ta
      })
      setActivityItems(merged.slice(0, 8))
    } else {
      setActivityItems([])
    }

    setApiErr(errs.length ? errs.join(' · ') : null)
    setLastUpdated(new Date())
    setLoading(false)
  }, [selectedPortId, canViewActivityLog])

  useEffect(() => {
    refresh()
  }, [refresh])

  const siStats = useMemo(() => {
    const list = Array.isArray(sis) ? sis : []
    const approved = list.filter((s) => s.status === 'Approved').length
    const submitted = list.filter((s) => s.status === 'Submitted').length
    return { total: list.length, approved, submitted }
  }, [sis])

  const opStats = useMemo(() => {
    const list = Array.isArray(allOps) ? allOps : []
    const by = (st) => list.filter((o) => o.status === st).length
    return {
      pending: by('PENDING'),
      allocated: by('ALLOCATED'),
      docked: by('DOCKED'),
      inProgress: by('IN_PROGRESS'),
      completed: by('COMPLETED'),
      sailed: by('SAILED'),
      exceptionPending: list.filter((o) => o.exceptionStatus === 'PENDING').length,
    }
  }, [allOps])

  /** Slot-based: Σ min(occupiedCount, capacity) / Σ capacity excluding Out of Service jetties */
  const slotOccupancy = useMemo(() => {
    const list = Array.isArray(berths) ? berths : []
    let totalSlots = 0
    let usedSlots = 0
    for (const b of list) {
      if ((b?.status || '') === 'Out of Service') continue
      const cap = b?.capacity != null ? Number(b.capacity) : 1
      const capN = Number.isFinite(cap) && cap >= 1 ? cap : 1
      const occ =
        b?.occupiedCount != null && Number.isFinite(Number(b.occupiedCount))
          ? Number(b.occupiedCount)
          : b?.currentVesselId
            ? 1
            : 0
      totalSlots += capN
      usedSlots += Math.min(Math.max(0, occ), capN)
    }
    const pct = totalSlots > 0 ? Math.round((usedSlots / totalSlots) * 100) : 0
    const overCapacity = usedSlots > totalSlots && totalSlots > 0
    return { totalSlots, usedSlots, pct, overCapacity }
  }, [berths])

  const slotOccupancyItems = useMemo(() => {
    const list = Array.isArray(berths) ? berths : []
    const out = []
    for (const b of list) {
      const jettyId = b?.id
      if (!jettyId) continue
      const capRaw = b?.capacity != null ? Number(b.capacity) : 1
      const cap = Number.isFinite(capRaw) && capRaw >= 1 ? capRaw : 1
      const occs = Array.isArray(b?.occupants) ? b.occupants : []
      for (let i = 0; i < Math.min(cap, occs.length); i += 1) {
        const occ = occs[i]
        const slotLabel = `${jettyId}-${String(i + 1).padStart(2, '0')}`
        const vesselName = (occ?.vesselName || '').trim() || String(occ?.vesselId || '—')
        out.push({ primary: `${slotLabel} — ${vesselName}` })
      }
      if (occs.length > cap) {
        out.push({ primary: `${jettyId}-${String(cap).padStart(2, '0')} — +${occs.length - cap} more` })
      }
    }
    return out
  }, [berths])

  const jettyStatusLists = useMemo(() => {
    const avail = []
    const oos = []
    for (const j of Array.isArray(jetties) ? jetties : []) {
      const name = (j?.name || '').trim()
      const shortId = name ? name.replace(/^Jetty\s+/i, '').trim() : ''
      const label = shortId || name || '—'
      if ((j?.status || '') === 'Out of Service') oos.push(label)
      else avail.push(label)
    }
    avail.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    oos.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    return { avail, oos }
  }, [jetties])

  const jettyStatusCounts = useMemo(() => {
    const m = { Available: 0, 'Out of Service': 0 }
    for (const j of jetties) {
      const s = j.status || 'Available'
      if (s === 'Out of Service') m['Out of Service'] += 1
      else m.Available += 1
    }
    return m
  }, [jetties])

  const atBerthCounts = useMemo(() => {
    const counts = {
      Loading: { 'Pre-Checking': 0, Operational: 0, 'Post-Checking': 0 },
      Unloading: { 'Pre-Checking': 0, Operational: 0, 'Post-Checking': 0 },
    }
    for (const o of atBerth) {
      const phase = statusToPhase(o.status)
      if (counts[o.purpose]) counts[o.purpose][phase] += 1
    }
    return counts
  }, [atBerth])

  const slaAtRisk = useMemo(() => {
    const now = Date.now()
    const risky = []
    for (const o of allOps) {
      if (['SAILED', 'PENDING', 'ALLOCATED'].includes(o.status)) continue
      const etc = parseIso(o.estimatedCompletionTime)
      if (!etc) continue
      if (etc.getTime() < now) {
        const overH = (now - etc.getTime()) / 3600000
        risky.push({ ...o, overHours: overH })
      }
    }
    risky.sort((a, b) => b.overHours - a.overHours)
    return risky.slice(0, 5)
  }, [allOps])

  const performance = useMemo(() => {
    const win = PERF_WINDOWS.find((w) => w.key === perfWindow) || PERF_WINDOWS[0]
    const cutoff = Date.now() - win.ms
    const tolMs = 6 * 3600000
    const list = Array.isArray(queue) ? queue : []

    const waitingHrs = []
    const waitingWorst = []

    const turnaroundHrs = []
    const turnaroundWorst = []

    let onTimeEligible = 0
    let onTimeCount = 0
    const onTimeLateList = []

    for (const r of list) {
      if (r?.shiftingOut) continue
      const vesselName = (r?.vesselName || '').trim() || `Op #${r?.operationId ?? r?.id ?? '—'}`
      const jettyName = (r?.jetty || '').trim() || '—'

      const ta = parseIso(r?.taDateTime)
      const tb = parseIso(r?.tbDateTime)
      const planned = parseIso(r?.plannedEtbDateTime)
      const castOff = parseIso(r?.castOffDateTime)
      const actualComp = parseIso(r?.actualCompletionDateTime)

      // Waiting time to berth (TA -> TB), windowed by TB.
      if (ta && tb && tb.getTime() > ta.getTime() && tb.getTime() >= cutoff) {
        const h = (tb.getTime() - ta.getTime()) / 3600000
        waitingHrs.push(h)
        waitingWorst.push({ vesselName, jettyName, hours: h })
      }

      // Turnaround time at berth (TB -> cast-off preferred; else actual completion), windowed by end time.
      if (tb) {
        const end = castOff || actualComp
        if (end && end.getTime() > tb.getTime() && end.getTime() >= cutoff) {
          const h = (end.getTime() - tb.getTime()) / 3600000
          turnaroundHrs.push(h)
          turnaroundWorst.push({ vesselName, jettyName, hours: h })
        }
      }

      // On-time berthing rate: TB <= planned ETB + 6h, windowed by TB.
      if (planned && tb && tb.getTime() >= cutoff) {
        onTimeEligible += 1
        const lateMs = tb.getTime() - (planned.getTime() + tolMs)
        if (lateMs <= 0) onTimeCount += 1
        else onTimeLateList.push({ vesselName, jettyName, lateHours: lateMs / 3600000 })
      }
    }

    waitingWorst.sort((a, b) => b.hours - a.hours)
    turnaroundWorst.sort((a, b) => b.hours - a.hours)
    onTimeLateList.sort((a, b) => b.lateHours - a.lateHours)

    // Show a value as soon as we have at least 1 eligible row; surface sample size in the UI.
    const minSample = 1
    const waitingMedian = waitingHrs.length >= minSample ? median(waitingHrs) : null
    const turnaroundMedian = turnaroundHrs.length >= minSample ? median(turnaroundHrs) : null
    const onTimeRate =
      onTimeEligible >= minSample ? Math.round((onTimeCount / Math.max(1, onTimeEligible)) * 100) : null

    return {
      window: win,
      minSample,
      waiting: { medianHours: waitingMedian, sampleSize: waitingHrs.length, worst: waitingWorst.slice(0, 10) },
      turnaround: {
        medianHours: turnaroundMedian,
        sampleSize: turnaroundHrs.length,
        worst: turnaroundWorst.slice(0, 10),
      },
      onTime: { ratePct: onTimeRate, eligible: onTimeEligible, onTime: onTimeCount, late: onTimeLateList.slice(0, 10) },
    }
  }, [queue, perfWindow])

  const plannedBerthingCount = useMemo(
    () => queue.filter(isPlannedBerthingQueueRow).length,
    [queue]
  )

  const pipelineCounts = {
    si: siStats.total,
    plannedBerthing: plannedBerthingCount,
    atBerth: atBerth.length,
    clearance: opStats.sailed,
  }

  const weatherFooter = (
    <section className="dashboard-weather-footer" aria-label="Weather preview">
      <div className="weather-card-wrap">
        <div className="card weather-card">
          <h2 className="card__title">Weather</h2>
          <p className="dashboard-mock-hint">Preview data — live API connection coming later.</p>
          <div className="weather-card__body">
            <div className="weather-card__main">
              <span className="weather-card__condition">{current.condition}</span>
              <span className="weather-card__temp">{current.temperature}°C</span>
              <span className="weather-card__meta">
                Wind {current.windKmh} km/h · {current.humidity}% humidity
              </span>
              {current.berthingImpact && (
                <p className="weather-card__berthing-note" role="status">
                  {current.berthingNote}
                </p>
              )}
            </div>
            <div className="weather-card__forecast">
              <span className="weather-card__forecast-label">Forecast</span>
              <ul className="weather-card__forecast-list">
                {forecast.map((day, i) => (
                  <li key={i} className="weather-card__forecast-item">
                    <span className="weather-card__forecast-day">{day.label}</span>
                    <span className="weather-card__forecast-condition">{day.condition}</span>
                    <span className="weather-card__forecast-temp">
                      {day.tempMin}°–{day.tempMax}°
                    </span>
                    <span className="weather-card__forecast-rain">{day.rainChance}% rain</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
        <div className="weather-card-overlay" aria-hidden="true">
          <span className="weather-card-overlay__watermark">Widget is in progress - Coming Soon</span>
        </div>
      </div>
    </section>
  )

  if (selectedPortId == null) {
    return (
      <div className="dashboard">
        <header className="dashboard-header">
          <h1 className="page-title">Dashboard</h1>
        </header>
        <div className="card dashboard-empty-state">
          <p className="text-steel">Select a port from the header to load dashboard data.</p>
        </div>
        {weatherFooter}
      </div>
    )
  }

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1 className="page-title">Dashboard</h1>
        <span className="dashboard-header__meta">
          {lastUpdated && (
            <>
              Last updated:{' '}
              {lastUpdated.toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}
            </>
          )}
        </span>
      </header>

      {selectedPort && (
        <div className="dashboard-port-chip" role="status">
          <span className="dashboard-port-chip__dot" aria-hidden />
          <span className="dashboard-port-chip__label">Port</span>
          <span className="dashboard-port-chip__name">{selectedPort.name}</span>
          <span className="dashboard-port-chip__meta">
            · {jetties.length} jetty{jetties.length === 1 ? '' : 'ies'}
          </span>
        </div>
      )}

      {apiErr && (
        <div className="dashboard-api-banner" role="alert">
          Some data could not be loaded: {apiErr}
        </div>
      )}

      <section className="card dashboard-pipeline">
        <h2 className="card__title">Vessel pipeline</h2>
        <p className="dashboard-pipeline__intro text-steel">
          Counts reflect the port selected above.
        </p>
        <div className="pipeline-flow" role="navigation" aria-label="Pipeline stages">
          {PIPELINE_STAGES.map((stage, index) => (
            <Fragment key={stage.id}>
              {index > 0 && (
                <span className="pipeline-arrow" aria-hidden>
                  →
                </span>
              )}
              <Link
                to={stage.path}
                className={`pipeline-stage pipeline-stage--${stage.color}`}
              >
                <span className="pipeline-stage__label">{stage.label}</span>
                <span className="pipeline-stage__count">
                  {stage.id === 'si' && pipelineCounts.si}
                  {stage.id === 'planned-berthing' && pipelineCounts.plannedBerthing}
                  {stage.id === 'at-berth' && pipelineCounts.atBerth}
                  {stage.id === 'clearance' && pipelineCounts.clearance}
                </span>
                <span className="pipeline-stage__sublabel">
                  {stage.id === 'si' && (
                    <>
                      {siStats.approved} approved · {siStats.total} total
                    </>
                  )}
                  {stage.id === 'planned-berthing' && <>Jetty assigned · not alongside</>}
                  {stage.id === 'at-berth' && <>By vessel alongside</>}
                  {stage.id === 'clearance' && <>Sailed (completed departures)</>}
                </span>
              </Link>
            </Fragment>
          ))}
        </div>
      </section>

      <section className="dashboard-row1">
        <div className="dashboard-row1__chart">
          <DashboardActivityChart queue={queue} sis={sis} loading={loading} />
        </div>

        <div className="dashboard-kpi-grid" aria-label="Key metrics for selected port">
          <div className="metric-card">
            <span className="metric-card__label">Slot occupancy</span>
            <span className="metric-card__value">
              {slotOccupancy.totalSlots > 0 ? (
                <>
                  {slotOccupancy.usedSlots}/{slotOccupancy.totalSlots}
                  <span className="metric-card__unit">{slotOccupancy.pct}%</span>
                </>
              ) : (
                '—'
              )}
            </span>
            <div className="metric-card__bar-wrap" role="presentation">
              <div
                className={`metric-card__bar${slotOccupancy.overCapacity ? ' metric-card__bar--over' : ''}`}
                style={{
                  width:
                    slotOccupancy.totalSlots > 0
                      ? `${Math.min(100, slotOccupancy.pct)}%`
                      : '0%',
                }}
              />
            </div>
            <span className="metric-card__type">
              Vessel positions (excl. out-of-service jetties){' '}
              <InteractiveTooltip
                title="Slots in use"
                subtitle="By jetty slot"
                items={slotOccupancyItems}
                emptyText="No occupied slots."
                maxWidth={360}
              >
                <span className="metric-card__type-link">Details</span>
              </InteractiveTooltip>
            </span>
            <Link to="/at-berth" className="metric-card__link">
              View at-berth →
            </Link>
          </div>
          <div className="metric-card">
            <span className="metric-card__label">Jetty status</span>
            <div className="metric-card__jetty-status" role="list" aria-label="Jetty status counts">
              <InteractiveTooltip
                title="Available jetties"
                items={jettyStatusLists.avail}
                emptyText="No available jetties."
              >
                <span className="metric-card__jetty-chip metric-card__jetty-chip--ok" role="listitem">
                  Available <strong>{jettyStatusCounts.Available}</strong>
                </span>
              </InteractiveTooltip>
              <InteractiveTooltip
                title="Out of service jetties"
                items={jettyStatusLists.oos}
                emptyText="No out of service jetties."
              >
                <span className="metric-card__jetty-chip metric-card__jetty-chip--bad" role="listitem">
                  Out of service <strong>{jettyStatusCounts['Out of Service']}</strong>
                </span>
              </InteractiveTooltip>
            </div>
          </div>
          <div className="metric-card">
            <span className="metric-card__label">Ready to sail</span>
            <span className="metric-card__value">{opStats.completed}</span>
            <Link to="/verification" className="metric-card__link">
              Clearance →
            </Link>
          </div>
          <div className="metric-card metric-card--risk">
            <span className="metric-card__label">SLA at risk</span>
            <InteractiveTooltip
              title="SLA at risk"
              subtitle="Past estimated completion"
              items={slaAtRisk.map((o) => ({
                primary: o.vesselName || `Op #${o.id}`,
                secondary: `${o.jettyName || '—'} · +${o.overHours < 1 ? `${Math.round(o.overHours * 60)}m` : `${o.overHours.toFixed(1)}h`} over ETC`,
              }))}
              emptyText="No operations past estimated completion."
              maxWidth={360}
            >
              <span className="metric-card__value">{slaAtRisk.length}</span>
            </InteractiveTooltip>
            <span className="metric-card__type">Past estimated completion</span>
          </div>
        </div>
      </section>

      <div className="dashboard-main-grid dashboard-main-grid--single">
        <div className="dashboard-main-column">
          <div className="dashboard-perf-row">
            <section className="card dashboard-performance">
              <div className="dashboard-performance__head">
                <h2 className="card__title">Performance</h2>
                <div className="dashboard-performance__toggle" role="group" aria-label="Performance window">
                  {PERF_WINDOWS.map((w) => (
                    <button
                      key={w.key}
                      type="button"
                      className={`dashboard-performance__toggle-btn${perfWindow === w.key ? ' is-active' : ''}`}
                      onClick={() => setPerfWindow(w.key)}
                    >
                      {w.key}
                    </button>
                  ))}
                </div>
              </div>

              {loading ? (
                <p className="text-steel">Loading…</p>
              ) : (
                <div className="dashboard-performance__grid" role="list" aria-label="Performance KPIs">
                  <div className="dashboard-performance__metric" role="listitem">
                    <div className="dashboard-performance__label">Waiting to berth</div>
                    <InteractiveTooltip
                      title="Longest waits (TA → TB)"
                      subtitle={`${performance.window.label} · n=${performance.waiting.sampleSize}`}
                      items={performance.waiting.worst.map((x) => ({
                        primary: `${x.vesselName} — ${x.jettyName}`,
                        secondary: `Wait: ${formatDurationHours(x.hours)}`,
                      }))}
                      emptyText="Not enough TA/TB data in this window."
                      maxWidth={360}
                    >
                      <div className="dashboard-performance__value">
                        {performance.waiting.medianHours == null
                          ? '—'
                          : formatDurationHours(performance.waiting.medianHours)}
                      </div>
                    </InteractiveTooltip>
                    <div className="dashboard-performance__sub">
                    Median (TA→TB) · {performance.window.key} · n={performance.waiting.sampleSize}
                    </div>
                  </div>

                  <div className="dashboard-performance__metric" role="listitem">
                    <div className="dashboard-performance__label">Turnaround</div>
                    <InteractiveTooltip
                      title="Longest turnarounds"
                      subtitle={`${performance.window.label} · n=${performance.turnaround.sampleSize}`}
                      items={performance.turnaround.worst.map((x) => ({
                        primary: `${x.vesselName} — ${x.jettyName}`,
                        secondary: `Turnaround: ${formatDurationHours(x.hours)}`,
                      }))}
                      emptyText="Not enough completion data in this window."
                      maxWidth={360}
                    >
                      <div className="dashboard-performance__value">
                        {performance.turnaround.medianHours == null
                          ? '—'
                          : formatDurationHours(performance.turnaround.medianHours)}
                      </div>
                    </InteractiveTooltip>
                    <div className="dashboard-performance__sub">
                    Median (TB→Cast‑off/Completion) · {performance.window.key} · n={performance.turnaround.sampleSize}
                    </div>
                  </div>

                  <div className="dashboard-performance__metric" role="listitem">
                    <div className="dashboard-performance__label">On‑time berthing</div>
                    <InteractiveTooltip
                      title="Late berthings (vs planned ETB +6h)"
                      subtitle={`${performance.window.label} · eligible=${performance.onTime.eligible}`}
                      items={performance.onTime.late.map((x) => ({
                        primary: `${x.vesselName} — ${x.jettyName}`,
                        secondary: `Late: +${formatDurationHours(x.lateHours)}`,
                      }))}
                      emptyText="No late berthings in this window."
                      maxWidth={360}
                    >
                      <div className="dashboard-performance__value">
                        {performance.onTime.ratePct == null ? '—' : `${performance.onTime.ratePct}%`}
                      </div>
                    </InteractiveTooltip>
                    <div className="dashboard-performance__sub">
                    TB within +6h of planned ETB · {performance.window.key} · eligible={performance.onTime.eligible}
                    </div>
                  </div>
                </div>
              )}
            </section>

            <section className="card dashboard-at-berth">
              <div className="dashboard-at-berth__head">
                <h2 className="card__title">At berth now</h2>
                <Link to="/at-berth" className="btn btn--small btn--primary">
                  View all
                </Link>
              </div>
              {loading ? (
                <p className="text-steel">Loading…</p>
              ) : (
                <>
                  <div className="at-berth-summary__groups at-berth-summary__groups--compact">
                    {PURPOSES.map(({ key: purpose, label }) => (
                      <div key={purpose} className="at-berth-summary__group">
                        <h3 className="at-berth-summary__group-title at-berth-summary__group-title--small">
                          {label}
                        </h3>
                        <div className="at-berth-summary__grid">
                          {PHASES.map((phase) => (
                            <div
                              key={phase}
                              className={`at-berth-card at-berth-card--${purpose.toLowerCase()} at-berth-card--compact`}
                              title={`${phase}: ${atBerthCounts[purpose][phase]}`}
                            >
                              <div className="at-berth-compact-stack" aria-label={`${PHASE_SHORT_LABEL[phase]} ${atBerthCounts[purpose][phase]}`}>
                                <span className="at-berth-compact-stack__icon" aria-hidden>
                                  {PHASE_EMOJI[phase]}
                                </span>
                                <span className="at-berth-compact-stack__label">{PHASE_SHORT_LABEL[phase]}</span>
                                <span className="at-berth-compact-stack__count">{atBerthCounts[purpose][phase]}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="dashboard-clearance-row dashboard-clearance-row--triple">
                    <Link
                      to="/verification"
                      className="dashboard-clearance-card dashboard-clearance-card--ready"
                    >
                      <span className="dashboard-clearance-card__icon" aria-hidden>
                        ⚓
                      </span>
                      <span className="dashboard-clearance-card__label">Ready to sail</span>
                      <span className="dashboard-clearance-card__count">{opStats.completed}</span>
                    </Link>
                    <div className="dashboard-clearance-card dashboard-clearance-card--departed">
                      <span className="dashboard-clearance-card__icon" aria-hidden>
                        🚀
                      </span>
                      <span className="dashboard-clearance-card__label">Sailed</span>
                      <span className="dashboard-clearance-card__count">{opStats.sailed}</span>
                    </div>
                    <div
                      className={`dashboard-clearance-card dashboard-clearance-card--exception ${opStats.exceptionPending > 0 ? 'dashboard-clearance-card--exception-active' : ''}`}
                    >
                      <span className="dashboard-clearance-card__icon" aria-hidden>
                        ⚠
                      </span>
                      <span className="dashboard-clearance-card__label">Exceptions pending</span>
                      <span className="dashboard-clearance-card__count">{opStats.exceptionPending}</span>
                    </div>
                  </div>
                </>
              )}
            </section>
          </div>

          <section className="card">
            <div className="dashboard-at-berth__head">
              <h2 className="card__title">Recent updates</h2>
            </div>
            {!canViewActivityLog ? (
              <p className="text-steel">Activity log is restricted for your role.</p>
            ) : loading ? (
              <p className="text-steel">Loading…</p>
            ) : activityItems.length === 0 ? (
              <p className="text-steel">No recent activity.</p>
            ) : (
              <ul className="dashboard-activity-feed">
                {activityItems.map((item) => (
                  <li key={`${item.id}-${item.pageKey}`} className="dashboard-activity-feed__item">
                    <span className="dashboard-activity-feed__dot" aria-hidden />
                    <div>
                      <div className="dashboard-activity-feed__summary">{item.summary}</div>
                      <div className="dashboard-activity-feed__meta">
                        {formatRelativeTime(item.createdAt)}
                        {item.actorUsername ? ` · ${item.actorUsername}` : ''}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Next arrivals / line-up widget removed (not used). */}
        </div>
      </div>

      {weatherFooter}
    </div>
  )
}
