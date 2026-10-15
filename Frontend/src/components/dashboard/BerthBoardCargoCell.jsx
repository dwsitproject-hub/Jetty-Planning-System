import { useTranslation } from 'react-i18next'
import CargoScheduleProgressIndicator, {
  isCargoBehindSchedule,
} from '../CargoScheduleProgressIndicator'
import { computeCargoRatePerHour, formatAvgFlowRateLabel } from '../../utils/cargoQtyDisplay'

function formatQty(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return '—'
  return Math.round(v).toLocaleString('en-US')
}

function resolveAvgRate(cargoProgress) {
  const fromApi = Number(cargoProgress?.avgRateTph)
  if (Number.isFinite(fromApi) && fromApi > 0) return fromApi
  return computeCargoRatePerHour(
    cargoProgress?.movedQty,
    cargoProgress?.firstLoggedAt,
    cargoProgress?.lastLoggedAt
  )
}

function sourcePresentation(source) {
  if (source === 'atg') {
    return { badgeKey: 'v2BoardQtySourceAtg', badgeClass: 'v2-board-qty-badge--atg' }
  }
  if (source === 'hybrid') {
    return { badgeKey: 'v2BoardQtySourceHybrid', badgeClass: 'v2-board-qty-badge--hybrid' }
  }
  return { badgeKey: 'v2BoardQtySourceManual', badgeClass: 'v2-board-qty-badge--manual' }
}

function productCompletionPercent(product) {
  const planned = Number(product?.plannedQty)
  if (!Number.isFinite(planned) || planned <= 0) return null
  const moved = Number(product?.movedQty) || 0
  return Math.min(100, Math.round((moved / planned) * 100))
}

function formatProductAvgRate(rate, unit) {
  const v = Number(rate)
  if (!Number.isFinite(v) || v <= 0) return null
  const text = v.toLocaleString('en-US', { maximumFractionDigits: 2 })
  return `Avg ${text} ${unit}/h`
}

/**
 * Cargo moved cell for Live Ops At Berth Now board.
 * Pass `product` to show one commodity instead of the whole call.
 * @param {{ cargoProgress?: object | null, product?: object | null, showSchedule?: boolean }} props
 */
export default function BerthBoardCargoCell({
  cargoProgress = null,
  product = null,
  showSchedule = true,
}) {
  const { t } = useTranslation('dashboard')

  if (!cargoProgress?.connected) {
    return <span className="v2-board-qty v2-board-qty--empty">—</span>
  }

  const unit = product?.siMetric || cargoProgress.siMetric || 'MT'
  const moved = formatQty(product ? product.movedQty : cargoProgress.movedQty)
  const totalRaw = product ? product.plannedQty : cargoProgress.siQty
  const total = totalRaw != null && Number(totalRaw) > 0 ? formatQty(totalRaw) : null
  const pctValue = product
    ? productCompletionPercent(product)
    : cargoProgress.completionPercent
  const pct = pctValue != null ? `${pctValue}%` : null
  const line = total ? `${moved} / ${total} ${unit}` : `${moved} ${unit}`
  const detail = pct ? `${line} · ${pct}` : line
  const rateLine = product
    ? formatProductAvgRate(product.avgRateTph, unit)
    : formatAvgFlowRateLabel(resolveAvgRate(cargoProgress), unit)
  const isLive = product ? Boolean(product.isLive) : Boolean(cargoProgress.isLive)

  const source = cargoProgress.source
  const { badgeKey, badgeClass } = sourcePresentation(source)

  const titleParts = [detail]
  if (rateLine) titleParts.push(rateLine)
  titleParts.push(t(badgeKey))
  if (isLive) titleParts.push(t('v2BoardQtyLiveHint'))
  if (cargoProgress.atgPartial) titleParts.push(t('v2BoardQtyAtgPartial'))

  return (
    <div className="v2-board-qty" title={titleParts.join(' · ')}>
      <span className="v2-board-qty__line">{detail}</span>
      {rateLine ? <span className="v2-board-qty__rate">{rateLine}</span> : null}
      <span className="v2-board-qty__meta">
        {isLive && (source === 'atg' || source === 'hybrid') ? (
          <span className="v2-board-qty-live" aria-hidden title={t('v2BoardQtyLiveHint')} />
        ) : null}
        <span className={`v2-board-qty-badge ${badgeClass}`}>{t(badgeKey)}</span>
      </span>
      {showSchedule ? (
        <CargoScheduleProgressIndicator comparison={cargoProgress} mode="compact" />
      ) : null}
    </div>
  )
}

export { isCargoBehindSchedule }
