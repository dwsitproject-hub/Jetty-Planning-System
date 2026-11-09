import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatDateTimeDisplay } from '../../utils/formatDateTimeDisplay'
import { formatMaterialQtyLine } from '../../utils/ganttBarDisplay.js'
import { getBerthPurposeTone, getRailReasons, railKey } from '../../utils/berthColorState.js'

function cardProduct(row) {
  return (
    row.commodityShortDisplay ||
    row.commodityDisplay ||
    row.commodity ||
    row.materialDisplay ||
    null
  )
}

/**
 * Right-hand rail on the Berthing Plan: vessels with no jetty or no ETB (so they have no bar yet).
 * Each card is red ("New"). Dragging a card onto a jetty row is handled by JettyScheduleGantt,
 * which owns the timeline geometry, the confirm dialog, and the save.
 *
 * @param {object} props
 * @param {object[]} props.rows rail rows (see buildRailRows)
 * @param {boolean} props.canDrag user may edit the plan
 * @param {(row: object) => boolean} props.canScheduleRow the record can be saved from a drop
 * @param {(e: React.PointerEvent, row: object) => void} props.onCardPointerDown
 * @param {(row: object) => void} props.onSelect open the vessel detail
 */
export default function UnallocatedRail({
  rows,
  canDrag,
  canScheduleRow,
  onCardPointerDown,
  onSelect,
}) {
  const { t } = useTranslation('allocation')
  const [collapsed, setCollapsed] = useState(false)
  const count = rows.length
  const title = t('railTitle', { defaultValue: 'Unallocated' })

  return (
    <aside
      className={`unallocated-rail${collapsed ? ' unallocated-rail--collapsed' : ''}`}
      aria-label={title}
      data-testid="unallocated-rail"
    >
      <div className="unallocated-rail__header">
        <h3 className="unallocated-rail__title">
          <span className="unallocated-rail__title-text">{title}</span>
          <span
            className="unallocated-rail__count"
            aria-label={t('railCountLabel', { count, defaultValue: '{{count}} vessels' })}
          >
            {count}
          </span>
        </h3>
        <button
          type="button"
          className="unallocated-rail__toggle"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((v) => !v)}
          title={
            collapsed
              ? t('railExpand', { defaultValue: 'Show unallocated vessels' })
              : t('railCollapse', { defaultValue: 'Hide unallocated vessels' })
          }
        >
          {collapsed ? '‹' : '›'}
        </button>
      </div>

      {collapsed ? null : (
        <>
          <p className="unallocated-rail__hint">
            {canDrag
              ? t('railHint', {
                  defaultValue: 'No jetty or no ETB yet. Drag a vessel onto a jetty row to set its jetty and ETB.',
                })
              : t('railHintReadOnly', {
                  defaultValue: 'No jetty or no ETB yet. You can view these vessels but not schedule them.',
                })}
          </p>

          {count === 0 ? (
            <p className="unallocated-rail__empty">
              {t('railEmpty', { defaultValue: 'Every vessel has a jetty and an ETB.' })}
            </p>
          ) : (
            <ul className="unallocated-rail__list">
              {rows.map((row) => {
                const reasons = getRailReasons(row)
                const schedulable = canDrag && canScheduleRow(row)
                const product = cardProduct(row)
                const productLine = formatMaterialQtyLine(product, row.totalQtyDisplay)
                const purposeTone = getBerthPurposeTone(row.purpose, row.loadDischarge)
                const purposeLabel =
                  purposeTone === 'load'
                    ? t('ganttLegendLoad', { defaultValue: 'Load' })
                    : purposeTone === 'unload'
                      ? t('ganttLegendUnload', { defaultValue: 'Unload' })
                      : ''
                const reasonParts = reasons.map((r) =>
                  r === 'noJetty'
                    ? {
                        key: r,
                        label: t('railReasonJettyShort', { defaultValue: 'Jetty' }),
                        spoken: t('railReasonNoJetty', { defaultValue: 'No jetty' }),
                      }
                    : {
                        key: r,
                        label: t('railReasonEtbShort', { defaultValue: 'ETB' }),
                        spoken: t('railReasonNoEtb', { defaultValue: 'No ETB' }),
                      }
                )
                const reasonText = reasonParts.map((p) => p.spoken).join(', ')
                const etaText = row.etaDateTime
                  ? `ETA ${formatDateTimeDisplay(row.etaDateTime)}`
                  : t('railNoEta', { defaultValue: 'ETA not set' })
                const dragHint = schedulable
                  ? t('railDragCard', { defaultValue: 'Drag onto a jetty row to schedule.' })
                  : canDrag
                    ? t('railCannotSchedule', {
                        defaultValue: 'Open this vessel to schedule it. It cannot be dropped from here.',
                      })
                    : ''
                return (
                  <li key={railKey(row)}>
                    <button
                      type="button"
                      className={`unallocated-rail__card${schedulable ? ' unallocated-rail__card--draggable' : ''}`}
                      data-rail-card={railKey(row)}
                      aria-label={`${row.vesselName || '—'}. ${reasonText}. ${dragHint}`.trim()}
                      title={[reasonText, dragHint].filter(Boolean).join(' ')}
                      onPointerDown={schedulable ? (e) => onCardPointerDown(e, row) : undefined}
                      onClick={() => onSelect(row)}
                    >
                      <span className="unallocated-rail__title-row">
                        <span className="unallocated-rail__name">{row.vesselName || '—'}</span>
                        {purposeLabel ? (
                          <span
                            className={`unallocated-rail__purpose unallocated-rail__purpose--${purposeTone}`}
                          >
                            {purposeLabel}
                          </span>
                        ) : null}
                      </span>
                      {productLine ? (
                        <span className="unallocated-rail__meta">{productLine}</span>
                      ) : null}
                      <span className="unallocated-rail__eta-row">
                        <span className="unallocated-rail__eta">{etaText}</span>
                        {reasonParts.map((p) => (
                          <span key={p.key} className="unallocated-rail__reason">
                            {p.label}
                          </span>
                        ))}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}
    </aside>
  )
}
