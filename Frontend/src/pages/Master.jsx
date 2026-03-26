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
    title: 'Preferred Jetty',
    description: 'Add and manage master jetty options per port (used as Preferred Jetty).',
  },
  {
    path: '/master/jetty-layout',
    title: 'Jetty Layout',
    description: 'Define how jetties are arranged in the Jetty Schematic for each port.',
  },
  {
    path: '/master/si-term',
    title: 'SI Term',
    description: 'Add and manage trade terms (Terms) for Shipping Instructions.',
  },
  {
    path: '/master/si-shipper',
    title: 'SI Shipper',
    description: 'Add and manage shippers for Shipping Instructions.',
  },
  {
    path: '/master/si-loading-port',
    title: 'SI Loading Port',
    description: 'Add and manage loading ports for Shipping Instructions.',
  },
  {
    path: '/master/si-surveyor',
    title: 'SI Surveyor',
    description: 'Add and manage surveyors for Shipping Instructions.',
  },
  {
    path: '/master/si-agent',
    title: 'SI Agent',
    description: 'Add and manage agents for Shipping Instructions.',
  },
  {
    path: '/master/si-commodity',
    title: 'SI Commodity',
    description: 'Add and manage commodities for Shipping Instructions.',
  },
  {
    path: '/master/freight-terms',
    title: 'Freight Terms',
    description: 'View currently fixed freight terms used by the SI module.',
  },
]

export default function Master() {
  return (
    <div className="allocation-page">
      <h1 className="page-title">Master Menu</h1>
      <p className="allocation-page__intro">
        Manage master data for ports, jetties, and SI dropdowns.
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
