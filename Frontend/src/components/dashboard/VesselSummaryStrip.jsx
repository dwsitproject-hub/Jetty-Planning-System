/**
 * One compact row of fleet totals above the By Vessel table. Uses the table's own column names.
 */
const fmtNum = (n, d) => (n == null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: d }))

export default function VesselSummaryStrip({ summary }) {
  const tiles = [
    { label: 'Vessels', value: fmtNum(summary.vessels, 0) },
    { label: 'Voyages', value: fmtNum(summary.voyages, 0) },
    { label: 'Moved (MT)', value: fmtNum(summary.moved, 0) },
    { label: 'Avg achieved rate', value: fmtNum(summary.rate, 1), unit: 'MT/h' },
    { label: 'Avg active rate', value: fmtNum(summary.activeRate, 1), unit: 'MT/h' },
  ]
  return (
    <div className="mgmt-vsum" role="group" aria-label="Fleet summary">
      {tiles.map((t) => (
        <div key={t.label} className="mgmt-vsum__tile">
          <span className="mgmt-vsum__lbl">{t.label}</span>
          <span className="mgmt-vsum__val">
            {t.value}
            {t.unit && t.value !== '—' ? <span className="mgmt-vsum__unit"> {t.unit}</span> : null}
          </span>
        </div>
      ))}
    </div>
  )
}
