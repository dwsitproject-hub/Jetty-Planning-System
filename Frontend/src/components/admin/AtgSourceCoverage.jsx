import { formatDateTimeCompact } from '../../utils/formatDateTimeDisplay'
import { formatCount } from '../../utils/adminOpsDisplay'

const BLOCK_CLASS = { l: 'live', r: 'recovered', m: 'missing' }
const STATUS_BADGE = {
  live: 'active',
  recovered: 'active',
  gap: 'warning',
  silent: 'error',
}
const LEGEND = ['live', 'recovered', 'missing']
const COVERAGE_HOURS_FALLBACK = 24

function formatRange(range) {
  return `${formatDateTimeCompact(range.startAt)} – ${formatDateTimeCompact(range.endAt)}`
}

function formatMinutes(minutes, t) {
  const total = Math.max(0, Math.round(Number(minutes) || 0))
  if (total < 60) return t('adminOpsAtgDurationMin', { m: total })
  return t('adminOpsAtgDurationHm', { h: Math.floor(total / 60), m: total % 60 })
}

function sourceNote(coverage, hours, t) {
  if (!coverage) return null
  if (coverage.status === 'silent') {
    return coverage.silentMinutes == null
      ? t('adminOpsAtgNoteNever', { hours })
      : t('adminOpsAtgNoteSilent', { duration: formatMinutes(coverage.silentMinutes, t) })
  }
  if (coverage.status === 'gap') {
    const gap = coverage.gaps[coverage.gaps.length - 1]
    return t('adminOpsAtgNoteGap', { range: formatRange(gap) })
  }
  if (coverage.status === 'recovered') {
    const range = coverage.recoveredRanges[coverage.recoveredRanges.length - 1]
    return t('adminOpsAtgNoteRecovered', { range: formatRange(range), blocks: range.blocks })
  }
  return null
}

export function AtgCoverageBar({ blocks, label }) {
  return (
    <div className="atg-coverage__bar" role="img" aria-label={label}>
      {blocks.split('').map((ch, i) => (
        <span key={i} className={`atg-coverage__block atg-coverage__block--${BLOCK_CLASS[ch] ?? 'missing'}`} />
      ))}
    </div>
  )
}

export function AtgCoverageLegend({ t }) {
  return (
    <div className="atg-coverage__legend">
      {LEGEND.map((kind) => (
        <span key={kind}>
          <i className={`atg-coverage__swatch atg-coverage__block--${kind}`} aria-hidden="true" />
          {t(`adminOpsAtgLegend_${kind}`)}
        </span>
      ))}
    </div>
  )
}

function AtgSourceRow({ source, hours, t }) {
  const { coverage } = source
  const status = coverage?.status ?? (source.stale ? 'silent' : 'live')
  const note = sourceNote(coverage, hours, t)
  return (
    <div className="atg-coverage__row">
      <div>
        <div className="atg-coverage__name">{source.label}</div>
        <div className="atg-coverage__meta">
          {source.baseUrl} · {t('adminOpsAtgTanks', { count: formatCount(source.tankCount) })}
        </div>
      </div>
      <div>
        {coverage ? (
          <>
            <AtgCoverageBar blocks={coverage.blocks} label={t('adminOpsAtgCoverageLabel')} />
            <div className="atg-coverage__axis">
              <span>{t('adminOpsAtgAxisStart', { hours })}</span>
              <span>{t('adminOpsAtgAxisNow')}</span>
            </div>
          </>
        ) : null}
      </div>
      <div>
        <span className={`admin-status-badge admin-status-badge--${STATUS_BADGE[status]}`}>
          {t(`adminOpsAtgStatus_${status}`)}
        </span>
        {note ? <div className="atg-coverage__meta">{note}</div> : null}
      </div>
    </div>
  )
}

export function AtgPortCoverage({ port, hours = COVERAGE_HOURS_FALLBACK, t }) {
  return (
    <div className="atg-coverage__port">
      <div className="atg-coverage__port-title">
        {port.portName || `Port ${port.portId}`}
        <span className="atg-coverage__meta"> · {t('adminOpsAtgCoverageTitle', { hours })}</span>
      </div>
      {port.sources.map((source) => (
        <AtgSourceRow key={source.baseUrl || source.label} source={source} hours={hours} t={t} />
      ))}
    </div>
  )
}
