import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  upcomingQueue,
  painPointTracker,
  dashboardMetrics,
  dashboardWeather,
  vessels,
} from '../data/mockData'
import { fetchAtBerth, fetchOperations } from '../api/operations'
import { fetchShippingInstructions } from '../api/shippingInstructions'
import '../styles/dashboard.css'
import '../styles/allocation.css'

const PHASES = ['Pre-Checking', 'Operational', 'Post-Checking']
const PHASE_EMOJI = { 'Pre-Checking': '📋', Operational: '⚙️', 'Post-Checking': '✅' }
const PURPOSES = [{ key: 'Loading', label: 'Loading' }, { key: 'Unloading', label: 'Unloading' }]

function statusToPhase(status) {
  if (status === 'IN_PROGRESS') return 'Operational'
  if (status === 'COMPLETED') return 'Post-Checking'
  return 'Pre-Checking'
}

const PIPELINE_STAGES = [
  { id: 'si', label: 'Shipping Instruction', path: '/shipping-instruction', color: 'si' },
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

function getVesselName(vesselId) {
  return vessels[vesselId]?.vesselName ?? vesselId
}

export default function Dashboard() {
  const { current, forecast } = dashboardWeather
  const [atBerth, setAtBerth] = useState([])
  const [siCount, setSiCount] = useState(0)
  const [allocCount, setAllocCount] = useState(0)
  const [readySail, setReadySail] = useState(0)
  const [sailed, setSailed] = useState(0)
  const [apiErr, setApiErr] = useState(null)
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(async () => {
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
    const [a, b, c, d, e, f] = await Promise.all([
      run('at-berth', fetchAtBerth),
      run('SIs', fetchShippingInstructions),
      run('ops', () => fetchOperations({ status: 'PENDING' })),
      run('ops', () => fetchOperations({ status: 'ALLOCATED' })),
      run('ops', () => fetchOperations({ status: 'COMPLETED' })),
      run('ops', () => fetchOperations({ status: 'SAILED' })),
    ])
    setAtBerth(Array.isArray(a.v) ? a.v : [])
    setSiCount(Array.isArray(b.v) ? b.v.length : 0)
    setAllocCount((Array.isArray(c.v) ? c.v.length : 0) + (Array.isArray(d.v) ? d.v.length : 0))
    setReadySail(Array.isArray(e.v) ? e.v.length : 0)
    setSailed(Array.isArray(f.v) ? f.v.length : 0)
    setApiErr(errs.length ? errs.join(' · ') : null)
    setLoaded(true)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const atBerthCounts = {
    Loading: { 'Pre-Checking': 0, Operational: 0, 'Post-Checking': 0 },
    Unloading: { 'Pre-Checking': 0, Operational: 0, 'Post-Checking': 0 },
  }
  atBerth.forEach((o) => {
    const phase = statusToPhase(o.status)
    if (atBerthCounts[o.purpose]) atBerthCounts[o.purpose][phase] += 1
  })

  const pipelineCounts = {
    si: siCount,
    allocation: allocCount,
    atBerth: atBerth.length,
    clearance: sailed,
  }

  const occupancyMetric = dashboardMetrics.find((m) => m.id === 'berth-occupancy')
  const pumpingMetric = dashboardMetrics.find((m) => m.id === 'avg-pumping-rate')
  const occupancyPercent = occupancyMetric?.value ?? 0
  const pumpingRate = pumpingMetric?.value ?? 0
  const pumpingUnit = pumpingMetric?.unit ?? 'MT/Hour'

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1 className="page-title">Dashboard</h1>
        <span className="dashboard-header__meta">
          Last updated: {new Date().toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}
          {' '}
          <button type="button" className="btn btn--small btn--secondary" onClick={refresh} disabled={!loaded}>Refresh API</button>
        </span>
      </header>
      {apiErr && <p className="text-steel" style={{ color: '#a60' }}>API: {apiErr}</p>}

      <section className="card weather-card">
        <h2 className="card__title">Weather (mock)</h2>
        <div className="weather-card__body">
          <div className="weather-card__main">
            <span className="weather-card__condition">{current.condition}</span>
            <span className="weather-card__temp">{current.temperature}°C</span>
            <span className="weather-card__meta">Wind {current.windKmh} km/h · {current.humidity}% humidity</span>
            {current.berthingImpact && (
              <p className="weather-card__berthing-note" role="alert">{current.berthingNote}</p>
            )}
          </div>
          <div className="weather-card__forecast">
            <span className="weather-card__forecast-label">Forecast</span>
            <ul className="weather-card__forecast-list">
              {forecast.map((day, i) => (
                <li key={i} className="weather-card__forecast-item">
                  <span className="weather-card__forecast-day">{day.label}</span>
                  <span className="weather-card__forecast-condition">{day.condition}</span>
                  <span className="weather-card__forecast-temp">{day.tempMin}°–{day.tempMax}°</span>
                  <span className="weather-card__forecast-rain">{day.rainChance}% rain</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <div className="dashboard-kpi-row">
        <div className="metric-card">
          <span className="metric-card__label">Vessels at berth (API)</span>
          <span className="metric-card__value">{atBerth.length}</span>
          <Link to="/at-berth" className="metric-card__link">View →</Link>
        </div>
        <div className="metric-card">
          <span className="metric-card__label">Berth occupancy (mock)</span>
          <span className="metric-card__value">{occupancyPercent}<span className="metric-card__unit">%</span></span>
          <div className="metric-card__bar-wrap" role="presentation">
            <div className="metric-card__bar" style={{ width: `${occupancyPercent}%` }} />
          </div>
        </div>
        <div className="metric-card">
          <span className="metric-card__label">Avg pumping rate (mock)</span>
          <span className="metric-card__value">{pumpingRate} <span className="metric-card__unit">{pumpingUnit}</span></span>
          <span className="metric-card__trend">↑ 2% vs last week</span>
        </div>
        <div className="metric-card">
          <span className="metric-card__label">Ready to Sail (API)</span>
          <span className="metric-card__value">{readySail}</span>
          <Link to="/verification" className="metric-card__link">Clearance →</Link>
        </div>
      </div>

      <section className="card dashboard-pipeline">
        <h2 className="card__title">Vessel pipeline (API counts)</h2>
        <div className="pipeline-flow" role="presentation">
          <Link to={PIPELINE_STAGES[0].path} className={`pipeline-stage pipeline-stage--${PIPELINE_STAGES[0].color}`}>
            <span className="pipeline-stage__label">{PIPELINE_STAGES[0].label}</span>
            <span className="pipeline-stage__count">{pipelineCounts.si}</span>
          </Link>
          <span className="pipeline-arrow" aria-hidden>→</span>
          <Link to={PIPELINE_STAGES[1].path} className={`pipeline-stage pipeline-stage--${PIPELINE_STAGES[1].color}`}>
            <span className="pipeline-stage__label">{PIPELINE_STAGES[1].label}</span>
            <span className="pipeline-stage__count">{pipelineCounts.allocation}</span>
          </Link>
          <span className="pipeline-arrow" aria-hidden>→</span>
          <Link to={PIPELINE_STAGES[2].path} className={`pipeline-stage pipeline-stage--${PIPELINE_STAGES[2].color}`}>
            <span className="pipeline-stage__label">{PIPELINE_STAGES[2].label}</span>
            <span className="pipeline-stage__count">{pipelineCounts.atBerth}</span>
          </Link>
          <span className="pipeline-arrow" aria-hidden>→</span>
          <Link to={PIPELINE_STAGES[3].path} className={`pipeline-stage pipeline-stage--${PIPELINE_STAGES[3].color}`}>
            <span className="pipeline-stage__label">{PIPELINE_STAGES[3].label} (sailed)</span>
            <span className="pipeline-stage__count">{pipelineCounts.clearance}</span>
          </Link>
        </div>
      </section>

      <div className="dashboard__two-col">
        <div className="dashboard-left">
          <section className="card dashboard-at-berth">
            <div className="dashboard-at-berth__head">
              <h2 className="card__title">At-berth now (API)</h2>
              <Link to="/at-berth" className="btn btn--small btn--primary">View all</Link>
            </div>
            <div className="at-berth-summary__groups at-berth-summary__groups--compact">
              {PURPOSES.map(({ key: purpose, label }) => (
                <div key={purpose} className="at-berth-summary__group">
                  <h3 className="at-berth-summary__group-title at-berth-summary__group-title--small">{label}</h3>
                  <div className="at-berth-summary__grid">
                    {PHASES.map((phase) => (
                      <div
                        key={phase}
                        className={`at-berth-card at-berth-card--${purpose.toLowerCase()} at-berth-card--compact`}
                      >
                        <span className="at-berth-card__title">{PHASE_EMOJI[phase]} {phase}</span>
                        <span className="at-berth-card__count">{atBerthCounts[purpose][phase]}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="dashboard-clearance-row">
              <Link to="/verification" className="dashboard-clearance-card dashboard-clearance-card--ready">
                <span className="dashboard-clearance-card__icon">⚓</span>
                <span className="dashboard-clearance-card__label">Ready to Sail</span>
                <span className="dashboard-clearance-card__count">{readySail}</span>
              </Link>
              <div className="dashboard-clearance-card dashboard-clearance-card--departed">
                <span className="dashboard-clearance-card__icon">🚀</span>
                <span className="dashboard-clearance-card__label">Sailed</span>
                <span className="dashboard-clearance-card__count">{sailed}</span>
              </div>
            </div>
          </section>
        </div>

        <div className="dashboard-right">
          <section className="card">
            <h2 className="card__title">Upcoming queue (mock)</h2>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Vessel</th>
                    <th>ETA</th>
                    <th>Product</th>
                    <th>Qty (MT)</th>
                    <th>Priority</th>
                  </tr>
                </thead>
                <tbody>
                  {upcomingQueue.map((row) => (
                    <tr key={row.vesselId}>
                      <td><strong>{getVesselName(row.vesselId)}</strong></td>
                      <td>{row.ETA}</td>
                      <td>{row.product}</td>
                      <td>{row.qty.toLocaleString()}</td>
                      <td>
                        {row.priority === 'HIGH' ? (
                          <span className="badge badge--high">{row.priority} ({row.priorityReason})</span>
                        ) : (
                          row.priority
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card dashboard-alerts">
            <h2 className="card__title">Alerts & SLAs (mock)</h2>
            <div className="dashboard-alerts__list">
              <div className="dashboard-alert dashboard-alert--warning">
                <span className="dashboard-alert__icon" aria-hidden>⚠️</span>
                <div className="dashboard-alert__body">
                  <strong className="dashboard-alert__title">Arrival to berth wait time</strong>
                  <p className="dashboard-alert__text">{painPointTracker.waitTimeDays} days (Arrived {painPointTracker.arrivalDate} → Berthed {painPointTracker.berthDate}). {painPointTracker.demurrageNote}</p>
                </div>
              </div>
              <div className="dashboard-alert dashboard-alert--info">
                <span className="dashboard-alert__icon" aria-hidden>ℹ️</span>
                <div className="dashboard-alert__body">
                  <strong className="dashboard-alert__title">Offloading SLA progress</strong>
                  <p className="dashboard-alert__text">{painPointTracker.offloadingSlaPercent}% complete. Target: {painPointTracker.offloadingSlaTargetHours}h | Actual: {painPointTracker.offloadingSlaActualHours}h</p>
                </div>
              </div>
              <div className="dashboard-alert dashboard-alert--info">
                <span className="dashboard-alert__icon" aria-hidden>ℹ️</span>
                <div className="dashboard-alert__body">
                  <strong className="dashboard-alert__title">Refinery feedstock</strong>
                  <p className="dashboard-alert__text">Shore Tank {painPointTracker.shoreTankId}: {painPointTracker.tankLevelCm.toLocaleString()} cm. {painPointTracker.feedstockActionNote}</p>
                </div>
              </div>
            </div>
          </section>
        </div>
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
