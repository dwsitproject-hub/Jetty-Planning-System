/**
 * Two-timestamp detail under a berth or wait row.
 */
import { formatDateTimeDisplay } from '../../utils/formatDateTimeDisplay.js'

export default function ModalTimeDetail({ fields }) {
  return (
    <table className="data-table mgmt-cargo-entries">
      <thead>
        <tr>
          {fields.map((f) => <th key={f.label}>{f.label}</th>)}
        </tr>
      </thead>
      <tbody>
        <tr>
          {fields.map((f) => (
            <td key={f.label}>{f.value ? formatDateTimeDisplay(f.value) : '—'}</td>
          ))}
        </tr>
      </tbody>
    </table>
  )
}
