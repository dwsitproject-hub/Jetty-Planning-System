/**
 * Nested cargo-movement lines under one commodity row in the throughput modal.
 */
import { formatDateTimeDisplay } from '../../utils/formatDateTimeDisplay.js'

function fmtQty(n) {
  return n == null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: 1 })
}

export default function ThroughputCargoEntries({ entries }) {
  if (!entries?.length) {
    return <p className="text-steel mgmt-cargo-entries__empty">No cargo movement entries for this commodity.</p>
  }
  return (
    <table className="data-table mgmt-cargo-entries">
      <thead>
        <tr>
          <th>Entry</th>
          <th>Tank</th>
          <th>Start</th>
          <th>End</th>
          <th className="mgmt-r">Qty (MT)</th>
          <th className="mgmt-r">Rate (MT/h)</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((e) => (
          <tr key={e.key}>
            <td>Entry {e.entry}</td>
            <td>{e.tank}</td>
            <td>{e.startAt ? formatDateTimeDisplay(e.startAt) : '—'}</td>
            <td>{e.inProgress ? 'In progress' : (e.endAt ? formatDateTimeDisplay(e.endAt) : '—')}</td>
            <td className="mgmt-r">{fmtQty(e.qty)}</td>
            <td className="mgmt-r">{e.rate == null ? '—' : fmtQty(e.rate)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
