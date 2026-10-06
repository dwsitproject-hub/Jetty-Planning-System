/**
 * Per-voyage table for product detail modal (full period or cast-off bucket).
 */
import { productQtyOnVoyage } from '../../utils/managementDashboardProduct.js'
import { fmtMgmtDurationHours } from './ManagementProductTable.jsx'

function fmtNum(n, d = 0) {
  return n == null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: d })
}

/** Chart metric keys → voyage table column keys (bucket drill highlight). */
export const CHART_METRIC_VOYAGE_COLUMN = {
  avgWait: 'wait',
  avgPre: 'pre',
  avgRate: 'flow',
  avgCargoDoneToSail: 'cargoDoneToSail',
}

export function chartMetricToVoyageColumn(metricKey) {
  return CHART_METRIC_VOYAGE_COLUMN[metricKey] ?? null
}

export function productFlowRateOnVoyage(row, productKey) {
  if (!productKey || row.opsH == null || !(Number(row.opsH) > 0)) return null
  const qty = Number(productQtyOnVoyage(row, productKey)) || 0
  return qty > 0 ? qty / row.opsH : null
}

export function sortVoyageRowsByProductQty(rows, productKey) {
  return [...(rows || [])].sort(
    (a, b) =>
      (Number(productQtyOnVoyage(b, productKey)) || 0) -
      (Number(productQtyOnVoyage(a, productKey)) || 0)
  )
}

function cellClass(base, columnKey, highlightColumn) {
  const focus = highlightColumn && columnKey === highlightColumn
  return [base, focus ? 'mgmt-product-voyage-col--focus' : ''].filter(Boolean).join(' ')
}

export default function ProductVoyageDetailTable({
  rows,
  productKey,
  emptyMessage = 'No voyages in this view.',
  highlightColumn = null,
}) {
  const list = Array.isArray(rows) ? rows : []
  const tableClass = highlightColumn
    ? `mgmt-product-voyage-table mgmt-product-voyage-table--highlight-${highlightColumn}`
    : 'mgmt-product-voyage-table'

  return (
    <div className="table-wrap">
      <table className={`data-table ${tableClass}`}>
        <thead>
          <tr>
            <th>Vessel</th>
            <th>Jetty</th>
            <th className="mgmt-r">Qty (MT)</th>
            <th className={cellClass('mgmt-r', 'wait', highlightColumn)}>Wait</th>
            <th className={cellClass('mgmt-r', 'pre', highlightColumn)}>Berth → start cargo</th>
            <th className={cellClass('mgmt-r', 'flow', highlightColumn)}>Avg flow</th>
            <th className={cellClass('mgmt-r', 'cargoDoneToSail', highlightColumn)}>
              Cargo done → sailed off
            </th>
          </tr>
        </thead>
        <tbody>
          {list.length ? (
            list.map((r, i) => {
              const rate = productFlowRateOnVoyage(r, productKey)
              return (
                <tr key={r.id ?? i}>
                  <td>{r.vessel}</td>
                  <td>{r.jetty || '—'}</td>
                  <td className="mgmt-r">
                    {fmtNum(productQtyOnVoyage(r, productKey) ?? r.qty)}
                  </td>
                  <td className={cellClass('mgmt-r', 'wait', highlightColumn)}>
                    {fmtMgmtDurationHours(r.wait)}
                  </td>
                  <td className={cellClass('mgmt-r', 'pre', highlightColumn)}>
                    {fmtMgmtDurationHours(r.pre)}
                  </td>
                  <td className={cellClass('mgmt-r', 'flow', highlightColumn)}>
                    {rate == null ? '—' : `${fmtNum(rate, 1)} MT/h`}
                  </td>
                  <td className={cellClass('mgmt-r', 'cargoDoneToSail', highlightColumn)}>
                    {fmtMgmtDurationHours(r.cargoDoneToSailH)}
                  </td>
                </tr>
              )
            })
          ) : (
            <tr>
              <td colSpan={7} className="text-steel">
                {emptyMessage}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
