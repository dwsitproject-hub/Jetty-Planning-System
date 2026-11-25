import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchNoFlowReport } from '../../api/noFlowReport.js'
import { CATEGORY_COLORS, CATEGORY_ORDER, reportReasonLabel } from '../../utils/noFlowReportView.js'

const fmt = (n, d = 1) => Number(n).toLocaleString('en-US', { maximumFractionDigits: d })
const PURPOSE_FILTER = { Loading: 'Loading', Unloading: 'Unloading' }
const CATEGORY_LABELS = { terminal: 'Terminal', vessel: 'Vessel', kuras_crew: 'Kuras crew', external: 'External', other: 'Other', unexplained: 'No reason yet' }

/**
 * Management Dashboard card "Where the stop hours go" (stops and delays report switch).
 * Follows the dashboard period and purpose filter; the full report opens with the same period.
 */
export default function StopHoursCard({ range, purpose }) {
  const [report, setReport] = useState(null)
  const [error, setError] = useState(false)
  const purposeParam = PURPOSE_FILTER[purpose] || null

  useEffect(() => {
    let alive = true
    setError(false)
    fetchNoFlowReport({ ...range, purpose: purposeParam })
      .then((r) => { if (alive) setReport(r) })
      .catch(() => { if (alive) { setReport(null); setError(true) } })
    return () => { alive = false }
  }, [range.from, range.to, purposeParam])

  const link = `/reporting/stops-delays?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}${purposeParam ? `&purpose=${purposeParam}` : ''}`
  const s = report?.summary
  const reasons = report?.byReason || []
  const max = reasons[0]?.hours || 1
  const usedCategories = CATEGORY_ORDER.filter((c) => reasons.some((r) => r.category === c))

  return (
    <section className="card mgmt-sec">
      <h2 className="card__title">Where the stop hours go</h2>
      <p className="text-steel mgmt-sub">
        Stops in the period, by reason (grey = no reason yet) · colour = who caused it ·{' '}
        <Link to={link} className="link">Open full report</Link>
      </p>
      {error ? <p className="text-steel">The stops report could not be loaded.</p> : null}
      {!report && !error ? <p className="text-steel">Loading…</p> : null}
      {report && s.stopCount === 0 ? <p className="text-steel">No stops recorded in this period.</p> : null}
      {report && s.stopCount > 0 ? (
        <>
          <div className="stops-tiles">
            <div className="stops-tile">
              <span className="stops-tile__label">Stop hours</span>
              <b className="stops-tile__value">{fmt(s.stopHours)} h</b>
              <span className="stops-tile__sub">{s.stopPctOfBerth == null ? '—' : `${fmt(s.stopPctOfBerth)}% of berth time`}</span>
            </div>
            <div className="stops-tile">
              <span className="stops-tile__label">Stops recorded</span>
              <b className="stops-tile__value">{s.stopCount}</b>
              <span className="stops-tile__sub">{s.voyagesWithStops} voyages{s.unexplainedCount > 0 ? ` · ${s.unexplainedCount} need a reason (${fmt(s.unexplainedHours)} h)` : ''}</span>
            </div>
            <div className="stops-tile">
              <span className="stops-tile__label">Biggest cause</span>
              <b className="stops-tile__value stops-tile__value--text">{s.biggestReason ? reportReasonLabel(s.biggestReason, 'en') : '—'}</b>
              <span className="stops-tile__sub">{s.biggestReason ? `${fmt(s.biggestReason.hours)} h · ${fmt(s.biggestReason.pct, 0)}%` : ' '}</span>
            </div>
          </div>
          <div className="stops-bars">
            {reasons.slice(0, 8).map((r) => (
              <div key={r.code} className="stops-bars__row">
                <span className="stops-bars__label" title={reportReasonLabel(r, 'en')}>{reportReasonLabel(r, 'en')}</span>
                <div className="stops-bars__track">
                  <div className="stops-bars__fill" style={{ width: `${Math.max((r.hours / max) * 100, 1.5)}%`, background: CATEGORY_COLORS[r.category] || CATEGORY_COLORS.other }} />
                </div>
                <span className="stops-bars__value">{fmt(r.hours)} h · {fmt(r.pct, 0)}%</span>
              </div>
            ))}
            <div className="stops-bars__legend">
              {usedCategories.map((c) => <span key={c}><i style={{ background: CATEGORY_COLORS[c] }} />{CATEGORY_LABELS[c]}</span>)}
              <span>Before cargo {fmt(report.byPhase.before)} h · During {fmt(report.byPhase.during)} h · After {fmt(report.byPhase.after)} h</span>
            </div>
          </div>
        </>
      ) : null}
    </section>
  )
}
