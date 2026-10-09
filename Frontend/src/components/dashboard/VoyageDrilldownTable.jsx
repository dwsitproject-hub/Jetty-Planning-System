/**
 * By Voyage: one row per call, grouped Incoming (unload) / Outgoing (load).
 */
import { Fragment, useCallback, useMemo, useState } from 'react'
import { voyageFlowRate } from '../../utils/managementDashboardFlow.js'
import { voyageMovedQtyLines, voyageMovedQtySortValue } from '../../utils/managementDashboardProduct.js'
import { sortModalRows } from '../../utils/widgetDetailSort.js'
import { fmtMgmtDurationDays, fmtMgmtDurationHours } from './ManagementProductTable.jsx'
import ProductMetricEvidenceRow from './ProductMetricEvidenceRow.jsx'

const METRIC_COLUMNS = ['wait', 'pre', 'flow', 'cargoDoneToSail']
const COL_SPAN = 9

function fmtNum(n, d = 1) {
  return n == null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: d })
}

function statusLabel(r) {
  if (r.sailedInPeriod) return 'Sailed'
  if (r.status === 'SAILED') return 'At berth'
  return {
    DOCKED: 'Docked',
    IN_PROGRESS: 'In progress',
    SIGNOFF_REQUESTED: 'Sign-off req.',
    SIGNOFF_APPROVED: 'Ready to sail',
  }[r.status] || r.status || ''
}

function statusChip(r) {
  const label = statusLabel(r)
  if (r.sailedInPeriod) return <span className="mgmt-chip mgmt-chip--ghost">{label}</span>
  return (
    <span className={`mgmt-chip ${r.purpose === 'Loading' ? 'mgmt-chip--load' : 'mgmt-chip--disch'}`}>
      {label}
    </span>
  )
}

function pairLines(row) {
  const raw = String(row?.commodity ?? '').trim()
  if (!raw || raw === '—') return []
  return voyageMovedQtyLines(row)
}

function CommodityCell({ row }) {
  const lines = pairLines(row)
  if (lines.length <= 1) return lines[0]?.label || '—'
  return (
    <span className="mgmt-voyage-pair mgmt-voyage-pair--commodity">
      {lines.map((l, i) => (
        <span key={`${l.label}-${i}`}>{l.label}</span>
      ))}
    </span>
  )
}

function MovedQtyCell({ row }) {
  const lines = pairLines(row)
  if (lines.length <= 1) return lines[0]?.qty == null ? '—' : fmtNum(lines[0].qty, 0)
  return (
    <span className="mgmt-voyage-pair mgmt-voyage-pair--moved">
      {lines.map((l, i) => (
        <span key={`${l.label}-${i}`}>{l.qty == null ? '—' : fmtNum(l.qty, 0)}</span>
      ))}
    </span>
  )
}

const VOYAGE_COLUMNS = [
  { key: 'vessel', label: 'Vessel', sortValue: (r) => r.vessel || '' },
  { key: 'jetty', label: 'Jetty', sortValue: (r) => r.jetty || '' },
  { key: 'commodity', label: 'Commodity', sortValue: (r) => r.commodity || '' },
  { key: 'moved', label: 'Moved (MT)', align: 'right', sortValue: voyageMovedQtySortValue },
  { key: 'wait', label: 'Wait', align: 'right', sortValue: (r) => r.wait },
  { key: 'pre', label: 'Berth → start cargo', align: 'right', sortValue: (r) => r.pre },
  { key: 'flow', label: 'Avg flow', align: 'right', sortValue: (r) => voyageFlowRate(r) },
  { key: 'cargoDoneToSail', label: 'Cargo done → sailed off', align: 'right', sortValue: (r) => r.cargoDoneToSailH },
  { key: 'status', label: 'Status', sortValue: statusLabel },
]

function SortHeader({ column, sort, onSort }) {
  const active = sort?.key === column.key
  return (
    <th className={column.align === 'right' ? 'mgmt-r' : ''}>
      <button
        type="button"
        className="mgmt-modal-sort"
        onClick={() => onSort(column.key)}
        aria-label={`Sort by ${column.label}`}
      >
        {column.label}
        <span aria-hidden="true">{active ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ' ⇅'}</span>
      </button>
    </th>
  )
}

function BlockTitle({ title, chipClass }) {
  return (
    <h3 className="mgmt-product-block__title">
      {title}
      <span className={`mgmt-chip ${chipClass}`} style={{ marginLeft: 8 }}>
        {chipClass === 'mgmt-chip--disch' ? 'UNLOAD' : 'LOAD'}
      </span>
    </h3>
  )
}

