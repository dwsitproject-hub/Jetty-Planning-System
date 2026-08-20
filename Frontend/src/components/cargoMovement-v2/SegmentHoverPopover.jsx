import { createPortal } from 'react-dom'
import { AlertCircle } from 'lucide-react'
import { formatDateTimeDisplay } from '../../utils/formatDateTimeDisplay.js'
import { formatMass } from './cargoMovementFilters.js'

const QTY_EPSILON = 1e-6

export default function SegmentHoverPopover({ segment, timezone, t, anchor, onClose }) {
  if (!segment || !anchor) return null

  const hasDiscrepancy =
    segment.atgAuditStatus === 'qty_mismatch' ||
    (segment.qty != null &&
      segment.atgMassDelta != null &&
      Math.abs(segment.qty - segment.atgMassDelta) > QTY_EPSILON)

  const modeLabel =
    segment.atgQtyMode === 'manual'
      ? t('cargoMovementBadgeManual')
      : segment.qtySource === 'atg'
        ? t('cargoMovementBadgeAtg')
        : t('cargoMovementBadgeWarn')

  return createPortal(
    <div
      className="fixed z-50 w-72 rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-lg"
      style={{ left: anchor.x + 12, top: anchor.y + 12 }}
      onMouseLeave={onClose}
      role="tooltip"
    >
      <div className="font-semibold text-slate-900">{segment.vesselName}</div>
      <dl className="mt-2 space-y-1 text-xs text-slate-600">
        <div className="flex justify-between gap-2">
          <dt>{t('cargoMovementTipWindow')}</dt>
          <dd className="text-right">
            {formatDateTimeDisplay(segment.startAt, timezone)}
            <br />
            → {segment.endAt ? formatDateTimeDisplay(segment.endAt, timezone) : t('cargoMovementOpen')}
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>{t('cargoMovementTipQty')}</dt>
          <dd>{formatMass(segment.qty)} MT</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>{t('cargoMovementTipMode')}</dt>
          <dd>{modeLabel}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>{t('cargoMovementTipAtgDelta')}</dt>
          <dd>{formatMass(segment.atgMassDelta)} MT</dd>
        </div>
      </dl>
      {hasDiscrepancy ? (
        <div className="mt-2 flex items-center gap-1 text-xs font-medium text-red-700">
          <AlertCircle className="h-3.5 w-3.5" />
          {t('cargoMovementDiscrepancyFlag')}
        </div>
      ) : null}
    </div>,
    document.body
  )
}
