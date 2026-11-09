import { formatEtaBontang, getShipperLines } from '../utils/siViewModel'
import '../styles/si-view.css'

const SUMMARY_COLUMNS = 9

const formatQty = (n) => Number(n).toLocaleString('id-ID')

function breakdownTotals(breakdown) {
  const totalsByUnit = breakdown.reduce((acc, row) => {
    const code = row.metricCode || '?'
    acc[code] = (acc[code] || 0) + (Number(row.qty) || 0)
    return acc
  }, {})
  return Object.entries(totalsByUnit).map(([code, sum]) => ({ code, sum }))
}

/**
 * Shipping instruction summary card, used for Loading and Unloading.
 */
export default function SiDocumentView({ si }) {
  const breakdown = si?.breakdown || []
  const totals = breakdownTotals(breakdown)
  const totalQtyLabel = totals.map(({ code, sum }) => `${formatQty(sum)} ${code}`).join(' · ') || '—'
  const shipperLines = getShipperLines(si)

  return (
    <div className="si-view-doc card">
      <div className="si-view-summary">
        <div className="si-view-summary__row">
          <span className="si-view-summary__label">VESSEL:</span>
          <span className="si-view-summary__value">{si.vesselName || si.vesselId || '—'}</span>
        </div>
        <div className="si-view-summary__row">
          <span className="si-view-summary__label">COMMODITY:</span>
          <span className="si-view-summary__value">{si.commodity || '—'}</span>
        </div>
        <div className="si-view-summary__row">
          <span className="si-view-summary__label">SHIPPER:</span>
          <span className="si-view-summary__value">
            {shipperLines.map((line, i) => (
              <span key={i}>
                {line}
                {i < shipperLines.length - 1 ? <br /> : null}
              </span>
            ))}
          </span>
        </div>
        <div className="si-view-summary__row">
          <span className="si-view-summary__label">LOADING PORT:</span>
          <span className="si-view-summary__value">{si.loadingPort || '—'}</span>
        </div>
        <div className="si-view-summary__row">
          <span className="si-view-summary__label">QTY:</span>
          <span className="si-view-summary__value">{totalQtyLabel}</span>
        </div>
        <div className="si-view-summary__row">
          <span className="si-view-summary__label">ETA:</span>
          <span className="si-view-summary__value">{formatEtaBontang(si)}</span>
        </div>
        <div className="si-view-summary__row">
          <span className="si-view-summary__label">TERM:</span>
          <span className="si-view-summary__value">{si.term || '—'}</span>
        </div>
      </div>

      <div className="si-view-table-wrap">
        <table className="si-view-table">
          <thead>
            <tr>
              <th className="si-view-table__th">Shipper</th>
              <th className="si-view-table__th">Commodity</th>
              <th className="si-view-table__th si-view-table__th--num">Qty</th>
              <th className="si-view-table__th">Unit</th>
              <th className="si-view-table__th">Kontrak</th>
              <th className="si-view-table__th">PO</th>
              <th className="si-view-table__th">SO</th>
              <th className="si-view-table__th">STO</th>
              <th className="si-view-table__th">Keterangan</th>
            </tr>
          </thead>
          <tbody>
            {breakdown.length > 0 ? (
              breakdown.map((row, i) => (
                <tr key={i}>
                  <td className="si-view-table__cell">{row.shipperName || '—'}</td>
                  <td className="si-view-table__cell">{row.commodityName || '—'}</td>
                  <td className="si-view-table__cell si-view-table__cell--num">
                    {row.qty != null ? formatQty(row.qty) : '—'}
                  </td>
                  <td className="si-view-table__cell">{row.metricCode || '—'}</td>
                  <td className="si-view-table__cell">{row.contractNo || '—'}</td>
                  <td className="si-view-table__cell">{row.poNo || '—'}</td>
                  <td className="si-view-table__cell">{row.soNo || '—'}</td>
                  <td className="si-view-table__cell">{row.stoNo || '—'}</td>
                  <td className="si-view-table__cell">{row.remarks || '—'}</td>
                </tr>
              ))
            ) : (
              <tr>
                {Array.from({ length: SUMMARY_COLUMNS }, (_, i) => (
                  <td
                    key={i}
                    className={`si-view-table__cell${i === 2 ? ' si-view-table__cell--num' : ''}`}
                  >
                    —
                  </td>
                ))}
              </tr>
            )}
            {totals.map(({ code, sum }, i) => (
              <tr key={code} className="si-view-table__total">
                <td colSpan={2} className="si-view-table__cell si-view-table__cell--total-label">
                  {i === 0 ? 'TOTAL' : ''}
                </td>
                <td className="si-view-table__cell si-view-table__cell--num">{formatQty(sum)}</td>
                <td className="si-view-table__cell">{code}</td>
                <td colSpan={SUMMARY_COLUMNS - 4} className="si-view-table__cell" />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
