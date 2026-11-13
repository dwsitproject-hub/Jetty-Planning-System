import { useTranslation } from 'react-i18next'
import { formatDateTimeDisplay } from '../../utils/formatDateTimeDisplay'
import QcStatusChip from './QcStatusChip'
import { purposeNode, siLabel } from './QcVesselCard'

/**
 * Compact, selectable queue entry for the desktop pane. Multi-SI vessels expand into SI rows.
 * `ns`, `statusOf` and `renderDetail` let each field menu (QC Sampling, Custom Clearance) supply
 * its own wording, step status and per-SI detail.
 */
export default function QcQueueRow({ group, expanded, onToggle, selectedOperationId, onSelect, ns, statusOf, renderDetail }) {
  const { t } = useTranslation(ns)
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
          <QcStatusChip status={group.status} ns={ns} />
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
          <span className="qc-row__meta">{t('queue.doneOf', { done: group.doneCount, total: group.siCount })}</span>
        ) : (
          renderDetail(head)
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
                    <QcStatusChip status={statusOf(child)} ns={ns} />
                  </span>
                  {renderDetail(child)}
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </li>
  )
}
