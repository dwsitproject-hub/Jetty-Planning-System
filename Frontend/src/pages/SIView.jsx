import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { fetchShippingInstruction, fetchSiNpwpMaster } from '../api/shippingInstructions'
import { formatBlSplitFromBreakdown, getPrintedSiNumber, formatFreightForSi } from '../utils/siBlSplit'
import { formatSiSignOffDate } from '../utils/siFormPlaceDate'
import SiFormReferenceDates from '../components/SiFormReferenceDates'
import FlowPill from '../components/FlowPill'
import '../styles/si-view.css'
import '../styles/si-approval.css'

const SI_FORM_COMPANY = {
  name: 'PT ENERGI UNGGUL PERSADA',
  address: 'GAMA TOWER, LT 41, JL HR RASUNA SAID, KAV C 22, KARET KUNINGAN, SETIABUDI, KOTA ADM. JAKARTA SELATAN, DKI JAKARTA, 12940',
}

/** Same rule as main list: formal document after approval (Loading or Unloading). */
function canViewAsDocument(si) {
  if (!si) return false
  return (si.status || '').toLowerCase() === 'approved'
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

function mapApiToSi(row) {
  if (!row) return null
  return {
    id: row.id,
    siId: row.referenceNumber || `SI-${row.id}`,
    referenceNumber: row.referenceNumber ?? null,
    vesselName: row.vesselName,
    voyageNo: row.voyageNo ?? null,
    purpose: row.purpose,
    purposeId: row.purposeId ?? null,
    status: row.status,
    approvalId: row.approvalId ?? null,
    commodity: row.commodity,
    commodityId: row.commodityId ?? null,
    etaDateTime: row.eta,
    etaFrom: row.etaFrom ?? null,
    etaTo: row.etaTo ?? null,
    documentDate: row.documentDate ?? null,
    destinationText: row.destinationText ?? null,
    freightTerms: row.freightTerms ?? null,
    billOfLadingClause: row.billOfLadingClause ?? null,
    consigneeText: row.consigneeText ?? null,
    notifyPartyText: row.notifyPartyText ?? null,
    blIndicated: row.blIndicated ?? null,
    approverNameSnapshot: row.approverNameSnapshot ?? null,
    approverTitleSnapshot: row.approverTitleSnapshot ?? null,
    breakdown: Array.isArray(row.breakdown) ? row.breakdown : [],
    shipper: row.shipperName ?? '—',
    loadingPort: row.loadingPortName ?? '—',
    agent: row.agentName ?? '—',
    surveyor: row.surveyorName ?? '—',
    term: row.tradeTermCode ?? '—',
    note: row.note ?? null,
    receivedAt: row.createdAt ?? null,
    updatedAt: row.updatedAt ?? null,
    resolvedPortId: row.resolvedPortId ?? null,
  }
}

export default function SIView() {
  const { siId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const isEmbed = new URLSearchParams(location.search).get('embed') === '1'
  const siFromState = location.state?.si
  const [apiSi, setApiSi] = useState(null)
  const [npwpMaster, setNpwpMaster] = useState(null)
  const numId = parseInt(siId, 10)
  useEffect(() => {
    if (Number.isNaN(numId)) {
      setApiSi(null)
      return
    }
    let c = false
    fetchShippingInstruction(numId)
      .then((row) => {
        if (!c) setApiSi(mapApiToSi(row))
      })
      .catch(() => {
        if (!c) setApiSi(null)
      })
    return () => {
      c = true
    }
  }, [siId, numId])
  // Prefer API row (ensures DB-consistent view); fall back to navigation state only if API missing.
  const si = apiSi || siFromState || null

  useEffect(() => {
    if (!si) return
    const portId = si?.resolvedPortId
    let cancelled = false
    fetchSiNpwpMaster(portId)
      .then((r) => {
        if (!cancelled) setNpwpMaster(r?.npwp ?? null)
      })
      .catch(() => {
        if (!cancelled) setNpwpMaster(null)
      })
    return () => {
      cancelled = true
    }
  }, [si?.resolvedPortId, si?.id])

  const canView = si && canViewAsDocument(si)
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
            This Shipping Instruction is not available for document view. The printable form is available after <strong>approval sign-off</strong> (status Approved — for Unloading this shows as <strong>Confirmed</strong> in the list).
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
    <div className={`si-view-page${isEmbed ? ' si-view-page--embed' : ''}`}>
      {!isEmbed && (
      <header className="si-view-header no-print">
        <button
          type="button"
          className="btn btn--secondary btn--small"
          onClick={() => navigate('/shipping-instruction')}
          aria-label="Back to Shipping Instructions"
        >
          ← Back
        </button>
        <h1 className="page-title page-title-row">
          <span>Shipping Instruction</span>
          <FlowPill purpose={si?.purpose} />
        </h1>
        <span className="si-view-meta">{si.siId || si.id}</span>
      </header>
      )}

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
              <dd><strong>{totalQtyLabel}</strong></dd>
              <dt>BL Split</dt>
              <dd><strong>{formatBlSplitFromBreakdown(breakdown)}</strong></dd>
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
              <dd>{SI_FORM_COMPANY.name} {SI_FORM_COMPANY.address}</dd>
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
                  Approved through Jetty Planning System.<br />
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
                  <td colSpan={5} className="si-view-table__cell si-view-table__cell--total-label">TOTAL</td>
                  <td className="si-view-table__cell si-view-table__cell--total">{totalQtyLabel}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
