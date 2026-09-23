import { useTranslation } from 'react-i18next'
import CargoEntryHourlyPanel from '../CargoEntryHourlyPanel'
import { formatDateTimeDisplay } from '../../utils/formatDateTimeDisplay'

export default function OperatorCargoSegmentList({
  segments,
  purpose,
  cargoMetricLabel,
  segmentHourlyByKey,
  segmentHourlyLoading,
  canEdit,
  busy,
  onEditSegment,
}) {
  const { t } = useTranslation('operator')
  const list = Array.isArray(segments) ? segments : []
  if (list.length === 0) return null

  return (
    <div className="operator-cargo-segments">
      <div className="operator-cargo-segments__title">{t('segments.title')}</div>
      <ul className="operator-cargo-segments__list">
        {list.map((seg) => {
          const startLabel = formatDateTimeDisplay(seg.startAt)
          const endLabel = seg.endAt ? formatDateTimeDisplay(seg.endAt) : t('segments.ongoing')
          const tanks =
            seg.tankCodes?.length > 0
              ? seg.tankCodes.join(', ')
              : null

          return (
            <li
              key={seg.clientKey ?? `${seg.entryId}-${seg.lineIndex}`}
              className={`operator-cargo-segment${seg.isOpen ? ' operator-cargo-segment--open' : ''}`}
            >
              <div className="operator-cargo-segment__head">
                <span className="operator-cargo-segment__num">
                  {t('segments.segmentLabel', { num: seg.segmentNum })}
                </span>
                {tanks ? <span className="operator-cargo-segment__tanks">{tanks}</span> : null}
                {seg.isOpen ? (
                  <span className="operator-cargo-segment__badge">{t('segments.ongoing')}</span>
                ) : null}
              </div>
              <div className="operator-cargo-segment__time">
                {t('segments.timeRange', { start: startLabel, end: endLabel })}
              </div>
              {seg.qtyLabel ? (
                <div className="operator-cargo-segment__qty">{seg.qtyLabel}</div>
              ) : null}
              {canEdit ? (
                <div className="operator-cargo-segment__actions">
                  <button
                    type="button"
                    className="op-btn op-btn--soft op-btn--compact"
                    disabled={busy}
                    onClick={() => onEditSegment(seg, 'startAt')}
                  >
                    {t('segments.editStart')}
                  </button>
                  {seg.endAt ? (
                    <button
                      type="button"
                      className="op-btn op-btn--soft op-btn--compact"
                      disabled={busy}
                      onClick={() => onEditSegment(seg, 'endAt')}
                    >
                      {t('segments.editEnd')}
                    </button>
                  ) : null}
                </div>
              ) : null}
              {seg.showHourly ? (
                <CargoEntryHourlyPanel
                  segmentStart={seg.startAt}
                  segmentEnd={seg.endAt}
                  hourlyData={segmentHourlyByKey?.get?.(seg.clientKey) ?? null}
                  hourlyLoading={segmentHourlyLoading}
                  purpose={purpose}
                  metricLabel={cargoMetricLabel}
                  showAtgHourly
                  openLoadLineId={seg.loadLineId}
                />
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
