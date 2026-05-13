import { formatBlSplitFromBreakdown, getPrintedSiNumber, formatFreightForSi } from '../utils/siBlSplit'
import { formatSiSignOffDate } from '../utils/siFormPlaceDate'
import SiFormReferenceDates from './SiFormReferenceDates'
import { SI_FORM_COMPANY, formatEtaBontang, getShipperLines } from '../utils/siViewModel'
import '../styles/si-view.css'
import '../styles/si-approval.css'

/**
 * SI printable / summary document (Loading letterhead vs Unloading summary + table).
 * `SiDocumentModal` normally gates on `canViewAsDocument`; callers may pass `allowPreApprovalPreview` to show this for drafts.
 */
export default function SiDocumentView({ si, npwpMaster }) {
  const isLoading = (si?.purpose || '').toLowerCase() === 'loading'
  const breakdown = si?.breakdown || []
  const totalsByUnit = breakdown.reduce((acc, r) => {
    const code = r.metricCode || '?'
    acc[code] = (acc[code] || 0) + (Number(r.qty) || 0)
    return acc
  }, {})
  const totalQtyLabel =
    Object.keys(totalsByUnit).length === 0
      ? '—'
      : Object.entries(totalsByUnit)
          .map(([code, sum]) => `${Number(sum).toLocaleString('id-ID')} ${code}`)
          .join(' · ')
  const shipperLines = getShipperLines(si)

  return isLoading ? (
    <div className="si-view-doc si-view-doc--loading card">
      <div className="si-form">
        <header className="si-form__header">
          <div className="si-form__company">{SI_FORM_COMPANY.name}</div>
          <div className="si-form__address">{SI_FORM_COMPANY.address}</div>
          <div className="si-form__line" />
        </header>
        <div className="si-form__recipient">
          MESSRS<br />
          {si.agent ? `PT. ${si.agent}` : 'PT. Tirta Permai Bahari (TPB Agency)'}
        </div>
        <h1 className="si-form__title">SHIPPING – INSTRUCTION</h1>
        <p className="si-form__docno">No.: {getPrintedSiNumber(si)}</p>
        <dl className="si-form__body">
          <dt>Vessel Name</dt>
          <dd>
            {si.vesselName || si.vesselId || '—'}
            {si.voyageNo ? ` ${si.voyageNo}` : ''}
          </dd>
          <dt>Descr. of Good</dt>
          <dd>{si.commodity || '—'}</dd>
          <dt>Quantity</dt>
          <dd>
            <strong>{totalQtyLabel}</strong>
          </dd>
          <dt>BL Split</dt>
          <dd>
            <strong>{formatBlSplitFromBreakdown(breakdown)}</strong>
          </dd>
          <dt>Shipment From</dt>
          <dd>{si.loadingPort || '—'}</dd>
          <dt>Destination</dt>
          <dd>{si.destinationText || '—'}</dd>
          <dt>Bill of Lading</dt>
          <dd style={{ whiteSpace: 'pre-wrap' }}>{si.billOfLadingClause || '—'}</dd>
          <dt>Consignee</dt>
          <dd style={{ whiteSpace: 'pre-wrap' }}>{si.consigneeText || '—'}</dd>
          <dt>Notify Party</dt>
          <dd style={{ whiteSpace: 'pre-wrap' }}>{si.notifyPartyText || '—'}</dd>
          <dt>Freight</dt>
          <dd>{formatFreightForSi(si)}</dd>
          <dt>Shipper</dt>
          <dd>
            {SI_FORM_COMPANY.name} {SI_FORM_COMPANY.address}
          </dd>
          <dt>NPWP</dt>
          <dd>{npwpMaster || '—'}</dd>
          <dt>BL Indicated</dt>
          <dd style={{ whiteSpace: 'pre-wrap' }}>{si.blIndicated || 'CLEAN SHIPPED ON BOARD FREIGHT PREPAID'}</dd>
        </dl>
        <SiFormReferenceDates
          documentDate={si.documentDate}
          createdAt={si.receivedAt}
          updatedAt={si.updatedAt}
          approvedAt={si.approvedAt}
        />
        <div className="si-form__approval">
          <div className="si-form__approval-place" title="Sign-off line: approval date when approved; otherwise document / created">
            {formatSiSignOffDate(si.documentDate, si.receivedAt, si.approvedAt)}
          </div>
          <div className="si-form__approval-company">{SI_FORM_COMPANY.name}</div>
          {si.approvalId && (
            <div className="si-form__approval-remark">
              Approved through Jetty Planning System.
              <br />
              Approval ID : <strong className="si-form__approval-id">{si.approvalId}</strong>
            </div>
          )}
          <div className="si-form__approval-signature" />
          <div className="si-form__approval-name">{si.approverNameSnapshot || '—'}</div>
          <div className="si-form__approval-title">{si.approverTitleSnapshot || 'OPERATION HEAD'}</div>
        </div>
      </div>
    </div>
  ) : (
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
              <th className="si-view-table__th">Commodity</th>
              <th className="si-view-table__th si-view-table__th--num">Qty</th>
              <th className="si-view-table__th">Unit</th>
              <th className="si-view-table__th">Kontrak</th>
              <th className="si-view-table__th">PO</th>
              <th className="si-view-table__th">Keterangan</th>
            </tr>
          </thead>
          <tbody>
            {breakdown.length > 0 ? (
              breakdown.map((row, i) => (
                <tr key={i}>
                  <td className="si-view-table__cell">{row.commodityName || '—'}</td>
                  <td className="si-view-table__cell si-view-table__cell--num">
                    {row.qty != null ? Number(row.qty).toLocaleString('id-ID') : '—'}
                  </td>
                  <td className="si-view-table__cell">{row.metricCode || '—'}</td>
                  <td className="si-view-table__cell">{row.contractNo || '—'}</td>
                  <td className="si-view-table__cell">{row.poNo || '—'}</td>
                  <td className="si-view-table__cell">{row.remarks || '—'}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="si-view-table__cell">—</td>
                <td className="si-view-table__cell si-view-table__cell--num">—</td>
                <td className="si-view-table__cell">—</td>
                <td className="si-view-table__cell">—</td>
                <td className="si-view-table__cell">—</td>
                <td className="si-view-table__cell">—</td>
              </tr>
            )}
            <tr className="si-view-table__total">
              <td colSpan={5} className="si-view-table__cell si-view-table__cell--total-label">
                TOTAL
              </td>
              <td className="si-view-table__cell si-view-table__cell--total">{totalQtyLabel}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
