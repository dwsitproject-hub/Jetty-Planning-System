import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { fetchShippingInstruction, fetchSiNpwpMaster } from '../api/shippingInstructions'
import SiDocumentView from '../components/SiDocumentView'
import FlowPill from '../components/FlowPill'
import { mapApiToSi, canViewAsDocument } from '../utils/siViewModel'
import '../styles/si-view.css'
import '../styles/si-approval.css'

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
  const si = apiSi ?? (siFromState ? mapApiToSi(siFromState) : null)

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

  if (!si) {
    return (
      <div className="si-view-page">
        <div className="card">
          <p className="text-steel">Shipping Instruction not found for ID: {siId || '—'}.</p>
          <button type="button" className="btn btn--primary" onClick={() => navigate('/shipment-plans')}>
            Back to Shipment plans
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
          <button type="button" className="btn btn--primary" onClick={() => navigate('/shipment-plans')}>
            Back to Shipment plans
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={`si-view-page${isEmbed ? ' si-view-page--embed' : ''}`}>
      {!isEmbed && (
        <header className="si-view-header no-print">
          <button
            type="button"
            className="btn btn--secondary btn--small"
            onClick={() => navigate('/shipment-plans')}
            aria-label="Back to Shipment plans"
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

      <SiDocumentView si={si} npwpMaster={npwpMaster} />
    </div>
  )
}
