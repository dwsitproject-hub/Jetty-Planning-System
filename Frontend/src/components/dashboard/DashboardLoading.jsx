/**
 * Shown while the Management Dashboard loads: a progress bar with the current step, over a grey
 * outline of the page (KPI cards, two cards, a table) so the layout does not jump when data arrives.
 */
import { loadLabel, loadPercent } from '../../utils/dashboardLoadProgress.js'

const KPI_COUNT = 5
const TABLE_ROWS = 6

function KpiSkeleton() {
  return (
    <div className="card mgmt-kpi" aria-hidden="true">
      <span className="mgmt-skel" style={{ width: '55%', height: 10 }} />
      <span className="mgmt-skel" style={{ width: '40%', height: 24, marginTop: 10 }} />
      <span className="mgmt-skel" style={{ width: '75%', height: 10, marginTop: 12 }} />
    </div>
  )
}

function CardSkeleton({ lines = 4 }) {
  return (
    <section className="card" aria-hidden="true">
      <span className="mgmt-skel" style={{ width: '35%', height: 14 }} />
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className="mgmt-skel" style={{ width: `${88 - i * 11}%`, height: 12, marginTop: 14 }} />
      ))}
    </section>
  )
}

export default function DashboardLoading({ stage = 'ops', done = 0, total = 0 }) {
  const pct = loadPercent(stage, done, total)
  return (
    <div className="mgmt-loading" role="status" aria-live="polite" aria-busy="true">
      <div className="mgmt-loading__head">
        <span className="mgmt-loading__spinner" aria-hidden="true" />
        <div>
          <b>{loadLabel(stage)}…</b>
          <span className="text-steel mgmt-loading__sub">
            {total > 0 ? `${done} of ${total} · ` : ''}{pct}% · this can take a moment on large periods
          </span>
        </div>
      </div>
      <div className="mgmt-loading__bar" aria-hidden="true"><span style={{ width: `${Math.max(pct, 3)}%` }} /></div>
      <div className="mgmt-kpis">
        {Array.from({ length: KPI_COUNT }, (_, i) => <KpiSkeleton key={i} />)}
      </div>
      <div className="mgmt-two mgmt-sec">
        <CardSkeleton lines={4} />
        <CardSkeleton lines={4} />
      </div>
      <section className="card mgmt-sec" aria-hidden="true">
        <span className="mgmt-skel" style={{ width: '20%', height: 14 }} />
        {Array.from({ length: TABLE_ROWS }, (_, i) => (
          <span key={i} className="mgmt-skel" style={{ width: '100%', height: 26, marginTop: 10 }} />
        ))}
      </section>
    </div>
  )
}
