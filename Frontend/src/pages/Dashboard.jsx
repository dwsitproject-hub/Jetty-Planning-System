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
import '../styles/dashboard.css'
import '../styles/allocation.css'

const PHASES = ['Pre-Checking', 'Operational', 'Post-Checking']
const PHASE_EMOJI = { 'Pre-Checking': '📋', Operational: '⚙️', 'Post-Checking': '✅' }
const PURPOSES = [
  { key: 'Loading', label: 'Loading' },
  { key: 'Unloading', label: 'Unloading' },
]

const PIPELINE_STAGES = [
  { id: 'si', label: 'Shipping Instruction', path: '/shipping-instruction', color: 'si' },
  { id: 'planned-berthing', label: 'Planned berthing', path: '/allocation', color: 'planned-berthing' },
  { id: 'allocation', label: 'Allocation', path: '/allocation', color: 'allocation' },
  { id: 'at-berth', label: 'At-Berth', path: '/at-berth', color: 'at-berth' },
  { id: 'clearance', label: 'Clearance', path: '/verification', color: 'clearance' },
]

const QUICK_LINKS = [
  { to: '/at-berth', label: 'At-Berth Executions' },
  { to: '/e2e-console', label: 'E2E console' },
  { to: '/verification', label: 'Clearance' },
  { to: '/shipping-instruction', label: 'Shipping Instruction' },
]

const ACTIVITY_PAGE_KEYS = ['allocation', 'shipping-instruction', 'verification', 'at-berth', 'loading']

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

