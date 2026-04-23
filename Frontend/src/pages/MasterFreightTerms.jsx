import { Link } from 'react-router-dom'
import '../styles/allocation.css'

const FREIGHT_TERM_OPTIONS = [
  { value: '', label: '—' },
  { value: 'PREPAID', label: 'PREPAID' },
  { value: 'COLLECT', label: 'COLLECT' },
  { value: 'AS_PER_CHARTER_PARTY', label: 'AS PER CHARTER PARTY' },
  { value: 'OTHER', label: 'OTHER' },
]

export default function MasterFreightTerms() {
  return (
    <div className="allocation-page">
      <h1 className="page-title">Master – Freight Terms</h1>
      <p className="allocation-page__intro">
        Freight terms are currently fixed in the backend (validation/check constraint).
      </p>
      <p className="text-steel" style={{ fontSize: 'var(--font-size-small)' }}>
        <Link to="/master" className="link">← Back to Master Menu</Link>
      </p>

      <section className="card at-berth-list-section">
        <div className="card__header-row">
          <h2 className="card__title">Freight Terms</h2>
        </div>

        <div className="table-wrap">
          <table className="data-table allocation-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Label</th>
              </tr>
            </thead>
            <tbody>
              {FREIGHT_TERM_OPTIONS.filter((o) => o.value).map((o) => (
                <tr key={o.value} className="allocation-table__row">
                  <td>
                    <strong>{o.value}</strong>
                  </td>
                  <td>{o.label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

