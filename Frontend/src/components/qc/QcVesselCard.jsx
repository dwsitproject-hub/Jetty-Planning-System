import { useTranslation } from 'react-i18next'
import PurposeBadge from '../PurposeBadge'
import { formatDateTimeDisplay } from '../../utils/formatDateTimeDisplay'
import QcStatusChip from './QcStatusChip'

export function siLabel(row) {
  return row.shippingInstruction || row.jettyOperationCode || `Operation ${row.operationId}`
}

export function purposeNode(purposes) {
  if (purposes.length === 0) return '—'
  return purposes.map((p) => <PurposeBadge key={p} purpose={p} abbrev={purposes.length > 1} />)
}

/**
 * One vessel call on the phone queue: single-SI cards open directly, multi-SI cards expand into SI rows.
 * `renderDetail(row)` draws the per-SI detail; `groupBadge(group)` an optional collapsed-card badge.
 */
export default function QcVesselCard({ group, expanded, onToggle, onOpen, ns, statusOf, renderDetail, groupBadge }) {
  const { t } = useTranslation(ns)
  const multi = group.siCount > 1
  const head = group.children[0]
  const tb = group.tbMs != null ? formatDateTimeDisplay(new Date(group.tbMs).toISOString()) : null
  const activate = () => (multi ? onToggle(group.key) : onOpen(head))

  return (
    <article className="operator-vessel-card qc-card">
      <div
        className="operator-vessel-card__main"
        role="button"
        tabIndex={0}
        onClick={activate}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            activate()
          }
        }}
      >
        <div className="qc-card__top">
          <div className="operator-vessel-card__name">{group.vesselName}</div>
          <QcStatusChip status={group.status} ns={ns} />
        </div>
        <div className="operator-vessel-card__meta">
          <span className="qc-card__jetty">
            {t('queue.jettyPrefix')} {group.jetty}
          </span>
          <span className="operator-vessel-card__purpose">{purposeNode(group.purposes)}</span>
          {tb ? (
            <span>
              {t('queue.tbPrefix')} {tb}
            </span>
          ) : null}
        </div>
        {multi ? (
          <>
            <div className="operator-vessel-card__row">
              {t('queue.doneOf', { done: group.doneCount, total: group.siCount })}
            </div>
            {!expanded && groupBadge ? groupBadge(group) : null}
          </>
        ) : (
          renderDetail(head)
        )}
      </div>

      {multi ? (
        <>
          <button type="button" className="operator-vessel-card__si-toggle" onClick={() => onToggle(group.key)}>
            {expanded ? t('queue.hideSi') : t('queue.chooseSi')}
          </button>
          {expanded ? (
            <div className="operator-vessel-card__children">
              {group.children.map((child) => (
                <button
                  key={child.operationId}
                  type="button"
                  className="operator-vessel-card__child qc-si-row"
                  onClick={() => onOpen(child)}
                >
                  <span className="qc-si-row__body">
                    <span className="operator-vessel-card__child-main">
                      <PurposeBadge purpose={child.purpose} loadDischarge={child.loadDischarge} abbrev />
                      <span>{siLabel(child)}</span>
                    </span>
                    {renderDetail(child)}
                  </span>
                  <span className="qc-si-row__side">
                    <QcStatusChip status={statusOf(child)} ns={ns} />
                    <span>{t('queue.open')}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </article>
  )
}
