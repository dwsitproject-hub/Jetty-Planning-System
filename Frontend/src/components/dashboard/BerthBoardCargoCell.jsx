import { useTranslation } from 'react-i18next'

function formatQty(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return '—'
  return Math.round(v).toLocaleString('en-US')
}

/**
 * Cargo moved cell for Live Ops At Berth Now board.
 * @param {{ cargoProgress?: object | null }} props
 */
export default function BerthBoardCargoCell({ cargoProgress = null }) {
  const { t } = useTranslation('dashboard')

  if (!cargoProgress?.connected) {
    return <span className="v2-board-qty v2-board-qty--empty">—</span>
  }

  const unit = cargoProgress.siMetric || 'MT'
  const moved = formatQty(cargoProgress.movedQty)
  const total =
    cargoProgress.siQty != null && Number(cargoProgress.siQty) > 0
      ? formatQty(cargoProgress.siQty)
      : null
  const pct =
    cargoProgress.completionPercent != null ? `${cargoProgress.completionPercent}%` : null

  const line = total ? `${moved} / ${total} ${unit}` : `${moved} ${unit}`
  const detail = pct ? `${line} · ${pct}` : line

  const source = cargoProgress.source
  const badgeKey =
    source === 'atg'
      ? 'v2BoardQtySourceAtg'
      : source === 'hybrid'
        ? 'v2BoardQtySourceHybrid'
        : 'v2BoardQtySourceManual'
  const badgeClass =
    source === 'atg'
      ? 'v2-board-qty-badge--atg'
      : source === 'hybrid'
        ? 'v2-board-qty-badge--hybrid'
        : 'v2-board-qty-badge--manual'

  const titleParts = [detail, t(badgeKey)]
  if (cargoProgress.isLive) titleParts.push(t('v2BoardQtyLiveHint'))
  if (cargoProgress.atgPartial) titleParts.push(t('v2BoardQtyAtgPartial'))

  return (
    <div className="v2-board-qty" title={titleParts.join(' · ')}>
      <span className="v2-board-qty__line">{detail}</span>
      <span className="v2-board-qty__meta">
        {cargoProgress.isLive && (source === 'atg' || source === 'hybrid') ? (
          <span className="v2-board-qty-live" aria-hidden title={t('v2BoardQtyLiveHint')} />
        ) : null}
        <span className={`v2-board-qty-badge ${badgeClass}`}>{t(badgeKey)}</span>
      </span>
    </div>
  )
}
