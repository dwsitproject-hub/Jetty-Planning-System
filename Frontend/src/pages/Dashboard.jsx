import { Link } from 'react-router-dom'
import {
  vessels,
  upcomingQueue,
  painPointTracker,
  dashboardMetrics,
  dashboardWeather,
  dashboardClearance,
  getAtBerthOperations,
  allocationPlan,
  nominations,
} from '../data/mockData'
import { useLoading, getLoadingPhaseIndex } from '../context/LoadingContext'
import '../styles/dashboard.css'
import '../styles/allocation.css'

const PHASE_LABELS = {
  3: 'Pre-Checking',
  4: 'Operational',
  5: 'Post-Checking',
  6: 'Post-Checking',
}

const PHASES = ['Pre-Checking', 'Operational', 'Post-Checking']
const PHASE_EMOJI = { 'Pre-Checking': '📋', Operational: '⚙️', 'Post-Checking': '✅' }
const PURPOSES = [{ key: 'Loading', label: 'Loading' }, { key: 'Unloading', label: 'Unloading' }]

const PIPELINE_STAGES = [
  { id: 'si', label: 'Shipping Instruction', path: '/shipping-instruction', color: 'si' },
  { id: 'allocation', label: 'Allocation', path: '/allocation', color: 'allocation' },
  { id: 'at-berth', label: 'At-Berth', path: '/at-berth', color: 'at-berth' },
  { id: 'clearance', label: 'Clearance', path: '/verification', color: 'clearance' },
]

const QUICK_LINKS = [
  { to: '/at-berth', label: 'At-Berth Executions' },
  { to: '/allocation', label: 'Allocation & Berthing' },
  { to: '/verification', label: 'Clearance' },
  { to: '/shipping-instruction', label: 'Shipping Instruction' },
]

function getVesselName(vesselId) {
  return vessels[vesselId]?.vesselName ?? vesselId
}

export default function Dashboard() {
  const { current, forecast } = dashboardWeather
  const { getSteps } = useLoading()

  const loadingOps = getAtBerthOperations('Loading').map((o) => ({ ...o, purpose: 'Loading' }))
  const unloadingOps = getAtBerthOperations('Unloading').map((o) => ({ ...o, purpose: 'Unloading' }))
  const atBerthVessels = [...loadingOps, ...unloadingOps]

  const vesselsWithPhase = atBerthVessels.map((v) => {
    const steps = getSteps(v.vesselId)
    const phaseIndex = getLoadingPhaseIndex(steps ?? null)
    const phaseLabel = PHASE_LABELS[phaseIndex] ?? 'Pre-Checking'
    return { ...v, phaseIndex, phaseLabel }
  })

  const atBerthCounts = {
    Loading: { 'Pre-Checking': 0, Operational: 0, 'Post-Checking': 0 },
    Unloading: { 'Pre-Checking': 0, Operational: 0, 'Post-Checking': 0 },
  }
  vesselsWithPhase.forEach((v) => {
    atBerthCounts[v.purpose][v.phaseLabel] += 1
  })

  const pipelineCounts = {
    si: nominations?.length ?? 0,
    allocation: allocationPlan?.length ?? 0,
    atBerth: atBerthVessels.length,
    clearance: dashboardClearance.departed,
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
        </span>
      </header>

      {/* Weather */}
      <section className="card weather-card">
        <h2 className="card__title">Weather</h2>
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

      {/* KPI row: 4 cards */}
      <div className="dashboard-kpi-row">
        <div className="metric-card">
          <span className="metric-card__label">Vessels at berth</span>
          <span className="metric-card__value">{atBerthVessels.length}</span>
          <Link to="/at-berth" className="metric-card__link">View →</Link>
        </div>
        <div className="metric-card">
          <span className="metric-card__label">Berth occupancy</span>
          <span className="metric-card__value">{occupancyPercent}<span className="metric-card__unit">%</span></span>
          <div className="metric-card__bar-wrap" role="presentation">
            <div className="metric-card__bar" style={{ width: `${occupancyPercent}%` }} />
          </div>
        </div>
        <div className="metric-card">
          <span className="metric-card__label">Avg pumping rate</span>
          <span className="metric-card__value">{pumpingRate} <span className="metric-card__unit">{pumpingUnit}</span></span>
          <span className="metric-card__trend">↑ 2% vs last week</span>
        </div>
        <div className="metric-card">
          <span className="metric-card__label">Clearance: Ready to Sail</span>
          <span className="metric-card__value">{dashboardClearance.readyToDepart}</span>
          <Link to="/verification" className="metric-card__link">View →</Link>
        </div>
      </div>

      {/* Pipeline */}
      <section className="card dashboard-pipeline">
        <h2 className="card__title">Vessel pipeline</h2>
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
            <span className="pipeline-stage__label">{PIPELINE_STAGES[3].label}</span>
            <span className="pipeline-stage__count">{pipelineCounts.clearance}</span>
          </Link>
        </div>
      </section>

      {/* Two columns */}
      <div className="dashboard__two-col">
        {/* Left: At-Berth + Clearance */}
        <div className="dashboard-left">
          <section className="card dashboard-at-berth">
            <div className="dashboard-at-berth__head">
              <h2 className="card__title">At-berth now</h2>
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
                <span className="dashboard-clearance-card__count">{dashboardClearance.readyToDepart}</span>
              </Link>
              <div className="dashboard-clearance-card dashboard-clearance-card--departed">
                <span className="dashboard-clearance-card__icon">🚀</span>
                <span className="dashboard-clearance-card__label">Sailed</span>
                <span className="dashboard-clearance-card__count">{dashboardClearance.departed}</span>
              </div>
            </div>
          </section>
        </div>

        {/* Right: Queue + Alerts */}
        <div className="dashboard-right">
          <section className="card">
            <h2 className="card__title">Upcoming queue</h2>
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
            <h2 className="card__title">Alerts & SLAs</h2>
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

      {/* Quick links */}
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
