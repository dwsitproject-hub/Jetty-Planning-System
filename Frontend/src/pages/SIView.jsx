import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { nominations } from '../data/mockData'
import '../styles/si-view.css'
import '../styles/si-approval.css'

const SI_FORM_COMPANY = {
  name: 'PT ENERGI UNGGUL PERSADA',
  address: 'GAMA TOWER, LT 41, JL HR RASUNA SAID, KAV C 22, KARET KUNINGAN, SETIABUDI, KOTA ADM. JAKARTA SELATAN, DKI JAKARTA, 12940',
}

/** View is applicable for: Approved Loading SI, or Unloading / External SI */
function canViewAsDocument(si) {
  if (!si) return false
  const purpose = (si.purpose || '').toLowerCase()
  const status = (si.status || '').toLowerCase()
  if (purpose === 'unloading') return true
  if (purpose === 'loading' && status === 'approved') return true
  return false
}

/** SI document number e.g. SI/EUP/2026/1/20260893 */
function getSiDocNumber(si) {
  const raw = (si.siId || si.id || '003').toString()
  const id = raw.replace(/\D/g, '') || '003'
  const y = new Date().getFullYear()
  return `SI/EUP/${y}/1/${id.padStart(3, '0')}`
}

/** Format date for form: "BONTANG, 2 MARCH 2026" */
function formatFormDate(iso, location = 'BONTANG') {
  if (!iso) return `${location}, —`
  const d = new Date(iso)
  const day = d.getDate()
  const month = d.toLocaleString('en-GB', { month: 'long' }).toUpperCase()
  const year = d.getFullYear()
  return `${location}, ${day} ${month} ${year}`
}

function formatQtyKg(kg) {
  if (kg == null) return '—'
  return Number(kg).toLocaleString('id-ID') + ' Kg'
}

