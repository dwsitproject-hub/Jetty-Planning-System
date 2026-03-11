import { useState, useEffect } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { nominations } from '../data/mockData'
import '../styles/si-approval.css'

const SI_FORM_COMPANY = {
  name: 'PT ENERGI UNGGUL PERSADA',
  address: 'GAMA TOWER, LT 41, JL HR RASUNA SAID, KAV C 22, KARET KUNINGAN, SETIABUDI, KOTA ADM. JAKARTA SELATAN, DKI JAKARTA, 12940',
}

function formatDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
}

/** Format date for SI form: "BONTANG, 09 JANUARY 2026" */
function formatFormDate(iso, location = 'BONTANG') {
  if (!iso) return `${location}, —`
  const d = new Date(iso)
  const day = d.getDate()
  const month = d.toLocaleString('en-GB', { month: 'long' }).toUpperCase()
  const year = d.getFullYear()
  return `${location}, ${day} ${month} ${year}`
}

/** SI document number for print form e.g. SI/EUP/2026/1/003 */
function getSiDocNumber(si) {
  const id = (si.siId || si.id || '003').toString().replace(/\D/g, '') || '003'
  const y = new Date().getFullYear()
  return `SI/EUP/${y}/1/${id.padStart(3, '0')}`
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
  const [approvalComments, setApprovalComments] = useState('')
  const [certified, setCertified] = useState(false)
  const [decision, setDecision] = useState(null) // null | 'approved' | 'rejected'
  const [approvalId, setApprovalId] = useState(null) // set when user clicks Approve & Sign-off
  const [uploadedManualDocs, setUploadedManualDocs] = useState([]) // { id, name, size }

  const siFromState = location.state?.si
  const siFromList = nominations.find((n) => (n.siId || '').toUpperCase() === (siId || '').toUpperCase() || n.id === siId)
  const si = siFromState || siFromList || null
  const lifecycle = si ? getMockLifecycle(si) : []

  useEffect(() => {
    if (!si && siId) {
      // Could show toast
    }
  }, [si, siId])

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

  const handleApprove = () => {
    if (!certified) return
    setApprovalId(generateApprovalId())
    setDecision('approved')
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
          <button type="button" className="btn btn--primary" onClick={() => navigate('/shipping-instruction')}>
            Back to Shipping Instructions
          </button>
        </div>
      </div>
    )
  }

  const isUnloading = (si.purpose || '').toLowerCase() === 'unloading'
  if (isUnloading) {
    return (
      <div className="si-approval-page">
        <div className="card si-approval-external">
          <h2 className="si-approval-external__title">External instruction</h2>
          <p className="si-approval-external__text">
            This is an <strong>Unloading</strong> SI. The instruction comes from external; no internal approval is required.
          </p>
          <p className="text-steel si-approval-external__hint">You can view the instruction in the Shipping Instruction list.</p>
          <button type="button" className="btn btn--primary" onClick={() => navigate('/shipping-instruction')}>
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
            onClick={() => navigate('/shipping-instruction')}
            aria-label="Back to Shipping Instructions"
          >
            ← Back
          </button>
          <h1 className="page-title">SI Approval Sign-off</h1>
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
              <dd>{si.loadingPort || 'BONTANG, INDONESIA'}</dd>
              <dt>Destination</dt>
              <dd>{si.destination || 'NANSHA, CHINA'}</dd>
              <dt>Bill of Lading</dt>
              <dd>{si.billOfLading || '3 NON-NEGOTIABLE BILLS OF LADING'}</dd>
              <dt>Consignee</dt>
              <dd>{si.consignee || 'TO ORDER'}</dd>
              <dt>Notify Party</dt>
              <dd>{si.notifyParty || '—'}</dd>
              <dt>Freight</dt>
              <dd>{si.term === 'CIF' ? 'PREPAID' : (si.term || 'PREPAID')}</dd>
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
              {decision === 'approved' && approvalId && (
                <div className="si-form__approval-remark">
                  Approved through Jetty Planning System.<br />
                  Approval ID : <strong className="si-form__approval-id">{approvalId}</strong>
                </div>
              )}
              <div className="si-form__approval-signature" />
              <div className="si-form__approval-name">RUDI HARTONO</div>
              <div className="si-form__approval-title">OPERATION HEAD</div>
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
              <div className="si-approval-signoff__actions">
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={handleApprove}
                  disabled={!certified}
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
              <button type="button" className="btn btn--primary" onClick={() => navigate('/shipping-instruction')}>
                Back to Shipping Instructions
              </button>
            </div>
          )}

          {decision === 'rejected' && (
            <div className="card si-approval-result si-approval-result--rejected">
              <p><strong>SI has been rejected / queried.</strong></p>
              <p className="text-steel">The submitter will be notified.</p>
              <button type="button" className="btn btn--primary" onClick={() => navigate('/shipping-instruction')}>
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
