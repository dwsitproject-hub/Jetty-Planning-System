import { formatDateTimeDisplay } from '../../utils/formatDateTimeDisplay.js'
import { rateEvidenceSections } from '../../utils/managementDashboardRateEvidence.js'

/** Gross / net / normal / kuras rates and stop hours of one voyage (net-rate feature). */
export default function RateBreakdownPanel({ row }) {
  const sections = rateEvidenceSections(row, formatDateTimeDisplay)
  if (!sections.length) {
    return <p className="mgmt-product-metric-evidence__note text-steel">No rate breakdown for this voyage yet.</p>
  }
  return (
    <>
      <div className="mgmt-product-metric-evidence__tables">
        {sections.map((section) => (
          <div key={section.key} className="mgmt-product-metric-evidence__section">
            <p className="mgmt-product-metric-evidence__section-title">{section.title}</p>
            <table className="mgmt-product-metric-evidence__kv">
              <tbody>
                {section.rows.map((r) => (
                  <tr key={r.label} data-kind={r.kind || 'default'}>
                    <th scope="row">{r.label}</th>
                    <td>{r.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
      <p className="mgmt-product-metric-evidence__note text-steel">
        Net rate leaves out stops recorded during cargo. Normal and kuras rates split the moved quantity at the kuras start of each entry.
      </p>
    </>
  )
}
