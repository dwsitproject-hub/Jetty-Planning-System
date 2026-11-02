/**
 * By-product tables on the Management Dashboard (Incoming / Outgoing).
 */
import { useCallback, useMemo, useState } from 'react'
import InteractiveTooltip from '../InteractiveTooltip.jsx'
import { sortModalRows } from '../../utils/widgetDetailSort.js'

export const PRODUCT_COLUMN_TOOLTIPS = {
  avgWait:
    'Average time from arrival (TA) to alongside (TB). Only voyages with both times recorded.',
  berthToStart:
    'Average time from alongside (TB) until the Cargo Operations operation window start.',
  avgFlow:
    'Average tons moved per hour for this product (moved qty ÷ logged cargo hours).',
  cargoDoneToSail:
    'Average time from cargo finished until the vessel sailed',
}

/** By-commodity column key → product modal chart metric key */
export const PRODUCT_COLUMN_CHART_METRIC = {
  avgWait: 'avgWait',
  berthToStart: 'avgPre',
  avgFlow: 'avgRate',
  cargoDoneToSail: 'avgCargoDoneToSail',
}

function fmtNum(n, d = 0) {
  return n == null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: d })
}

/** Hours; show days when ≥ 24 h (same spirit as voyage late chips). */
export function fmtMgmtDurationHours(h) {
  if (h == null || !Number.isFinite(h)) return '—'
  if (h >= 24) return `${fmtNum(h / 24, 1)} d`
  return `${fmtNum(h, 1)} h`
}

/** Always show duration in days (internal storage remains hours). */
export function fmtMgmtDurationDays(h) {
  if (h == null || !Number.isFinite(h)) return '—'
  return `${fmtNum(h / 24, 1)} d`
}

export function mgmtHoursAsDays(h) {
  if (h == null || !Number.isFinite(h)) return null
  return +(h / 24).toFixed(1)
}

function ColumnHeader({ label, columnKey, tooltip, align, sort, onSort }) {
  const active = sort?.key === columnKey
  return (
    <th className={align === 'right' ? 'mgmt-r mgmt-product-th' : 'mgmt-product-th'}>
      <span className="mgmt-product-th__inner">
        <button
          type="button"
          className="mgmt-modal-sort"
          onClick={() => onSort(columnKey)}
          aria-label={`Sort by ${label}`}
        >
          {label}
          <span aria-hidden="true">{active ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ' ⇅'}</span>
        </button>
        {tooltip ? (
          <InteractiveTooltip items={[{ primary: tooltip }]} maxWidth={360} placement="top">
            <span
              className="mgmt-product-info-icon"
              aria-label={tooltip}
              tabIndex={0}
              role="img"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              ⓘ
            </span>
          </InteractiveTooltip>
        ) : null}
      </span>
    </th>
  )
}

const PRODUCT_TABLE_COLUMNS = [
  { key: 'product', label: 'Commodity', align: 'left', sortValue: (r) => r.label || '' },
  { key: 'shipments', label: 'Shipments', align: 'right', sortValue: (r) => r.shipments },
  { key: 'avgWait', label: 'Avg wait', align: 'right', tooltip: PRODUCT_COLUMN_TOOLTIPS.avgWait, sortValue: (r) => r.avgWait },
  {
    key: 'berthToStart',
    label: 'Berth → start cargo',
    align: 'right',
    tooltip: PRODUCT_COLUMN_TOOLTIPS.berthToStart,
    sortValue: (r) => r.avgPre,
  },
  { key: 'avgFlow', label: 'Avg flow', align: 'right', tooltip: PRODUCT_COLUMN_TOOLTIPS.avgFlow, sortValue: (r) => r.avgRate },
  {
    key: 'cargoDoneToSail',
    label: 'Cargo done → sailed off',
    align: 'right',
    tooltip: PRODUCT_COLUMN_TOOLTIPS.cargoDoneToSail,
    sortValue: (r) => r.avgCargoDoneToSail,
  },
]

function openContextForColumn(colKey) {
  if (colKey === 'product' || colKey === 'shipments') {
    return { view: 'table' }
  }
  const metricKey = PRODUCT_COLUMN_CHART_METRIC[colKey]
  if (metricKey) return { view: 'chart', metricKey }
  return { view: 'table' }
}

