import { Link } from 'react-router-dom'
import '../styles/allocation.css'

const MASTER_ITEMS = [
  {
    path: '/master/port',
    title: 'Port',
    description: 'Add and manage master port / site data.',
  },
  {
    path: '/master/jetty',
    title: 'Jetty',
    description: 'Add and manage master Jetty for each Port.',
  },
  {
    path: '/master/jetty-layout',
    title: 'Jetty Layout',
    description: 'Define how jetties are arranged in the Jetty Schematic for each port.',
  },
]

export default function Master() {
  return (
    <div className="allocation-page">
      <h1 className="page-title">Master Menu</h1>
      <p className="allocation-page__intro">
        Manage master data for ports and jetties.
      </p>

      <section className="reporting-list" aria-label="Master data">
        <div className="reporting-list__grid">
          {MASTER_ITEMS.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className="reporting-list__card card"
            >
              <h2 className="reporting-list__card-title">{item.title}</h2>
              <p className="reporting-list__card-desc">{item.description}</p>
              <span className="reporting-list__card-link">Open →</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}
