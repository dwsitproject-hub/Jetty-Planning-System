import { Link } from 'react-router-dom'
import '../styles/allocation.css'

const ADMIN_ITEMS = [
  {
    path: '/admin/users',
    title: 'User Management',
    description: 'Manage users and assign roles.',
  },
  {
    path: '/admin/roles',
    title: 'Role Management',
    description: 'Define roles and page permissions.',
  },
]

export default function Admin() {
  return (
    <div className="allocation-page">
      <h1 className="page-title">Admin</h1>
      <p className="allocation-page__intro">
        User management and RBAC: users and roles.
      </p>

      <section className="reporting-list" aria-label="Admin sections">
        <div className="reporting-list__grid">
          {ADMIN_ITEMS.map((item) => (
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
