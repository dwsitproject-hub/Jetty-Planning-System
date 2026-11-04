import { useTranslation } from 'react-i18next'
import { decisionTone } from '../../utils/samplingCommodity'

export default function QcDecisionPill({ decision, remark }) {
  const { t } = useTranslation('qc')
  if (!decision) return null
  const key = decision === 'reject' || decision === 'out' ? decision : decision
  return (
    <span className={`qc-decision qc-decision--${decisionTone(decision) || decision}`} title={remark || undefined}>
      {t(`decision.${key}`)}
    </span>
  )
}

export function QcDecisionPillRow({ commodities }) {
  const flagged = (commodities || []).filter((c) => c.decision)
  if (flagged.length === 0) return null
  return (
    <span className="qc-decision-row">
      {flagged.map((card) => (
        <span key={card.commodityId} className="qc-decision-item">
          {card.shortName || card.name ? (
            <span className="qc-decision-item__name">{card.shortName || card.name}</span>
          ) : null}
          <QcDecisionPill decision={card.decision} remark={card.remark} />
        </span>
      ))}
    </span>
  )
}
