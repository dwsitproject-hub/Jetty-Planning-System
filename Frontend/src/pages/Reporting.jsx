import { Link } from 'react-router-dom'
import '../styles/allocation.css'

const REPORTS = [
  {
    path: '/reporting/daily-activities',
    title: 'Daily Activities Report',
    description: 'End-to-end activities from Vessel Arrived (TA) until Vessel Cast Off / Sailed. Header, timelog, and progress loading/unloading.',
  },
  {
    path: '/reporting/vessel',
    title: 'Jetty - Vessel Report',
    description: 'List of vessels and their details that have been allocated and berthed into a jetty. Filter by date range and jetty.',
  },
]

export default function Reporting() {
  return (
    <div className="allocation-page">
      <h1 className="page-title">Reporting</h1>
      <p className="allocation-page__intro">
        Select a report to view. Use date range and optional vessel or jetty filters where applicable.
      </p>

      <section className="reporting-list" aria-label="Reports">
        <div className="reporting-list__grid">
          {REPORTS.map((report) => (
            <Link
              key={report.path}
              to={report.path}
              className="reporting-list__card card"
            >
              <h2 className="reporting-list__card-title">{report.title}</h2>
              <p className="reporting-list__card-desc">{report.description}</p>
              <span className="reporting-list__card-link">View report →</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}
