import { useEffect, useState } from 'react'
import { fetchShippingInstruction, fetchSiNpwpMaster } from '../api/shippingInstructions'
import SiDocumentView from './SiDocumentView'
import FlowPill from './FlowPill'
import { mapApiToSi, canViewAsDocument } from '../utils/siViewModel'
import '../styles/modal.css'
import '../styles/si-view.css'
import '../styles/si-approval.css'

export default function SiDocumentModal({ isOpen, siId, onClose }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [si, setSi] = useState(null)
  const [npwpMaster, setNpwpMaster] = useState(null)

  useEffect(() => {
    if (!isOpen || !siId) return
    let cancelled = false
    setLoading(true)
    setError('')
    setSi(null)
    fetchShippingInstruction(siId)
      .then((row) => {
        if (!cancelled) setSi(mapApiToSi(row))
      })
      .catch((err) => {
        if (!cancelled) {
          setSi(null)
          setError(err?.message || 'Failed to load shipping instruction')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [isOpen, siId])

  useEffect(() => {
    if (!isOpen || !si) return
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
  }, [isOpen, si?.resolvedPortId, si?.id])

  if (!isOpen) return null

  const canView = si && canViewAsDocument(si)

  return (
    <div className="modal-overlay" onClick={onClose} aria-hidden="true">
      <div
        className="modal modal--wide si-document-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="si-document-modal-title"
      >
        <div className="modal__header-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
          <h2 id="si-document-modal-title" className="modal__title" style={{ margin: 0 }}>
            <span className="page-title-row" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <span>Shipping Instruction</span>
              {si ? <FlowPill purpose={si.purpose} /> : null}
            </span>
          </h2>
          <button type="button" className="btn btn--secondary btn--small" onClick={onClose}>
            Close
          </button>
        </div>
        {si ? <span className="si-view-meta">{si.siId || si.id}</span> : null}

        <div className="si-document-modal__body">
          {loading ? (
            <p className="text-steel">Loading…</p>
          ) : error ? (
            <p style={{ color: '#c00' }}>{error}</p>
          ) : !si ? (
            <div className="card">
              <p className="text-steel">Shipping Instruction not found.</p>
            </div>
          ) : !canView ? (
            <div className="card si-view-unavailable">
              <h3 className="si-view-unavailable__title">View not available</h3>
              <p className="text-steel">
                This Shipping Instruction is not available for document view. The printable form is available after <strong>approval sign-off</strong> (status Approved — for Unloading this shows as <strong>Confirmed</strong> in the list).
              </p>
            </div>
          ) : (
            <SiDocumentView si={si} npwpMaster={npwpMaster} />
          )}
        </div>
      </div>
    </div>
  )
}
