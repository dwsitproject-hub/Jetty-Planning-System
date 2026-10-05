/**
 * By-product tables on the Management Dashboard (Incoming / Outgoing).
 */
import InteractiveTooltip from '../InteractiveTooltip.jsx'

export const PRODUCT_COLUMN_TOOLTIPS = {
  avgWait:
    'Average time from arrival (TA) to alongside (TB). Only voyages with both times recorded.',
  berthToStart:
    'Average time from alongside (TB) until cargo work starts (Pre-Checking).',
  avgFlow:
    'Average tons moved per hour for this product: product qty ÷ cargo hours.',
  opsToSail:
    'Average time from cargo finished until the vessel sails (cast-off).',
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

function ColumnHeader({ label, tooltip, align }) {
  return (
    <th className={align === 'right' ? 'mgmt-r mgmt-product-th' : 'mgmt-product-th'}>
      <span className="mgmt-product-th__inner">
        <span>{label}</span>
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
  { key: 'product', label: 'Commodity', align: 'left' },
  { key: 'shipments', label: 'Shipments', align: 'right' },
  { key: 'avgWait', label: 'Avg wait', align: 'right', tooltip: PRODUCT_COLUMN_TOOLTIPS.avgWait },
  {
    key: 'berthToStart',
    label: 'Berth → start cargo',
    align: 'right',
    tooltip: PRODUCT_COLUMN_TOOLTIPS.berthToStart,
  },
  { key: 'avgFlow', label: 'Avg flow', align: 'right', tooltip: PRODUCT_COLUMN_TOOLTIPS.avgFlow },
  {
    key: 'opsToSail',
    label: 'Ops complete → sail',
    align: 'right',
    tooltip: PRODUCT_COLUMN_TOOLTIPS.opsToSail,
  },
]

function ProductBlock({ title, chipClass, rows, onRowClick }) {
  if (!rows.length) {
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
                  label={col.label}
                  tooltip={col.tooltip}
                  align={col.align}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={`${r.purpose}-${r.key}`}
                className="mgmt-prod-row"
                role="button"
                tabIndex={0}
                onClick={() => onRowClick(r)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onRowClick(r)
                  }
                }}
                aria-label={`${r.label} — click for voyage list`}
              >
                <td>
                  <b>{r.label}</b>
                </td>
                <td className="mgmt-r">{fmtNum(r.shipments, 0)}</td>
                <td className="mgmt-r">{fmtMgmtDurationHours(r.avgWait)}</td>
                <td className="mgmt-r">{fmtMgmtDurationHours(r.avgPre)}</td>
                <td className="mgmt-r">
                  {r.avgRate == null ? '—' : `${fmtNum(r.avgRate, 1)} MT/h`}
                </td>
                <td className="mgmt-r">{fmtMgmtDurationHours(r.avgSign2Co)}</td>
              </tr>
            ))}
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
  onRowClick,
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
          onRowClick={onRowClick}
        />
      ) : null}
      {showOutgoing ? (
        <ProductBlock
          title="Outgoing"
          chipClass="mgmt-chip--load"
          rows={outgoing}
          onRowClick={onRowClick}
        />
      ) : null}
    </div>
  )
}
