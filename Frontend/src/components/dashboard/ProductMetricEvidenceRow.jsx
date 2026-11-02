/**
 * Inline metric calculation evidence (product modal voyage table).
 */
import { useEffect, useMemo, useState } from 'react'
import { fetchOperationalProgress, fetchOperationalActivities } from '../../api/operations.js'
import { formatDateTimeDisplay } from '../../utils/formatDateTimeDisplay.js'
import {
  WAIT_EXCLUDE_LABELS,
  CARGO_DONE_EXCLUDE_LABELS,
  waitEvidence,
  berthToStartEvidence,
  cargoDoneEvidence,
  flowEvidenceSummary,
  dailyFlowFromHourlyBuckets,
  formatEvidenceComputedHours,
  formatEvidenceDisplayedDays,
  EVIDENCE_COMPUTED_LABEL,
  EVIDENCE_DISPLAYED_DAYS_LABEL,
} from '../../utils/managementDashboardMetricEvidence.js'

function fmtTs(v) {
  return v ? formatDateTimeDisplay(v) : '—'
}

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

function WaitPanel({ row }) {
  const e = waitEvidence(row)
  const sourceRows = [
    { label: 'Actual Time of Arrival (TA)', value: fmtTs(e.ta), kind: 'source' },
    { label: 'Actual Time of Berthing (TB)', value: fmtTs(e.tb), kind: 'source' },
  ]
  if (e.etb) {
    sourceRows.push({ label: 'ETB (reference only)', value: fmtTs(e.etb), kind: 'muted' })
  }
  const sections = [
    { key: 'source', title: 'Timestamps', rows: sourceRows },
    {
      key: 'result',
      title: 'Column value',
      rows: [
        {
          label: EVIDENCE_COMPUTED_LABEL,
          value: formatEvidenceComputedHours(e.rawWaitHours),
          kind: 'computed',
        },
        {
          label: EVIDENCE_DISPLAYED_DAYS_LABEL,
          value: formatEvidenceDisplayedDays(e.displayedWaitHours),
          kind: 'displayed',
        },
      ],
    },
  ]
  return (
    <>
      <EvidenceKvTable sections={sections} />
      {e.excludeReason ? (
        <EvidenceFootnote variant="warn">{WAIT_EXCLUDE_LABELS[e.excludeReason]}</EvidenceFootnote>
      ) : null}
    </>
  )
}

