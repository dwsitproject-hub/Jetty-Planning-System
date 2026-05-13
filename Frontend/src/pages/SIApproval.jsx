import { useState, useEffect } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { fetchShippingInstruction, fetchSiNpwpMaster, updateShippingInstruction } from '../api/shippingInstructions'
import { useRbac } from '../context/RbacContext'
import { formatBlSplitFromBreakdown, getPrintedSiNumber, formatFreightForSi } from '../utils/siBlSplit'
import { formatSiSignOffDate } from '../utils/siFormPlaceDate'
import SiFormReferenceDates from '../components/SiFormReferenceDates'
import FlowPill from '../components/FlowPill'
import '../styles/si-approval.css'
import '../styles/si-view.css'
import { MAX_SI_APPROVAL_COMMENTS_CHARS } from '../constants/inputLimits'

const SI_FORM_COMPANY = {
  name: 'PT ENERGI UNGGUL PERSADA',
  address: 'GAMA TOWER, LT 41, JL HR RASUNA SAID, KAV C 22, KARET KUNINGAN, SETIABUDI, KOTA ADM. JAKARTA SELATAN, DKI JAKARTA, 12940',
}

function formatDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
}

function formatEtaBontang(si) {
  const from = si.etaFrom
  const to = si.etaTo
  if (!from && !to) {
    return si.etaDateTime ? new Date(si.etaDateTime).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
  }
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

function mapShippingInstructionRow(row) {
  if (!row) return null
  return {
    id: row.id,
    referenceNumber: row.referenceNumber ?? null,
    siId: row.referenceNumber || `SI-${row.id}`,
    vesselName: row.vesselName,
    voyageNo: row.voyageNo ?? null,
    purpose: row.purpose,
    purposeId: row.purposeId ?? null,
    status: row.status,
    approvalId: row.approvalId ?? null,
    approvedAt: row.approvedAt ?? null,
    commodity: row.commodity,
    commodityId: row.commodityId ?? null,
    etaDateTime: row.eta,
    etaFrom: row.etaFrom,
    etaTo: row.etaTo,
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
    surveyor: row.surveyorName ?? '—',
    agent: row.agentName ?? '—',
    loadingPort: row.loadingPortName ?? '—',
    term: row.tradeTermCode ?? '—',
    receivedAt: row.createdAt,
    updatedAt: row.updatedAt ?? null,
    resolvedPortId: row.resolvedPortId ?? null,
  }
}

/** Mock lifecycle events for an SI */
function getMockLifecycle(si) {
  const received = si.receivedAt ? new Date(si.receivedAt) : null
  return [
    { label: 'Operation Head Review', by: 'Ops Commander (You)', time: 'Now', current: true },
    { label: 'QC Certification Uploaded', by: `QC / ${si.surveyor || '—'}`, time: received ? formatDate(si.receivedAt) : '—', current: false },
    { label: 'SI Draft Submitted', by: `Agent ${si.agent || '—'}`, time: received ? formatDate(si.receivedAt) : '—', current: false },
  ]
}

export default function SIApproval() {
  const { siId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { canApprove } = useRbac()
  const [approvalComments, setApprovalComments] = useState('')
  const [certified, setCertified] = useState(false)
  const [decision, setDecision] = useState(null) // null | 'approved' | 'rejected'
  const [approvalId, setApprovalId] = useState(null) // set when user clicks Approve & Sign-off
  const [uploadedManualDocs, setUploadedManualDocs] = useState([]) // { id, name, size }
  const [approveError, setApproveError] = useState(null)
  const [npwpMaster, setNpwpMaster] = useState(null)

  const siFromState = location.state?.si
  const [apiSi, setApiSi] = useState(null)
  const numId = parseInt(siId, 10)

  useEffect(() => {
    if (Number.isNaN(numId)) {
      setApiSi(null)
      return
    }
    let c = false
    fetchShippingInstruction(numId)
      .then((row) => {
        if (!c) setApiSi(mapShippingInstructionRow(row))
      })
      .catch(() => {
        if (!c) setApiSi(null)
      })
    return () => {
      c = true
    }
  }, [siId, numId])

  const si = apiSi || siFromState || null
  useEffect(() => {
    if (!si) return
    if ((si.status || '').toLowerCase() === 'approved') {
      setDecision('approved')
      setApprovalId(si.approvalId || null)
    }
  }, [si])

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

  const breakdownRows = si?.breakdown || []
  const purposeLower = (si?.purpose || '').toLowerCase()
  // Purpose values can vary (e.g. 'Unloading', 'UNLOADING', sometimes shorthand).
  const isUnloading =
    purposeLower === 'unloading' ||
    purposeLower.includes('unload') ||
    purposeLower === 'disch' ||
    purposeLower.includes('disch')
  const shipperLines = isUnloading ? getShipperLines(si) : []
  const totalsByUnit = breakdownRows.reduce((acc, r) => {
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
  const lifecycle = si ? getMockLifecycle(si) : []

  const handlePrint = () => {
    window.print()
  }

  const handleDownloadPDF = () => {
    window.print()
  }

  /** Generate a unique approval ID e.g. JPS-20260208-143052-A1B2 */
  const generateApprovalId = () => {
    const now = new Date()
    const date = now.toISOString().slice(0, 10).replace(/-/g, '')
    const time = now.toTimeString().slice(0, 8).replace(/:/g, '')
    const r = Math.random().toString(36).slice(2, 6).toUpperCase()
    return `JPS-${date}-${time}-${r}`
  }

  const handleApprove = async () => {
    if (!certified || !canApprove('shipment-plan')) return
    setApproveError(null)
    const nextApprovalId = generateApprovalId()
    const sid = si?.id != null && !Number.isNaN(Number(si.id)) ? Number(si.id) : Number.isNaN(numId) ? null : numId
    if (sid == null) return
    try {
      await updateShippingInstruction(sid, {
        vesselName: si.vesselName,
        purpose: si.purpose,
        purposeId: si.purposeId,
        eta: si.etaDateTime,
        status: 'Approved',
        approvalId: nextApprovalId,
      })
      const row = await fetchShippingInstruction(sid)
      setApiSi(mapShippingInstructionRow(row))
      setApprovalId(row.approvalId || nextApprovalId)
      setDecision('approved')
    } catch (e) {
      setApproveError(e?.message || 'Approval failed')
    }
  }

  const handleReject = () => {
    setDecision('rejected')
  }

  const handleUploadManual = (e) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    const newDocs = Array.from(files).map((f) => ({
      id: 'manual-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      name: f.name,
      size: f.size,
    }))
    setUploadedManualDocs((prev) => [...prev, ...newDocs])
    e.target.value = ''
  }

  const removeUploadedDoc = (id) => {
    setUploadedManualDocs((prev) => prev.filter((d) => d.id !== id))
  }

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }

  if (!si) {
    return (
      <div className="si-approval-page">
        <div className="card">
          <p className="text-steel">Shipping Instruction not found for ID: {siId || '—'}.</p>
          <button type="button" className="btn btn--primary" onClick={() => navigate('/shipment-plans')}>
            Back to Shipping Instructions
          </button>
        </div>
      </div>
    )
  }

  const statusLabel = decision === 'approved' ? 'Approved' : decision === 'rejected' ? 'Rejected' : 'Pending Operation Head'
  const existingDocs = (si.documents || []).map((d) => ({ ...d, size: d.size || 1200000 }))
  const attachments = [...existingDocs, ...uploadedManualDocs]

  return (
    <div className="si-approval-page">
      <header className="si-approval-header no-print">
        <div className="si-approval-header__left">
          <button
            type="button"
            className="btn btn--secondary btn--small si-approval-back no-print"
            onClick={() => navigate('/shipment-plans')}
            aria-label="Back to Shipping Instructions"
          >
            ← Back
          </button>
          <h1 className="page-title page-title-row">
            <span>SI Approval Sign-off</span>
            <FlowPill purpose={si?.purpose} />
          </h1>
          <span className={`si-approval-status si-approval-status--${(decision || si.status || 'submitted').toLowerCase()}`}>
            {statusLabel}
          </span>
        </div>
        <div className="si-approval-header__actions no-print">
          <button type="button" className="btn btn--secondary" onClick={handlePrint}>
            🖨 Print Form
          </button>
          <button type="button" className="btn btn--secondary" onClick={handleDownloadPDF}>
            ⬇ Download PDF
          </button>
        </div>
      </header>

      <div className="si-approval-layout">
        <div className="si-approval-main si-approval-form-print">
          <div className="si-form">
            {!isUnloading && (
              <>
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
              </>
            )}
          {isUnloading ? (
            <>
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
                    {breakdownRows.length > 0 ? (
                      breakdownRows.map((row, i) => (
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
            </>
          ) : (
            <dl className="si-form__body">
              <dt>Vessel Name</dt>
              <dd>
                {si.vesselName || si.vesselId || '—'}
                {si.voyageNo ? ` ${si.voyageNo}` : ''}
              </dd>
              <dt>Descr. of Good</dt>
              <dd>{si.commodity || si.product || '—'}</dd>
              <dt>Quantity</dt>
              <dd><strong>{totalQtyLabel}</strong></dd>
              <dt>BL Split</dt>
              <dd><strong>{formatBlSplitFromBreakdown(breakdownRows)}</strong></dd>
              <dt>Shipment From</dt>
              <dd>{si.loadingPort || 'BONTANG, INDONESIA'}</dd>
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
          )}
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
              {decision === 'approved' && approvalId && (
                <div className="si-form__approval-remark">
                  Approved through Jetty Planning System.<br />
                  Approval ID : <strong className="si-form__approval-id">{approvalId}</strong>
                </div>
              )}
              <div className="si-form__approval-signature" />
              <div className="si-form__approval-name">
                {(decision === 'approved' || (si.status || '').toLowerCase() === 'approved')
                  ? (si.approverNameSnapshot || '—')
                  : '—'}
              </div>
              <div className="si-form__approval-title">
                {(decision === 'approved' || (si.status || '').toLowerCase() === 'approved')
                  ? (si.approverTitleSnapshot || 'OPERATION HEAD')
                  : 'OPERATION HEAD'}
              </div>
            </div>
          </div>
        </div>

        <aside className="si-approval-sidebar no-print">
          <section className="card si-approval-card">
            <h2 className="si-approval-card__title">📄 Verified Attachments</h2>
            <ul className="si-approval-attachments">
              {attachments.map((d) => (
                <li key={d.id} className="si-approval-attachments__item">
                  <span className="si-approval-attachments__name">{d.name}</span>
                  <span className="si-approval-attachments__size">{d.size ? formatFileSize(d.size) : ''}</span>
                  <button type="button" className="btn btn--secondary btn--small si-approval-attachments__action" title="Download" aria-label={`Download ${d.name}`}>⬇</button>
                  {uploadedManualDocs.some((u) => u.id === d.id) && (
                    <button type="button" className="btn btn--secondary btn--small" onClick={() => removeUploadedDoc(d.id)} aria-label={`Remove ${d.name}`}>Remove</button>
                  )}
                </li>
              ))}
            </ul>
            <div className="si-approval-upload">
              <label className="si-approval-upload__label">Upload manual signing document</label>
              <input type="file" accept=".pdf,.doc,.docx" onChange={handleUploadManual} className="si-approval-upload__input" aria-label="Upload manual signing document" />
            </div>
          </section>
          {!decision && (
            <section className="card si-approval-signoff">
              <h2 className="si-approval-signoff__title">👤 Executive Decision – Sign-off Confirmation</h2>
              <div className="si-approval-signoff__section">
                <label htmlFor="approval-comments" className="modal__label">Approval comments</label>
                <textarea
                  id="approval-comments"
                  className="modal__textarea si-approval-signoff__comments"
                  placeholder="Enter operational notes or specific clearance instructions..."
                  value={approvalComments}
                  onChange={(e) => setApprovalComments(e.target.value)}
                  maxLength={MAX_SI_APPROVAL_COMMENTS_CHARS}
                  rows={4}
                />
              </div>
              <div className="si-approval-signoff__certify">
                <label className="si-approval-signoff__certify-label">
                  <input
                    type="checkbox"
                    checked={certified}
                    onChange={(e) => setCertified(e.target.checked)}
                    className="si-approval-signoff__certify-checkbox"
                  />
                  <span>
                    By clicking &lsquo;Approve,&rsquo; you certify that all safety protocols have been reviewed and the vessel is cleared for jetty operations according to Port Bylaw 14-C.
                  </span>
                </label>
              </div>
              {!canApprove('shipment-plan') && (
                <p className="text-steel" style={{ marginBottom: 'var(--spacing-2)', color: 'var(--danger-600, #b00)' }}>
                  You do not have permission to approve shipping instructions. Ask an administrator to grant{' '}
                  <strong>Approve SI</strong> on the Shipping Instruction page for your role.
                </p>
              )}
              {approveError && (
                <p className="text-steel" style={{ marginBottom: 'var(--spacing-2)', color: 'var(--danger-600, #b00)' }} role="alert">
                  {approveError}
                </p>
              )}
              <div className="si-approval-signoff__actions">
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={handleApprove}
                  disabled={!certified || !canApprove('shipment-plan')}
                >
                  ✓ Approve & Sign-off
                </button>
                <button type="button" className="btn btn--secondary si-approval-signoff__reject" onClick={handleReject}>
                  ✕ Reject / Query SI
                </button>
              </div>
            </section>
          )}

          {decision === 'approved' && (
            <div className="card si-approval-result si-approval-result--success">
              <p><strong>SI has been approved and signed off.</strong></p>
              <p className="text-steel">Operations can begin as per this instruction.</p>
              <button type="button" className="btn btn--primary" onClick={() => navigate('/shipment-plans')}>
                Back to Shipping Instructions
              </button>
            </div>
          )}

          {decision === 'rejected' && (
            <div className="card si-approval-result si-approval-result--rejected">
              <p><strong>SI has been rejected / queried.</strong></p>
              <p className="text-steel">The submitter will be notified.</p>
              <button type="button" className="btn btn--primary" onClick={() => navigate('/shipment-plans')}>
                Back to Shipping Instructions
              </button>
            </div>
          )}

          <section className="card si-approval-lifecycle">
            <h2 className="si-approval-lifecycle__title">🕐 SI Lifecycle History</h2>
            <ol className="si-approval-lifecycle__list">
              {lifecycle.map((event, i) => (
                <li key={i} className={`si-approval-lifecycle__item ${event.current ? 'si-approval-lifecycle__item--current' : ''}`}>
                  <span className="si-approval-lifecycle__label">{event.label}</span>
                  <span className="si-approval-lifecycle__by">{event.by}</span>
                  <span className="si-approval-lifecycle__time">{event.time}</span>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </div>
  )
}