function formatEtaBontang(si) {
  const from = si.etaFrom
  const to = si.etaTo
  if (!from && !to) return si.etaDateTime ? new Date(si.etaDateTime).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
  if (from && to && from !== to) {
    const d1 = new Date(from)
    const d2 = new Date(to)
    const mon2 = d2.toLocaleString('en-GB', { month: 'short' }).toUpperCase()
    return `${d1.getDate()} - ${d2.getDate()} ${mon2} ${d2.getFullYear()}`
  }
  const d = new Date(from || to)
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function getShipperLines(si) {
  const main = (si.shipper || '').trim()
  const fromBreakdown = (si.breakdown || []).map((b) => (b.shipper || '').trim()).filter(Boolean)
  const combined = main ? [main, ...fromBreakdown.filter((s) => s !== main)] : [...new Set(fromBreakdown)]
  return combined.length ? combined : ['—']
}

export default function SIView() {
  const { siId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const siFromState = location.state?.si
  const siFromList = nominations.find((n) => (n.siId || '').toUpperCase() === (siId || '').toUpperCase() || n.id === siId)
  const si = siFromState || siFromList || null
  const canView = si && canViewAsDocument(si)
  const isLoading = (si?.purpose || '').toLowerCase() === 'loading'
  const breakdown = si?.breakdown || []
  const totalQty = si?.totalQtyKg ?? breakdown.reduce((sum, r) => sum + (Number(r.qtyKg) || 0), 0)

  if (!si) {
    return (
      <div className="si-view-page">
        <div className="card">
          <p className="text-steel">Shipping Instruction not found for ID: {siId || '—'}.</p>
          <button type="button" className="btn btn--primary" onClick={() => navigate('/shipping-instruction')}>
            Back to Shipping Instructions
          </button>
        </div>
      </div>
    )
  }

  if (!canView) {
    return (
      <div className="si-view-page">
        <div className="card si-view-unavailable">
          <h2 className="si-view-unavailable__title">View not available</h2>
          <p className="text-steel">
            This Shipping Instruction is not available for document view. View is applicable for <strong>Approved Loading SI</strong> or <strong>Unloading / External SI</strong> only.
          </p>
          <button type="button" className="btn btn--primary" onClick={() => navigate('/shipping-instruction')}>
            Back to Shipping Instructions
          </button>
        </div>
      </div>
    )
  }

  const shipperLines = getShipperLines(si)

  return (
    <div className="si-view-page">
      <header className="si-view-header no-print">
        <button
          type="button"
          className="btn btn--secondary btn--small"
          onClick={() => navigate('/shipping-instruction')}
          aria-label="Back to Shipping Instructions"
        >
          ← Back
        </button>
        <h1 className="page-title">Shipping Instruction</h1>
        <span className="si-view-meta">
          {si.siId || si.id} · {isLoading ? 'Loading' : 'External'}
        </span>
      </header>

      {isLoading ? (
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
            <p className="si-form__docno">No.: {getSiDocNumber(si)}</p>
            <dl className="si-form__body">
              <dt>Vessel Name</dt>
              <dd>{si.vesselName || si.vesselId || '—'}</dd>
              <dt>Descr. of Good</dt>
              <dd>{si.commodity || si.product || '—'}</dd>
              <dt>Quantity</dt>
              <dd><strong>{si.totalQtyKg != null ? `${(si.totalQtyKg / 1000).toLocaleString()} MT` : '—'}</strong></dd>
              <dt>BL Split</dt>
              <dd><strong>{si.breakdown && si.breakdown.length ? `${si.breakdown.length} X ${(si.totalQtyKg / 1000).toFixed(0)} MTS` : (si.totalQtyKg != null ? `1 X ${(si.totalQtyKg / 1000).toFixed(0)} MTS` : '—')}</strong></dd>
              <dt>Shipment From</dt>
              <dd>{si.loadingPort || 'BONTANG'}</dd>
              <dt>Destination</dt>
              <dd>{si.destination || 'NANSHA, CHINA'}</dd>
              <dt>Bill of Lading</dt>
              <dd>{si.billOfLading || '3 NON-NEGOTIABLE BILLS OF LADING'}</dd>
              <dt>Consignee</dt>
              <dd>{si.consignee || 'TO ORDER'}</dd>
              <dt>Notify Party</dt>
              <dd>{si.notifyParty || '—'}</dd>
              <dt>Freight</dt>
              <dd>{si.term === 'CIF' ? 'PREPAID' : (si.term || 'FOB')}</dd>
              <dt>Shipper</dt>
              <dd>{SI_FORM_COMPANY.name} {SI_FORM_COMPANY.address}</dd>
              <dt>NPWP</dt>
              <dd>{si.npwp || '81.291.248.3-018.000'}</dd>
              <dt>BL Indicated</dt>
              <dd>{si.blIndicated || 'CLEAN SHIPPED ON BOARD FREIGHT PREPAID'}</dd>
            </dl>
            <div className="si-form__approval">
              <div className="si-form__approval-place">{formatFormDate(si.receivedAt || new Date().toISOString())}</div>
              <div className="si-form__approval-company">{SI_FORM_COMPANY.name}</div>
              {si.approvalId && (
                <div className="si-form__approval-remark">
                  Approved through Jetty Planning System.<br />
                  Approval ID : <strong className="si-form__approval-id">{si.approvalId}</strong>
                </div>
              )}
              <div className="si-form__approval-signature" />
              <div className="si-form__approval-name">RUDI HARTONO</div>
              <div className="si-form__approval-title">OPERATION HEAD</div>
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
              <span className="si-view-summary__value">{si.commodity || si.product || '—'}</span>
            </div>
            <div className="si-view-summary__row">
              <span className="si-view-summary__label">SHIPPER:</span>
              <span className="si-view-summary__value">
                {shipperLines.map((line, i) => (
                  <span key={i}>{line}{i < shipperLines.length - 1 ? <br /> : null}</span>
                ))}
              </span>
            </div>
            <div className="si-view-summary__row">
              <span className="si-view-summary__label">LOADING PORT:</span>
              <span className="si-view-summary__value">{si.loadingPort || '—'}</span>
            </div>
            <div className="si-view-summary__row">
              <span className="si-view-summary__label">QTY:</span>
              <span className="si-view-summary__value">{formatQtyKg(totalQty)}</span>
            </div>
            <div className="si-view-summary__row">
              <span className="si-view-summary__label">ETA BONTANG:</span>
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
                  <th className="si-view-table__th">Kontrak</th>
                  <th className="si-view-table__th">PO</th>
                  <th className="si-view-table__th si-view-table__th--num">Qty (kg)</th>
                  <th className="si-view-table__th">Keterangan</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.length > 0 ? (
                  breakdown.map((row, i) => (
                    <tr key={i}>
                      <td className="si-view-table__cell">{row.shipper || '—'}</td>
                      <td className="si-view-table__cell">{row.contractNo || '—'}</td>
                      <td className="si-view-table__cell">{row.poNo || '—'}</td>
                      <td className="si-view-table__cell si-view-table__cell--num">
                        {row.qtyKg != null ? Number(row.qtyKg).toLocaleString('id-ID') : '—'}
                      </td>
                      <td className="si-view-table__cell">{row.remarks || '—'}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="si-view-table__cell">{si.shipper || '—'}</td>
                    <td className="si-view-table__cell">—</td>
                    <td className="si-view-table__cell">—</td>
                    <td className="si-view-table__cell si-view-table__cell--num">
                      {totalQty != null ? Number(totalQty).toLocaleString('id-ID') : '—'}
                    </td>
                    <td className="si-view-table__cell">—</td>
                  </tr>
                )}
                <tr className="si-view-table__total">
                  <td colSpan={3} className="si-view-table__cell si-view-table__cell--total-label">TOTAL</td>
                  <td className="si-view-table__cell si-view-table__cell--num si-view-table__cell--total">
                    {totalQty != null ? Number(totalQty).toLocaleString('id-ID') : '—'}
                  </td>
                  <td className="si-view-table__cell" />
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
