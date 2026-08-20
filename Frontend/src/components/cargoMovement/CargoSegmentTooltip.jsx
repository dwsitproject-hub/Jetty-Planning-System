import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import InteractiveTooltip from '../InteractiveTooltip.jsx'
import { formatDateTimeDisplay } from '../../utils/formatDateTimeDisplay.js'

function formatQty(v) {
  if (v == null || Number.isNaN(Number(v))) return '—'
  return Number(v).toLocaleString(undefined, { maximumFractionDigits: 3 })
}

function segmentClass(status) {
  switch (status) {
    case 'manual_override':
      return 'cargo-movement-seg--manual'
    case 'sample_gap':
      return 'cargo-movement-seg--gap'
    case 'qty_mismatch':
      return 'cargo-movement-seg--mismatch'
    case 'in_progress':
      return 'cargo-movement-seg--progress'
    default:
      return 'cargo-movement-seg--ok'
  }
}

function badgeLabel(seg, t) {
  if (seg.atgAuditStatus === 'manual_override') return t('cargoMovementBadgeManual')
  if (seg.atgAuditStatus === 'sample_gap') return t('cargoMovementBadgeGap')
  if (seg.atgAuditStatus === 'in_progress') return t('cargoMovementBadgeProgress')
  if (seg.qtySource === 'atg') return t('cargoMovementBadgeAtg')
  return t('cargoMovementBadgeWarn')
}

export default function CargoSegmentTooltip({ segment, timezone, t, children }) {
  const navigate = useNavigate()
  const detail = segment?.atgMassDetail
  const tankErrors = Array.isArray(detail?.tanks)
    ? detail.tanks.map((tk) => tk?.error).filter(Boolean)
    : []
  const errCode = detail?.error || tankErrors[0] || null

  const items = useMemo(() => {
    if (!segment) return []
    const rows = [
      { primary: t('cargoMovementTipVessel'), secondary: segment.vesselName || '—' },
      { primary: t('cargoMovementTipPurpose'), secondary: segment.purpose || '—' },
      { primary: t('cargoMovementTipJetty'), secondary: segment.jettyName || '—' },
      {
        primary: t('cargoMovementTipWindow'),
        secondary: `${formatDateTimeDisplay(segment.startAt, timezone)} → ${segment.endAt ? formatDateTimeDisplay(segment.endAt, timezone) : t('cargoMovementOpen')}`,
      },
      { primary: t('cargoMovementTipQty'), secondary: `${formatQty(segment.qty)} MT` },
      { primary: t('cargoMovementTipMode'), secondary: segment.atgQtyMode === 'manual' ? t('cargoMovementBadgeManual') : 'ATG auto' },
      { primary: t('cargoMovementTipAtgDelta'), secondary: formatQty(segment.atgMassDelta) },
    ]
    if (errCode) {
      rows.push({ primary: t('cargoMovementTipAtgDetail'), secondary: String(errCode) })
    }
    return rows
  }, [segment, timezone, t, errCode])

  const purposePath = segment?.purpose === 'Unloading' ? 'unloading' : 'loading'
  const opLink = segment?.operationId
    ? `/${purposePath}/op-${encodeURIComponent(segment.operationId)}/loading?cargo=1`
    : null

  return (
    <InteractiveTooltip
      title={segment?.vesselName || t('cargoMovementSegment')}
      subtitle={badgeLabel(segment, t)}
      items={items}
      maxWidth={360}
      placement="left"
    >
      <div
        className="cargo-movement-seg-hit"
        role="button"
        tabIndex={0}
        onClick={() => {
          if (opLink) navigate(opLink)
        }}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && opLink) {
            e.preventDefault()
            navigate(opLink)
          }
        }}
        title={opLink ? t('cargoMovementOpenOperation') : undefined}
        style={{ width: '100%', height: '100%' }}
      >
        {children}
      </div>
    </InteractiveTooltip>
  )
}

export { segmentClass, formatQty, badgeLabel }
