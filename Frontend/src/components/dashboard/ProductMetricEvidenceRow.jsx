/**
 * Inline metric calculation evidence (product modal voyage table).
 */
import { useEffect, useState } from 'react'
import { fetchOperationalActivities } from '../../api/operations.js'
import { formatDateTimeDisplay } from '../../utils/formatDateTimeDisplay.js'
import {
  WAIT_EXCLUDE_LABELS,
  CARGO_DONE_EXCLUDE_LABELS,
  waitEvidence,
  berthToStartEvidence,
  cargoDoneEvidence,
  formatEvidenceComputedHours,
  formatEvidenceDisplayedDays,
  EVIDENCE_COMPUTED_LABEL,
  EVIDENCE_DISPLAYED_DAYS_LABEL,
} from '../../utils/managementDashboardMetricEvidence.js'
import FlowEvidencePanel from './FlowEvidencePanel.jsx'

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
          {columnKey === 'flow' ? (
            <FlowEvidencePanel row={row} productKey={productKey} timelineEvents={timeline} />
          ) : null}
          {columnKey === 'cargoDoneToSail' ? (
            <CargoDonePanel row={row} timelineEvents={timeline} />
          ) : null}
        </div>
      </td>
    </tr>
  )
}
