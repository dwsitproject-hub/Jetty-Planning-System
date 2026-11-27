/**
 * By Vessel drill-down: the figures moved out of the main table, two charts, then the same
 * Incoming / Outgoing voyage tables as By Voyage.
 */
import { fmtMgmtCastOffDate } from '../../utils/managementDashboardMetricEvidence.js'
import { fmtMgmtDurationDays, fmtMgmtDurationHours } from './ManagementProductTable.jsx'
import { RateBarsChart, TimeSplitChart } from './VesselDetailCharts.jsx'
import { VoyageBlock, statusChip } from './VoyageDrilldownTable.jsx'

const fmtNum = (n, d) => (n == null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: d }))

function statsOf(v, breakdown) {
  const commodity = v.movedLines.map((l) => (l.qty == null ? l.label : `${l.label} ${fmtNum(l.qty, 0)} MT`)).join(' · ')
  return [
    ['Commodity', commodity || '—'],
    ['Jetties', v.jetties.join(', ') || '—'],
    ['Avg wait', fmtMgmtDurationDays(v.wait)],
    ['Avg berth → start cargo', fmtMgmtDurationDays(v.pre)],
    ...(breakdown ? [['Total downtime (h)', v.downtimeH == null ? '—' : `${fmtNum(v.downtimeH, 1)} h`]] : []),
    ['Avg cargo done → sailed off', fmtMgmtDurationHours(v.cargoDoneToSailH)],
    ['Last completed', fmtMgmtCastOffDate(v.lastCastOff)],
    ['Status', v.alongside ? statusChip(v.alongside) : <span className="mgmt-chip mgmt-chip--ghost">Sailed</span>],
  ]
}

export default function VesselDetail({ vessel, voyageBlockProps }) {
  const breakdown = !!voyageBlockProps?.breakdown
  const incoming = vessel.voyages.filter((r) => r.purpose !== 'Loading')
  const outgoing = vessel.voyages.filter((r) => r.purpose === 'Loading')
  return (
    <div className="mgmt-vdetail">
      <dl className="mgmt-vdetail__stats">
        {statsOf(vessel, breakdown).map(([label, value]) => (
          <div key={label} className="mgmt-vdetail__stat">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="mgmt-vdetail__charts">
        <TimeSplitChart voyages={vessel.voyages} split={breakdown} />
        <RateBarsChart voyages={vessel.voyages} average={vessel.rate} />
      </div>
      <h4 className="mgmt-vchart__title">Voyage details</h4>
      {incoming.length ? <VoyageBlock title="Incoming" chipClass="mgmt-chip--disch" rows={incoming} {...voyageBlockProps} /> : null}
      {outgoing.length ? <VoyageBlock title="Outgoing" chipClass="mgmt-chip--load" rows={outgoing} {...voyageBlockProps} /> : null}
    </div>
  )
}
