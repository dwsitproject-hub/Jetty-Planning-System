import { qualityComparison } from '../data/mockData'

export default function Quality() {
  const { loading, discharge } = qualityComparison

  return (
    <div>
      <h1 className="page-title">Quality</h1>

      <section className="card">
        <h2 className="card__title">CPO Analysis — Loading vs Discharge</h2>
        <p style={{ color: 'var(--color-text-steel)', marginBottom: 'var(--spacing-4)', fontSize: 'var(--font-size-small)' }}>
          FFA, DOBI, IV per shipment. Compare loading quality to discharge quality.
        </p>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Parameter</th>
                <th>Loading Quality</th>
                <th>Discharge Quality</th>
                <th>Δ</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>FFA</strong></td>
                <td>{loading.FFA}</td>
                <td>{discharge.FFA}</td>
                <td>{(discharge.FFA - loading.FFA).toFixed(2)}</td>
              </tr>
              <tr>
                <td><strong>DOBI</strong></td>
                <td>{loading.DOBI}</td>
                <td>{discharge.DOBI}</td>
                <td>{(discharge.DOBI - loading.DOBI).toFixed(0)}</td>
              </tr>
              <tr>
                <td><strong>IV</strong></td>
                <td>{loading.IV}</td>
                <td>{discharge.IV}</td>
                <td>{(discharge.IV - loading.IV).toFixed(0)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p style={{ marginTop: 'var(--spacing-3)', fontSize: 'var(--font-size-small)', color: 'var(--color-text-steel)' }}>
          Upload CPO analysis (mock): use real upload when backend is connected.
        </p>
      </section>
    </div>
  )
}
