/**

 * Per-voyage table for product detail modal (full period or sailed-off bucket).

 */

import { Fragment, useCallback, useState } from 'react'

import { expandVoyageToProductSlices, productQtyOnVoyage } from '../../utils/managementDashboardProduct.js'

import { fmtMgmtCastOffDate } from '../../utils/managementDashboardMetricEvidence.js'
import { fmtMgmtDurationDays, fmtMgmtDurationHours } from './ManagementProductTable.jsx'

import ProductMetricEvidenceRow from './ProductMetricEvidenceRow.jsx'

const EVIDENCE_COL_SPAN = 8



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
  if (!productKey) return null
  const pk = String(productKey).trim().toUpperCase()
  const fromApi = row.productRatesByKey?.[pk]?.rateMtH
  if (fromApi != null && Number.isFinite(fromApi) && fromApi > 0) return fromApi
  const slice = expandVoyageToProductSlices(row).find((s) => s.productKey === pk)
  if (slice?.productRateMtH != null && Number.isFinite(slice.productRateMtH)) return slice.productRateMtH
  return null
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



const METRIC_COLUMNS = ['wait', 'pre', 'flow', 'cargoDoneToSail']



function rowKey(r, i) {

  return r.id != null ? String(r.id) : `idx-${i}`

}



export default function ProductVoyageDetailTable({

  rows,

  productKey,

  emptyMessage = 'No voyages in this view.',

  highlightColumn = null,

  opDetailsById = null,

  timelinesByOpId = null,

  evidenceEnabled = true,

  onFlowDetailOpen = null,

  flowDrawerRowId = null,

}) {

  const list = Array.isArray(rows) ? rows : []

  const [expanded, setExpanded] = useState(null)



  const toggleEvidence = useCallback((rk, columnKey) => {

    setExpanded((prev) =>

      prev?.rowKey === rk && prev?.columnKey === columnKey ? null : { rowKey: rk, columnKey }

    )

  }, [])



  const tableClass = highlightColumn

    ? `mgmt-product-voyage-table mgmt-product-voyage-table--highlight-${highlightColumn}`

    : 'mgmt-product-voyage-table'



  const onMetricClick = evidenceEnabled

    ? (rk, columnKey, rowForFlow) => (e) => {

        e.stopPropagation()

        if (columnKey === 'flow' && onFlowDetailOpen) {

          onFlowDetailOpen(rowForFlow)

          return

        }

        toggleEvidence(rk, columnKey)

      }

    : null



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

            <th className={cellClass('mgmt-r mgmt-voyage-th--flow', 'flow', highlightColumn)}>Avg flow</th>

            <th className={cellClass('mgmt-r mgmt-voyage-th--cargo-done', 'cargoDoneToSail', highlightColumn)}>
              Cargo done →
              <br />
              sailed off
            </th>

            <th className="mgmt-r mgmt-voyage-th--date-completed">
              Date
              <br />
              completed
            </th>

          </tr>

        </thead>

        <tbody>

          {list.length ? (

            list.map((r, i) => {

              const rate = productFlowRateOnVoyage(r, productKey)

              const rk = rowKey(r, i)

              const flowDrawerOpen =

                onFlowDetailOpen && flowDrawerRowId != null && String(r.id) === String(flowDrawerRowId)

              const showEvidence =

                evidenceEnabled &&

                expanded?.rowKey === rk &&

                METRIC_COLUMNS.includes(expanded.columnKey) &&

                expanded.columnKey !== 'flow'



              const metricTdProps = (columnKey) =>

                onMetricClick

                  ? {

                      role: 'button',

                      tabIndex: 0,

                      className: [

                        cellClass(
                          `mgmt-r ${columnKey === 'flow' ? 'mgmt-voyage-col--flow' : ''} ${columnKey === 'cargoDoneToSail' ? 'mgmt-voyage-col--cargo-done' : ''}`.trim(),
                          columnKey,
                          highlightColumn,
                        ),

                        'mgmt-product-voyage-metric-cell',

                        (columnKey === 'flow' && onFlowDetailOpen

                          ? flowDrawerOpen

                          : expanded?.rowKey === rk && expanded?.columnKey === columnKey)

                          ? 'mgmt-product-voyage-metric-cell--open'

                          : '',

                      ]

                        .filter(Boolean)

                        .join(' '),

                      onClick: onMetricClick(rk, columnKey, r),

                      onKeyDown: (e) => {

                        if (e.key === 'Enter' || e.key === ' ') {

                          e.preventDefault()

                          onMetricClick(rk, columnKey, r)(e)

                        }

                      },

                      title:

                        columnKey === 'flow' && onFlowDetailOpen

                          ? 'Open flow rates detail'

                          : 'Show calculation details',

                      'aria-expanded':

                        columnKey === 'flow' && onFlowDetailOpen

                          ? flowDrawerOpen

                          : expanded?.rowKey === rk && expanded?.columnKey === columnKey,

                    }

                  : { className: cellClass('mgmt-r', columnKey, highlightColumn) }



              return (

                <Fragment key={rk}>

                  <tr>

                    <td>{r.vessel}</td>

                    <td>{r.jetty || '—'}</td>

                    <td className="mgmt-r">

                      {fmtNum(productQtyOnVoyage(r, productKey) ?? r.qty)}

                    </td>

                    <td {...metricTdProps('wait')}>{fmtMgmtDurationDays(r.wait)}</td>

                    <td {...metricTdProps('pre')}>{fmtMgmtDurationDays(r.pre)}</td>

                    <td {...metricTdProps('flow')}>

                      {rate == null ? '—' : `${fmtNum(rate, 1)} MT/h`}

                    </td>

                    <td {...metricTdProps('cargoDoneToSail')}>

                      {fmtMgmtDurationHours(r.cargoDoneToSailH)}

                    </td>

                    <td className="mgmt-r mgmt-voyage-col--date-completed">{fmtMgmtCastOffDate(r.castOff)}</td>

                  </tr>

                  {showEvidence ? (

                    <ProductMetricEvidenceRow

                      row={r}

                      columnKey={expanded.columnKey}

                      productKey={productKey}

                      opDetailsById={opDetailsById}

                      timelinesByOpId={timelinesByOpId}

                      colSpan={EVIDENCE_COL_SPAN}

                    />

                  ) : null}

                </Fragment>

              )

            })

          ) : (

            <tr>

              <td colSpan={EVIDENCE_COL_SPAN} className="text-steel">

                {emptyMessage}

              </td>

            </tr>

          )}

        </tbody>

      </table>

    </div>

  )

}


