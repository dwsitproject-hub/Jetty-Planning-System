/**
 * Avg flow evidence: rates-first layout (daily → hourly), calculation audit collapsed.
 */
import { useEffect, useMemo, useState } from 'react'
import { fetchOperationalProgress } from '../../api/operations.js'
import { formatDailyRateDateLabel } from '../../utils/cargoDailyRates.js'
import {
  dailyFlowFromHourlyBuckets,
  flowEvidenceSummary,
  formatEvidenceComputedHours,
  EVIDENCE_COMPUTED_LABEL,
} from '../../utils/managementDashboardMetricEvidence.js'
import FlowEvidenceDayDetail from './FlowEvidenceDayDetail.jsx'

function fmtNum(n, d = 1) {
  return n == null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: d })
}

function EvidenceKvTable({ sections }) {
  return (
    <div className="mgmt-product-metric-evidence__tables">
      {sections.map((section) => (
        <div key={section.key} className="mgmt-product-metric-evidence__section">
          {section.title ? (
            <p className="mgmt-product-metric-evidence__section-title">{section.title}</p>
          ) : null}
          <table className="mgmt-product-metric-evidence__kv">
            <tbody>
              {section.rows.map((row) => (
                <tr key={row.label} data-kind={row.kind || 'default'}>
                  <th scope="row">{row.label}</th>
                  <td>{row.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}

function EvidenceFootnote({ children, variant = 'note' }) {
  return (
    <p
      className={
        variant === 'warn'
          ? 'mgmt-product-metric-evidence__warn'
          : 'mgmt-product-metric-evidence__note text-steel'
      }
    >
      {children}
    </p>
  )
}

function sourceChipLabel(source) {
  if (!source) return null
  return String(source).toUpperCase()
}

export default function FlowEvidencePanel({ row, productKey, timelineEvents }) {
  const summary = useMemo(() => flowEvidenceSummary(row, productKey), [row, productKey])
  const [progress, setProgress] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [openDay, setOpenDay] = useState(null)
  const [timelineCache, setTimelineCache] = useState(timelineEvents)

  useEffect(() => {
    if (!row?.id) return undefined
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetchOperationalProgress(row.id)
        if (!cancelled) setProgress(res)
      } catch (err) {
        if (!cancelled) setError(err?.message || 'Failed to load operational progress')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [row?.id])

  useEffect(() => {
    setTimelineCache(timelineEvents)
  }, [timelineEvents])

  useEffect(() => {
    setOpenDay(null)
  }, [row?.id, productKey])

  const daily = useMemo(
    () => dailyFlowFromHourlyBuckets(progress?.hourlyBuckets || []),
    [progress]
  )

  const calcSections = useMemo(
    () => [
      {
        key: 'source',
        title: 'Inputs',
        rows: [
          { label: 'Moved qty (MT)', value: fmtNum(summary.productQtyMt, 0), kind: 'source' },
          {
            label: 'Logged cargo hours',
            value: formatEvidenceComputedHours(summary.loggedCargoHours),
            kind: 'source',
          },
          {
            label: 'Source',
            value: summary.source ? String(summary.source).toUpperCase() : '—',
            kind: 'source',
          },
          {
            label: 'Cargo ops window (h)',
            value: formatEvidenceComputedHours(summary.cargoOpsHours),
            kind: 'muted',
          },
        ],
      },
      {
        key: 'result',
        title: 'Column value',
        rows: [
          {
            label: EVIDENCE_COMPUTED_LABEL,
            value:
              summary.voyageRateMtH == null
                ? '—'
                : `${fmtNum(summary.voyageRateMtH)} MT/h (moved ÷ logged hours)`,
            kind: 'computed',
          },
        ],
      },
    ],
    [summary]
  )

  const sourceLabel = sourceChipLabel(summary.source)
  const openDayLabel = openDay ? formatDailyRateDateLabel(openDay) : null

  return (
    <div className="mgmt-flow-evidence">
      <div className="mgmt-flow-evidence__hero">
        <div className="mgmt-flow-evidence__hero-main">
          <span className="mgmt-flow-evidence__hero-label">Voyage average</span>
          <span className="mgmt-flow-evidence__hero-rate">
            {summary.voyageRateMtH == null ? '—' : `${fmtNum(summary.voyageRateMtH)} MT/h`}
          </span>
        </div>
        {sourceLabel ? (
          <span className="mgmt-flow-evidence__source-chip">{sourceLabel}</span>
        ) : null}
      </div>

      {summary.atgPartial ? (
        <EvidenceFootnote variant="warn">
          ATG data was partial for this voyage; rate may include manual fallback.
        </EvidenceFootnote>
      ) : null}
      {loading ? <EvidenceFootnote>Loading daily progress…</EvidenceFootnote> : null}
      {error ? <EvidenceFootnote variant="warn">{error}</EvidenceFootnote> : null}
      {!loading && !error && daily.length === 0 ? (
        <EvidenceFootnote>No hourly/daily progress logged — voyage-level rate only.</EvidenceFootnote>
      ) : null}

      {daily.length > 0 ? (
        <section className="mgmt-flow-evidence__daily" aria-labelledby="mgmt-flow-daily-heading">
          <h4 id="mgmt-flow-daily-heading" className="mgmt-flow-evidence__daily-title">
            Daily rates
          </h4>
          <p className="mgmt-flow-evidence__daily-hint text-steel">
            Select a day to view hourly transfer rates by cargo entry.
          </p>
          <div className="mgmt-flow-evidence__daily-scroll">
            <table className="mgmt-product-metric-evidence__kv mgmt-flow-evidence__daily-table">
              <tbody>
                {daily.map((d) => {
                  const dayOpen = openDay === d.date
                  const dateLabel = formatDailyRateDateLabel(d.date)
                  return (
                    <tr
                      key={d.date}
                      className={dayOpen ? 'mgmt-flow-evidence__day-row--open' : ''}
                    >
                      <td colSpan={4} className="mgmt-flow-evidence__day-row-cell">
                        <button
                          type="button"
                          className="mgmt-flow-evidence__day-toggle"
                          aria-expanded={dayOpen}
                          aria-label={`Show hourly rates for ${dateLabel}`}
                          onClick={() => setOpenDay((prev) => (prev === d.date ? null : d.date))}
                        >
                          <span className="mgmt-flow-evidence__day-chevron" aria-hidden>
                            {dayOpen ? '▾' : '▸'}
                          </span>
                          <span className="mgmt-flow-evidence__day-label">{dateLabel}</span>
                          <span className="mgmt-flow-evidence__day-metrics">
                            <span>{fmtNum(d.qtyMoved, 0)} MT</span>
                            <span>{d.hoursActive} h active</span>
                            <span className="mgmt-flow-evidence__day-metrics-rate">
                              {d.avgMtH == null ? '—' : `${fmtNum(d.avgMtH)} MT/h avg`}
                            </span>
                          </span>
                          <span className="mgmt-flow-evidence__day-action text-steel">
                            View hourly rates
                          </span>
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {openDay ? (
            <div className="mgmt-flow-evidence__hourly-panel">
              <h5 className="mgmt-flow-evidence__hourly-panel-title">
                Hourly rates · {openDayLabel || openDay}
              </h5>
              <FlowEvidenceDayDetail
                operationId={row?.id}
                dateKey={openDay}
                productKey={productKey}
                timelineEvents={timelineCache}
                onTimelineLoaded={setTimelineCache}
              />
            </div>
          ) : null}
        </section>
      ) : null}

      <details className="mgmt-flow-evidence__calc">
        <summary className="mgmt-flow-evidence__calc-summary">How this rate is calculated</summary>
        <EvidenceKvTable sections={calcSections} />
      </details>
    </div>
  )
}