function BerthToStartPanel({ row, prefetchedDetail }) {
  const [detail, setDetail] = useState(prefetchedDetail)
  const [loadingActs, setLoadingActs] = useState(false)
  const [actsError, setActsError] = useState(null)

  useEffect(() => {
    setDetail(prefetchedDetail)
  }, [prefetchedDetail])

  useEffect(() => {
    if (prefetchedDetail || !row?.id) return undefined
    let cancelled = false
    ;(async () => {
      setLoadingActs(true)
      setActsError(null)
      try {
        const oa = await fetchOperationalActivities(row.id)
        if (!cancelled) {
          setDetail({ acts: (oa && oa.entries) || [] })
        }
      } catch (err) {
        if (!cancelled) setActsError(err?.message || 'Failed to load operational activities')
      } finally {
        if (!cancelled) setLoadingActs(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [row?.id, prefetchedDetail])

  const e = berthToStartEvidence(row, detail)
  const detailLoaded = detail != null

  const sections = [
    {
      key: 'source',
      title: 'Timestamps',
      rows: [
        { label: 'Actual Time of Berthing (TB)', value: fmtTs(e.tb), kind: 'source' },
        { label: 'Operation Start', value: fmtTs(e.cargoOpsStartAt), kind: 'source' },
      ],
    },
    {
      key: 'result',
      title: 'Column value',
      rows: [
        {
          label: EVIDENCE_COMPUTED_LABEL,
          value: formatEvidenceComputedHours(e.computedHours),
          kind: 'computed',
        },
        {
          label: EVIDENCE_DISPLAYED_DAYS_LABEL,
          value: formatEvidenceDisplayedDays(e.displayedHours),
          kind: 'displayed',
        },
      ],
    },
  ]

  return (
    <>
      <EvidenceKvTable sections={sections} />
      {loadingActs ? <EvidenceFootnote>Loading cargo operation times…</EvidenceFootnote> : null}
      {actsError ? <EvidenceFootnote variant="warn">{actsError}</EvidenceFootnote> : null}
      {!loadingActs && detailLoaded && !e.cargoOpsStartAt ? (
        <EvidenceFootnote variant="warn">
          No Cargo Operations operation window start is recorded for this voyage.
        </EvidenceFootnote>
      ) : null}
      {!e.tb && !loadingActs ? (
        <EvidenceFootnote variant="warn">Actual Time of Berthing (TB) is not recorded.</EvidenceFootnote>
      ) : null}
    </>
  )
}

function CargoDonePanel({ row, timelineEvents }) {
  const e = cargoDoneEvidence(row, timelineEvents)
  const sections = [
    {
      key: 'source',
      title: 'Timestamps',
      rows: [
        { label: 'Cargo finished (timeline)', value: fmtTs(e.cargoDoneAt), kind: 'source' },
        { label: 'Sailed at', value: fmtTs(e.sailedAt), kind: 'source' },
      ],
    },
    {
      key: 'result',
      title: 'Column value',
      rows: [
        {
          label: EVIDENCE_COMPUTED_LABEL,
          value: formatEvidenceComputedHours(e.computedHours),
          kind: 'computed',
        },
        {
          label: EVIDENCE_DISPLAYED_DAYS_LABEL,
          value: formatEvidenceDisplayedDays(e.displayedHours),
          kind: 'displayed',
        },
      ],
    },
  ]
  return (
    <>
      <EvidenceKvTable sections={sections} />
      {e.excludeReason ? (
        <EvidenceFootnote variant="warn">{CARGO_DONE_EXCLUDE_LABELS[e.excludeReason]}</EvidenceFootnote>
      ) : (
        <EvidenceFootnote>Sailed at must be after cargo finished.</EvidenceFootnote>
      )}
    </>
  )
}

function FlowPanel({ row, productKey }) {
  const summary = useMemo(() => flowEvidenceSummary(row, productKey), [row, productKey])
  const [progress, setProgress] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

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

  const daily = useMemo(
    () => dailyFlowFromHourlyBuckets(progress?.hourlyBuckets || []),
    [progress]
  )

  const sections = [
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
        {
          label: 'Displayed (MT/h)',
          value: summary.voyageRateMtH == null ? '—' : `${fmtNum(summary.voyageRateMtH)} MT/h`,
          kind: 'displayed',
        },
      ],
    },
  ]

  return (
    <>
      <EvidenceKvTable sections={sections} />
      {summary.atgPartial ? (
        <EvidenceFootnote variant="warn">ATG data was partial for this voyage; rate may include manual fallback.</EvidenceFootnote>
      ) : null}
      {loading ? <EvidenceFootnote>Loading hourly/daily progress…</EvidenceFootnote> : null}
      {error ? <EvidenceFootnote variant="warn">{error}</EvidenceFootnote> : null}
      {!loading && !error && daily.length === 0 ? (
        <EvidenceFootnote>No hourly/daily progress logged — voyage-level rate only.</EvidenceFootnote>
      ) : null}
      {daily.length > 0 ? (
        <div className="mgmt-product-metric-evidence__section mgmt-product-metric-evidence__section--daily">
          <p className="mgmt-product-metric-evidence__section-title">Daily breakdown</p>
          <div className="mgmt-product-metric-evidence__scroll">
            <table className="mgmt-product-metric-evidence__kv mgmt-product-metric-evidence__kv--grid">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col" className="mgmt-product-metric-evidence__num">
                    MT moved
                  </th>
                  <th scope="col" className="mgmt-product-metric-evidence__num">
                    Active h
                  </th>
                  <th scope="col" className="mgmt-product-metric-evidence__num">
                    Avg MT/h
                  </th>
                </tr>
              </thead>
              <tbody>
                {daily.map((d) => (
                  <tr key={d.date}>
                    <td>{d.date}</td>
                    <td className="mgmt-product-metric-evidence__num">{fmtNum(d.qtyMoved, 0)}</td>
                    <td className="mgmt-product-metric-evidence__num">{d.hoursActive}</td>
                    <td className="mgmt-product-metric-evidence__num">
                      {d.avgMtH == null ? '—' : fmtNum(d.avgMtH)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </>
  )
}

const PANEL_TITLES = {
  wait: 'Wait',
  pre: 'Berth → start cargo',
  flow: 'Avg flow',
  cargoDoneToSail: 'Cargo done → sailed off',
}

export default function ProductMetricEvidenceRow({
  row,
  columnKey,
  productKey,
  opDetailsById,
  timelinesByOpId,
  colSpan = 7,
}) {
  const detail = row?.id != null ? opDetailsById?.[row.id] : null
  const timeline = row?.id != null ? timelinesByOpId?.[row.id] : null

  return (
    <tr className="mgmt-product-metric-evidence-row">
      <td colSpan={colSpan}>
        <div className="mgmt-product-metric-evidence" data-metric={columnKey}>
          <div className="mgmt-product-metric-evidence__head">
            <span className="mgmt-product-metric-evidence__metric">
              {PANEL_TITLES[columnKey] || columnKey}
            </span>
            <span className="mgmt-product-metric-evidence__vessel">{row?.vessel}</span>
          </div>
          {columnKey === 'wait' ? <WaitPanel row={row} /> : null}
          {columnKey === 'pre' ? (
            <BerthToStartPanel row={row} prefetchedDetail={detail} />
          ) : null}
          {columnKey === 'flow' ? <FlowPanel row={row} productKey={productKey} /> : null}
          {columnKey === 'cargoDoneToSail' ? (
            <CargoDonePanel row={row} timelineEvents={timeline} />
          ) : null}
        </div>
      </td>
    </tr>
  )
}