function hoursBetween(start, end = new Date()) {
  const a = parseIso(start)
  if (!a) return null
  return Math.max(0, (end.getTime() - a.getTime()) / 3600000)
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

/** Same idea as Allocation incoming + jetty: berth planned, not yet alongside. */
function isPlannedBerthingQueueRow(row) {
  const jetty = (row?.jetty || '').trim()
  if (!jetty) return false
  const hasTb = Boolean(row?.tbDateTime)
  const opStatus = String(row?.status || '').toUpperCase()
  if (hasTb || ['DOCKED', 'IN_PROGRESS', 'COMPLETED'].includes(opStatus)) return false
  return true
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

  const occupancy = useMemo(() => {
    const total = berths.length
    const occupied = berths.filter((b) => b.currentVesselId).length
    const pct = total ? Math.round((occupied / total) * 100) : 0
    return { total, occupied, pct }
  }, [berths])

  const jettyStatusCounts = useMemo(() => {
    const m = { Available: 0, Maintenance: 0, 'High-Priority': 0, 'Out of Service': 0 }
    for (const j of jetties) {
      const s = j.status || 'Available'
      if (m[s] !== undefined) m[s] += 1
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

  const awaitingBerth = useMemo(() => {
    const rows = queue.filter((r) => r.operationId && r.taDateTime && !r.tbDateTime)
    rows.sort((a, b) => {
      const ta = parseIso(a.taDateTime)?.getTime() ?? 0
      const tb = parseIso(b.taDateTime)?.getTime() ?? 0
      return ta - tb
    })
    return rows.slice(0, 6)
  }, [queue])

  const nextArrivals = useMemo(() => {
    const rows = [...queue].filter((r) => r.etaDateTime)
    rows.sort((a, b) => {
      const ea = parseIso(a.etaDateTime)?.getTime() ?? 0
      const eb = parseIso(b.etaDateTime)?.getTime() ?? 0
      return ea - eb
    })
    return rows.slice(0, 8)
  }, [queue])

  const plannedBerthingCount = useMemo(
    () => queue.filter(isPlannedBerthingQueueRow).length,
    [queue]
  )

  const pipelineCounts = {
    si: siStats.total,
    plannedBerthing: plannedBerthingCount,
    allocation: opStats.pending + opStats.allocated,
    atBerth: atBerth.length,
    clearance: opStats.sailed,
  }

  if (selectedPortId == null) {
    return (
      <div className="dashboard">
        <header className="dashboard-header">
          <h1 className="page-title">Dashboard</h1>
        </header>
        <div className="card dashboard-empty-state">
          <p className="text-steel">Select a port from the header to load dashboard data.</p>
        </div>
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
          <button
            type="button"
            className="btn btn--small btn--secondary"
            onClick={refresh}
            disabled={loading}
            aria-busy={loading}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
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

      <section className="dashboard-row1">
        <div className="card weather-card dashboard-row1__weather">
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

        <div className="dashboard-kpi-grid" aria-label="Key metrics for selected port">
          <div className="metric-card">
            <span className="metric-card__label">Jetty occupancy</span>
            <span className="metric-card__value">
              {occupancy.total > 0 ? (
                <>
                  {occupancy.occupied}/{occupancy.total}
                  <span className="metric-card__unit">{occupancy.pct}%</span>
                </>
              ) : (
                '—'
              )}
            </span>
            <div className="metric-card__bar-wrap" role="presentation">
              <div
                className="metric-card__bar"
                style={{ width: occupancy.total > 0 ? `${occupancy.pct}%` : '0%' }}
              />
            </div>
            <span className="metric-card__type">Busy berths / total jetties</span>
          </div>
          <div className="metric-card">
            <span className="metric-card__label">Vessels at berth</span>
            <span className="metric-card__value">{atBerth.length}</span>
            <Link to="/at-berth" className="metric-card__link">
              View at-berth →
            </Link>
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
            <span className="metric-card__value">{slaAtRisk.length}</span>
            <span className="metric-card__type">Past estimated completion</span>
          </div>
        </div>
      </section>

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
                  {stage.id === 'allocation' && pipelineCounts.allocation}
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
                  {stage.id === 'allocation' && (
                    <>
                      {opStats.pending} pending · {opStats.allocated} allocated
                    </>
                  )}
                  {stage.id === 'at-berth' && <>By vessel alongside</>}
                  {stage.id === 'clearance' && <>Sailed (completed departures)</>}
                </span>
              </Link>
            </Fragment>
          ))}
        </div>
      </section>

      <div className="dashboard__two-col dashboard-main-grid">
        <div className="dashboard-main-column">
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
                          >
                            <span className="at-berth-card__title">
                              {PHASE_EMOJI[phase]} {phase}
                            </span>
                            <span className="at-berth-card__count">{atBerthCounts[purpose][phase]}</span>
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

          <section className="card dashboard-sla-card">
            <div className="dashboard-sla-card__head">
              <h2 className="card__title">SLA &amp; schedule risk</h2>
              {slaAtRisk.length > 0 && (
                <span className="dashboard-badge-risk" aria-label={`${slaAtRisk.length} at risk`}>
                  {slaAtRisk.length}
                </span>
              )}
            </div>
            {loading ? (
              <p className="text-steel">Loading…</p>
            ) : slaAtRisk.length === 0 ? (
              <div className="dashboard-empty-inline">
                <span className="dashboard-empty-inline__icon" aria-hidden>
                  ✓
                </span>
                <p>No operations past estimated completion.</p>
              </div>
            ) : (
              <ul className="dashboard-risk-list">
                {slaAtRisk.map((o) => (
                  <li key={o.id}>
                    <Link to={`/loading/operation/${o.id}`} className="dashboard-risk-list__link">
                      <span className="dashboard-risk-list__vessel">{o.vesselName || `Op #${o.id}`}</span>
                      <span className="dashboard-risk-list__jetty">{o.jettyName || '—'}</span>
                      <span className="dashboard-risk-list__detail">
                        +{o.overHours < 1 ? `${Math.round(o.overHours * 60)}m` : `${o.overHours.toFixed(1)}h`}{' '}
                        over ETC
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card">
            <div className="dashboard-at-berth__head">
              <h2 className="card__title">Next arrivals / line-up</h2>
              <Link to="/allocation" className="btn btn--small btn--secondary">
                Allocation →
              </Link>
            </div>
            {loading ? (
              <p className="text-steel">Loading…</p>
            ) : nextArrivals.length === 0 ? (
              <p className="text-steel">No queued vessels with ETA.</p>
            ) : (
              <div className="table-wrap">
                <table className="data-table dashboard-table-compact">
                  <thead>
                    <tr>
                      <th>Vessel</th>
                      <th>Jetty</th>
                      <th>ETA</th>
                      <th>Purpose</th>
                      <th>Priority</th>
                    </tr>
                  </thead>
                  <tbody>
                    {nextArrivals.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <strong>{row.vesselName || '—'}</strong>
                        </td>
                        <td>{row.jetty || '—'}</td>
                        <td>{formatDateTimeDisplay(row.etaDateTime)}</td>
                        <td>{row.purpose || '—'}</td>
                        <td>{row.priority || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <aside className="dashboard-sidebar">
          <section className="card dashboard-jetty-health">
            <h2 className="card__title">Jetty status</h2>
            <div className="dashboard-jetty-chips" role="list">
              <span className="dashboard-jetty-chip dashboard-jetty-chip--ok" role="listitem">
                Available {jettyStatusCounts.Available}
              </span>
              <span className="dashboard-jetty-chip dashboard-jetty-chip--warn" role="listitem">
                Maintenance {jettyStatusCounts.Maintenance}
              </span>
              <span className="dashboard-jetty-chip dashboard-jetty-chip--priority" role="listitem">
                High-priority {jettyStatusCounts['High-Priority']}
              </span>
              <span className="dashboard-jetty-chip dashboard-jetty-chip--bad" role="listitem">
                Out of service {jettyStatusCounts['Out of Service']}
              </span>
            </div>
          </section>

          <section className="card">
            <h2 className="card__title">Awaiting berth</h2>
            <p className="text-steel dashboard-sidebar__hint">Vessels with arrival logged, not yet alongside.</p>
            {loading ? (
              <p className="text-steel">Loading…</p>
            ) : awaitingBerth.length === 0 ? (
              <p className="text-steel">None right now.</p>
            ) : (
              <ul className="dashboard-sidebar-list">
                {awaitingBerth.map((row) => {
                  const waitH = hoursBetween(row.taDateTime)
                  return (
                    <li key={row.id} className="dashboard-sidebar-list__item">
                      <div className="dashboard-sidebar-list__title">{row.vesselName || '—'}</div>
                      <div className="dashboard-sidebar-list__meta">
                        Wait {waitH != null ? `${waitH < 24 ? `${Math.round(waitH)}h` : `${Math.round(waitH / 24)}d`}` : '—'}
                        {row.priority === 'HIGH' && <span className="badge badge--high">HIGH</span>}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
            <Link to="/allocation" className="dashboard-sidebar__footer-link">
              Open allocation →
            </Link>
          </section>

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
        </aside>
      </div>

      <nav className="dashboard-quick-links" aria-label="Quick links">
        {QUICK_LINKS.map(({ to, label }) => (
          <Link key={to} to={to} className="dashboard-quick-link">
            {label} →
          </Link>
        ))}
      </nav>
    </div>
  )
}
