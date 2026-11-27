import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import CargoEntryHourlyPanel from '../CargoEntryHourlyPanel'
import { formatDateTimeDisplay } from '../../utils/formatDateTimeDisplay'

/** Yellow strip for the kuras period that is running: palka, timer and the Stop kuras button. */
function KurasRunning({ period, canEdit, busy, onStop }) {
  const { t } = useTranslation('operator')
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30000)
    return () => window.clearInterval(id)
  }, [])
  const minutes = Math.max(0, Math.round((now - new Date(period.startAt).getTime()) / 60000))
  const timer = minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} m` : `${minutes} m`
  return (
    <div className="operator-kuras-running" role="status">
      <div className="operator-kuras-running__label">{t('kuras.running')}</div>
      <div className="operator-kuras-running__title">{t('kuras.runningTitle', { palka: period.palka, timer })}</div>
      <div className="operator-kuras-running__meta">{t('kuras.since', { time: formatDateTimeDisplay(period.startAt) })}</div>
      {canEdit && onStop ? (
        <button type="button" className="op-btn op-btn--soft" disabled={busy} onClick={onStop}>
          {t('kuras.stopKurasOn', { palka: period.palka })}
        </button>
      ) : null}
    </div>
  )
}

export default function OperatorCargoSegmentList({
  segments,
  purpose,
  cargoMetricLabel,
  segmentHourlyByKey,
  segmentHourlyLoading,
  canEdit,
  busy,
  onEditSegment,
  onStopKuras = null,
  operationId = null,
  scheduleTimezone = 'Asia/Jakarta',
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
          const product = seg.commodityShortDisplay || null

          return (
            <li
              key={seg.clientKey ?? `${seg.entryId}-${seg.lineIndex}`}
              className={`operator-cargo-segment${seg.isOpen ? ' operator-cargo-segment--open' : ''}`}
            >
              <div className="operator-cargo-segment__head">
                <span className="operator-cargo-segment__num">
                  {t('segments.segmentLabel', { num: seg.segmentNum })}
                </span>
                {product ? (
                  <span className="operator-cargo-segment__product">{product}</span>
                ) : null}
                {tanks ? <span className="operator-cargo-segment__tanks">{tanks}</span> : null}
                {seg.movementType === 'mixed' ? (
                  <span className="operator-cargo-segment__badge operator-cargo-segment__badge--mixed">{t('kuras.mixed')}</span>
                ) : null}
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
              {(seg.kurasPeriods || []).length > 0 ? (
                <div className="operator-kuras-list">
                  {seg.kurasPeriods.filter((p) => p.endAt).map((p) => (
                    <div key={p.id} className="operator-kuras-done">
                      {t('kuras.doneLine', {
                        palka: p.palka,
                        from: formatDateTimeDisplay(p.startAt),
                        to: formatDateTimeDisplay(p.endAt),
                        qty: p.qty != null ? ` · ${Number(p.qty).toLocaleString(undefined, { maximumFractionDigits: 1 })} MT` : '',
                      })}
                    </div>
                  ))}
                  {seg.kurasPeriods.filter((p) => !p.endAt).map((p) => (
                    <KurasRunning key={p.id} period={p} canEdit={canEdit} busy={busy} onStop={onStopKuras} />
                  ))}
                </div>
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
                  showAtgHourly={Boolean(seg.showAtgHourly)}
                  showManualHourly={Boolean(seg.showManualHourly)}
                  showManualCheckpoints={Boolean(seg.showManualCheckpoints)}
                  solidCommodity={Boolean(seg.showManualHourly && !seg.showAtgHourly)}
                  operationId={operationId}
                  openLoadLineId={seg.loadLineId}
                  scheduleTimezone={scheduleTimezone}
                />
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