function VoyageBlock({
  title,
  chipClass,
  rows,
  expanded,
  onToggle,
  opDetailsById,
  timelinesByOpId,
}) {
  const [sort, setSort] = useState(null)
  const onSort = useCallback((key) => {
    setSort((prev) => (prev?.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))
  }, [])
  const sorted = useMemo(() => sortModalRows(rows, VOYAGE_COLUMNS, sort), [rows, sort])

  if (!sorted.length) {
    return (
      <div className="mgmt-product-block">
        <BlockTitle title={title} chipClass={chipClass} />
        <p className="text-steel mgmt-sub" style={{ marginBottom: 0 }}>
          No voyages for this direction in this view.
        </p>
      </div>
    )
  }

  const metricProps = (rowKey, columnKey) => {
    const open = expanded?.rowKey === rowKey && expanded?.columnKey === columnKey
    return {
      role: 'button',
      tabIndex: 0,
      className: [
        'mgmt-r',
        'mgmt-product-voyage-metric-cell',
        open ? 'mgmt-product-voyage-metric-cell--open' : '',
      ].filter(Boolean).join(' '),
      title: 'Show calculation details',
      'aria-expanded': open,
      onClick: (e) => {
        e.stopPropagation()
        onToggle(rowKey, columnKey)
      },
      onKeyDown: (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onToggle(rowKey, columnKey)
        }
      },
    }
  }

  return (
    <div className="mgmt-product-block">
      <BlockTitle title={title} chipClass={chipClass} />
      <div className="table-wrap">
        <table className="data-table mgmt-product-voyage-table">
          <thead>
            <tr>
              {VOYAGE_COLUMNS.map((column) => (
                <SortHeader key={column.key} column={column} sort={sort} onSort={onSort} />
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const rk = String(r.id)
              const rate = voyageFlowRate(r)
              const show = expanded?.rowKey === rk && METRIC_COLUMNS.includes(expanded.columnKey)
              return (
                <Fragment key={rk}>
                  <tr>
                    <td>
                      <b>{r.vessel}</b>
                      <br />
                      <span className="text-steel" style={{ fontSize: 11 }}>{r.code}</span>
                    </td>
                    <td>{r.jetty || '—'}</td>
                    <td><CommodityCell row={r} /></td>
                    <td className="mgmt-r"><MovedQtyCell row={r} /></td>
                    <td {...metricProps(rk, 'wait')}>{fmtMgmtDurationDays(r.wait)}</td>
                    <td {...metricProps(rk, 'pre')}>{fmtMgmtDurationDays(r.pre)}</td>
                    <td {...metricProps(rk, 'flow')}>{rate == null ? '—' : `${fmtNum(rate, 1)} MT/h`}</td>
                    <td {...metricProps(rk, 'cargoDoneToSail')}>{fmtMgmtDurationHours(r.cargoDoneToSailH)}</td>
                    <td>{statusChip(r)}</td>
                  </tr>
                  {show ? (
                    <ProductMetricEvidenceRow
                      row={r}
                      columnKey={expanded.columnKey}
                      opDetailsById={opDetailsById}
                      timelinesByOpId={timelinesByOpId}
                      colSpan={COL_SPAN}
                    />
                  ) : null}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function VoyageDrilldownTable({
  rows,
  opDetailsById,
  timelinesByOpId,
  showIncoming = true,
  showOutgoing = true,
}) {
  const list = Array.isArray(rows) ? rows : []
  const incoming = list.filter((r) => r.purpose !== 'Loading')
  const outgoing = list.filter((r) => r.purpose === 'Loading')
  const [expanded, setExpanded] = useState(null)
  const onToggle = useCallback((rowKey, columnKey) => {
    setExpanded((prev) =>
      prev?.rowKey === rowKey && prev?.columnKey === columnKey ? null : { rowKey, columnKey },
    )
  }, [])

  if (!showIncoming && !showOutgoing) return null
  if ((showIncoming ? incoming.length : 0) + (showOutgoing ? outgoing.length : 0) === 0) {
    return <p className="text-steel">No voyages in this view.</p>
  }

  return (
    <div className="mgmt-product-tables">
      {showIncoming ? (
        <VoyageBlock
          title="Incoming"
          chipClass="mgmt-chip--disch"
          rows={incoming}
          expanded={expanded}
          onToggle={onToggle}
          opDetailsById={opDetailsById}
          timelinesByOpId={timelinesByOpId}
        />
      ) : null}
      {showOutgoing ? (
        <VoyageBlock
          title="Outgoing"
          chipClass="mgmt-chip--load"
          rows={outgoing}
          expanded={expanded}
          onToggle={onToggle}
          opDetailsById={opDetailsById}
          timelinesByOpId={timelinesByOpId}
        />
      ) : null}
    </div>
  )
}
