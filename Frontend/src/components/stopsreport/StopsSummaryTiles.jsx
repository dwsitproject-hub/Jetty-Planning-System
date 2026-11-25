import { useTranslation } from 'react-i18next'
import { reportReasonLabel } from '../../utils/noFlowReportView.js'
import '../../styles/stops-report.css'

const fmt = (n, d = 1) => Number(n).toLocaleString('en-US', { maximumFractionDigits: d })

/** Headline numbers and the before / during / after cargo split. */
export default function StopsSummaryTiles({ report }) {
  const { t, i18n } = useTranslation('pages')
  const s = report.summary
  const phase = report.byPhase
  return (
    <>
      <div className="stops-tiles">
        <div className="stops-tile">
          <span className="stops-tile__label">{t('stopsReportTileHours')}</span>
          <b className="stops-tile__value">{fmt(s.stopHours)} h</b>
          <span className="stops-tile__sub">{s.stopPctOfBerth == null ? '—' : t('stopsReportTilePct', { pct: fmt(s.stopPctOfBerth) })}</span>
        </div>
        <div className="stops-tile">
          <span className="stops-tile__label">{t('stopsReportTileCount')}</span>
          <b className="stops-tile__value">{s.stopCount}</b>
          <span className="stops-tile__sub">{t('stopsReportTileVoyages', { count: s.voyagesWithStops })}{s.unexplainedCount > 0 ? ` · ${s.unexplainedCount} need a reason (${fmt(s.unexplainedHours)} h)` : ''}</span>
        </div>
        <div className="stops-tile">
          <span className="stops-tile__label">{t('stopsReportTileBiggest')}</span>
          <b className="stops-tile__value stops-tile__value--text">{s.biggestReason ? reportReasonLabel(s.biggestReason, i18n.language) : '—'}</b>
          <span className="stops-tile__sub">{s.biggestReason ? `${fmt(s.biggestReason.hours)} h · ${fmt(s.biggestReason.pct, 0)}%` : ' '}</span>
        </div>
      </div>
      <p className="stops-phase">
        <span className="stops-phase__chip">{t('noFlowPhase_before')} <b>{fmt(phase.before)} h</b></span>
        <span className="stops-phase__chip">{t('stopsReportPhaseDuring')} <b>{fmt(phase.during)} h</b></span>
        <span className="stops-phase__chip">{t('noFlowPhase_after')} <b>{fmt(phase.after)} h</b></span>
      </p>
    </>
  )
}
