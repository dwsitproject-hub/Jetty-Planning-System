import { useTranslation } from 'react-i18next'
import { formatDateTimeDisplay } from '../../utils/formatDateTimeDisplay'
import { QcDecisionPillRow } from './QcDecisionPill'
import QcSampleLine from './QcSampleLine'
import QcStatusChip from './QcStatusChip'
import { purposeNode, siLabel } from './QcVesselCard'

function commodityLabel(row) {
  return row.commodityShortDisplay || row.commodityDisplay || row.commodity || '—'
}

/** Compact, selectable queue entry for the desktop pane. Multi-SI vessels expand into SI rows. */
export default function QcQueueRow({ group, expanded, onToggle, selectedOperationId, onSelect }) {
  const { t } = useTranslation('qc')
  const multi = group.siCount > 1
  const head = group.children[0]
  const holdsSelection = group.children.some((c) => c.operationId === selectedOperationId)
  const open = expanded || holdsSelection
  const tb = group.tbMs != null ? formatDateTimeDisplay(new Date(group.tbMs).toISOString()) : null
  const selected = !multi && holdsSelection

  return (
    <li className="qc-row-group">
      <button
        type="button"
        className={`qc-row${selected ? ' qc-row--selected' : ''}${multi && holdsSelection ? ' qc-row--holds' : ''}`}
        aria-expanded={multi ? open : undefined}
        aria-current={selected ? 'true' : undefined}
        onClick={() => (multi ? onToggle(group.key) : onSelect(head))}
      >
        <span className="qc-row__top">
          <span className="qc-row__name">{group.vesselName}</span>
          <QcStatusChip status={group.status} />
        </span>
        <span className="qc-row__meta">
          <span className="qc-card__jetty">
            {t('queue.jettyPrefix')} {group.jetty}
          </span>
          <span className="operator-vessel-card__purpose">{purposeNode(group.purposes)}</span>
          {tb ? (
            <span>
              {t('queue.tbPrefix')} {tb}
            </span>
          ) : null}
        </span>
        {multi ? (
          <span className="qc-row__meta">{t('queue.sampledOf', { done: group.sampledCount, total: group.siCount })}</span>
        ) : (
          <>
            <span className="qc-card__commodity">{commodityLabel(head)}</span>
            <QcDecisionPillRow commodities={head.commodities} />
            <QcSampleLine sampling={head.sampling} />
          </>
        )}
      </button>

      {multi && open ? (
        <ul className="qc-row__children">
          {group.children.map((child) => {
            const active = child.operationId === selectedOperationId
            return (
              <li key={child.operationId}>
                <button
                  type="button"
                  className={`qc-row qc-row--child${active ? ' qc-row--selected' : ''}`}
                  aria-current={active ? 'true' : undefined}
                  onClick={() => onSelect(child)}
                >
                  <span className="qc-row__top">
                    <span className="operator-vessel-card__child-main">
                      <span>{siLabel(child)}</span>
                    </span>
                    <QcStatusChip status={child.sampling?.status} />
                  </span>
                  <span className="qc-card__commodity">{commodityLabel(child)}</span>
                  <QcDecisionPillRow commodities={child.commodities} />
                  <QcSampleLine sampling={child.sampling} />
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </li>
  )
}
