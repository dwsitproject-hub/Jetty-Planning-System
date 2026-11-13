import QcDecisionPill, { QcDecisionPillRow } from './QcDecisionPill'
import QcSampleLine from './QcSampleLine'
import { collapsedAttention } from '../../utils/samplingCommodity'

/** Collapsed multi-SI card badge: the decision that most needs attention across its SIs. */
export function qcGroupBadge(group) {
  const attention = collapsedAttention(group.children.flatMap((child) => child.commodities || []))
  return attention ? <QcDecisionPill decision={attention} /> : null
}

export function commodityLabel(row) {
  return row.commodityShortDisplay || row.commodityDisplay || row.commodity || '—'
}

/** QC Sampling detail under one SI in the queue: commodity, decisions, sample summary. */
export default function QcRowDetail({ row }) {
  return (
    <>
      <span className="qc-card__commodity">{commodityLabel(row)}</span>
      <QcDecisionPillRow commodities={row.commodities} />
      <QcSampleLine sampling={row.sampling} />
    </>
  )
}
