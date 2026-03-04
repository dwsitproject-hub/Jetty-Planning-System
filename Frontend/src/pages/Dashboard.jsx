import { vessels, upcomingQueue, painPointTracker, dashboardMetrics, dashboardWeather } from '../data/mockData'
import '../styles/dashboard.css'

function getVesselName(vesselId) {
  return vessels[vesselId]?.vesselName ?? vesselId
}

export default function Dashboard() {
  const { current, forecast } = dashboardWeather

  return (
    <div className="dashboard">
      <h1 className="page-title">Dashboard (WIP)</h1>

      {/* Weather card: full width, main info left + forecast right */}
      <section className="card weather-card">
        <h2 className="card__title">Weather</h2>
        <div className="weather-card__body">
          <div className="weather-card__main">
            <span className="weather-card__condition">{current.condition}</span>
            <span className="weather-card__temp">{current.temperature}°C</span>
            <span className="weather-card__meta">Wind {current.windKmh} km/h · {current.humidity}% humidity</span>
            {current.dockingImpact && (
              <p className="weather-card__docking-note" role="alert">{current.dockingNote}</p>
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

      {/* Metric cards */}
      <div className="dashboard-metrics">
        {dashboardMetrics.map((m) => (
          <div key={m.id} className="metric-card">
            <span className="metric-card__label">{m.label}</span>
            <span className="metric-card__value">
              {typeof m.value === 'number' && m.value >= 1000 ? m.value.toLocaleString() : m.value}
              <span className="metric-card__unit">{m.unit}</span>
            </span>
            <span className="metric-card__type">{m.valueType}</span>
            {m.managementAction && (
              <span className="metric-card__action">{m.managementAction}</span>
            )}
          </div>
        ))}
      </div>

      {/* Visibility & SLAs | Upcoming Queue side by side */}
      <div className="dashboard__two-col">
        <section className="card">
          <h2 className="card__title">🎯 Visibility & SLAs</h2>
          <div className="pain-points">
            <div className="alert pain-point">
              <strong>Arrival to Berth Wait Time:</strong> {painPointTracker.waitTimeDays} Days
              (Arrived {painPointTracker.arrivalDate} → Berthed {painPointTracker.berthDate}).
              <div className="pain-point__note">System Note: {painPointTracker.demurrageNote}</div>
            </div>
            <div className="pain-point pain-point--info">
              <strong>Offloading SLA Progress:</strong> {painPointTracker.offloadingSlaPercent}% Complete.
              <div className="pain-point__note">
                Target: {painPointTracker.offloadingSlaTargetHours} Hours | Actual: {painPointTracker.offloadingSlaActualHours} Hours.
              </div>
            </div>
            <div className="pain-point pain-point--info">
              <strong>Refinery Feedstock Alert:</strong> Shore Tank {painPointTracker.shoreTankId} is currently at <strong>{painPointTracker.tankLevelCm.toLocaleString()} cm</strong>.
              <div className="pain-point__note">Action: {painPointTracker.feedstockActionNote}</div>
            </div>
          </div>
        </section>

        <section className="card">
          <h2 className="card__title">Upcoming Queue</h2>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Vessel Name</th>
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
      </div>
    </div>
  )
}