function ClickableCell({ colKey, align, ariaLabel, onActivate, children }) {
  const handleKey = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onActivate(openContextForColumn(colKey))
    }
  }
  return (
    <td
      className={`mgmt-product-cell--click${align === 'right' ? ' mgmt-r' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      onClick={() => onActivate(openContextForColumn(colKey))}
      onKeyDown={handleKey}
    >
      {children}
    </td>
  )
}

function ProductBlock({ title, chipClass, rows, onProductOpen }) {
  const [sort, setSort] = useState(null)
  const onSort = useCallback((key) => {
    setSort((prev) => (prev?.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))
  }, [])
  const sorted = useMemo(() => sortModalRows(rows, PRODUCT_TABLE_COLUMNS, sort), [rows, sort])

  if (!sorted.length) {
    return (
      <div className="mgmt-product-block">
        <h3 className="mgmt-product-block__title">
          {title}
          {chipClass ? (
            <span className={`mgmt-chip ${chipClass}`} style={{ marginLeft: 8 }}>
              {chipClass === 'mgmt-chip--disch' ? 'UNLOAD' : 'LOAD'}
            </span>
          ) : null}
        </h3>
        <p className="text-steel mgmt-sub" style={{ marginBottom: 0 }}>
          No sailed voyages for this direction in the period.
        </p>
      </div>
    )
  }

  return (
    <div className="mgmt-product-block">
      <h3 className="mgmt-product-block__title">
        {title}
        {chipClass ? (
          <span className={`mgmt-chip ${chipClass}`} style={{ marginLeft: 8 }}>
            {chipClass === 'mgmt-chip--disch' ? 'UNLOAD' : 'LOAD'}
          </span>
        ) : null}
      </h3>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              {PRODUCT_TABLE_COLUMNS.map((col) => (
                <ColumnHeader
                  key={col.key}
                  columnKey={col.key}
                  label={col.label}
                  tooltip={col.tooltip}
                  align={col.align}
                  sort={sort}
                  onSort={onSort}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const open = (context) => onProductOpen(r, context)
              return (
                <tr key={`${r.purpose}-${r.key}`} className="mgmt-prod-row">
                  <ClickableCell
                    colKey="product"
                    ariaLabel={`${r.label} — open detailed voyage list`}
                    onActivate={open}
                  >
                    <b>{r.label}</b>
                  </ClickableCell>
                  <ClickableCell
                    colKey="shipments"
                    align="right"
                    ariaLabel={`${r.label} — ${r.shipments} shipments — open detailed voyage list`}
                    onActivate={open}
                  >
                    {fmtNum(r.shipments, 0)}
                  </ClickableCell>
                  <ClickableCell
                    colKey="avgWait"
                    align="right"
                    ariaLabel={`${r.label} — Avg wait chart`}
                    onActivate={open}
                  >
                    {fmtMgmtDurationDays(r.avgWait)}
                  </ClickableCell>
                  <ClickableCell
                    colKey="berthToStart"
                    align="right"
                    ariaLabel={`${r.label} — Berth to start cargo chart`}
                    onActivate={open}
                  >
                    {fmtMgmtDurationDays(r.avgPre)}
                  </ClickableCell>
                  <ClickableCell
                    colKey="avgFlow"
                    align="right"
                    ariaLabel={`${r.label} — Avg flow chart`}
                    onActivate={open}
                  >
                    {r.avgRate == null ? '—' : `${fmtNum(r.avgRate, 1)} MT/h`}
                  </ClickableCell>
                  <ClickableCell
                    colKey="cargoDoneToSail"
                    align="right"
                    ariaLabel={`${r.label} — Cargo done to sailed off chart`}
                    onActivate={open}
                  >
                    {fmtMgmtDurationHours(r.avgCargoDoneToSail)}
                  </ClickableCell>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function ManagementProductTable({
  incoming = [],
  outgoing = [],
  showIncoming = true,
  showOutgoing = true,
  onProductOpen,
}) {
  const hasAny =
    (showIncoming && incoming.length > 0) || (showOutgoing && outgoing.length > 0)

  if (!hasAny) {
    return <p className="text-steel">No sailed voyages in this period.</p>
  }

  return (
    <div className="mgmt-product-tables">
      {showIncoming ? (
        <ProductBlock
          title="Incoming"
          chipClass="mgmt-chip--disch"
          rows={incoming}
          onProductOpen={onProductOpen}
        />
      ) : null}
      {showOutgoing ? (
        <ProductBlock
          title="Outgoing"
          chipClass="mgmt-chip--load"
          rows={outgoing}
          onProductOpen={onProductOpen}
        />
      ) : null}
    </div>
  )
}

