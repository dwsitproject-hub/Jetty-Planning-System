import { useEffect, useRef } from 'react'
import '../styles/modal.css'
import '../styles/jetty-spec-modal.css'

/** Splits a jetty's commodity list into Solid / Liquid groups (defaults unknown types to Liquid). */
function groupCommoditiesByType(list) {
  const groups = { Solid: [], Liquid: [] }
  for (const c of Array.isArray(list) ? list : []) {
    const type = c?.commodityType === 'Solid' ? 'Solid' : 'Liquid'
    groups[type].push(c)
  }
  return groups
}

function StatCard({ label, value }) {
  return (
    <div className="jetty-spec-modal__stat-card">
      <span className="jetty-spec-modal__stat-label">{label}</span>
      <span className="jetty-spec-modal__stat-value">{value ?? '—'}</span>
    </div>
  )
}

function CommodityBadgeGroup({ type, commodities }) {
  if (!commodities.length) return null
  return (
    <div className="jetty-spec-modal__commodity-group">
      <span
        className={`jetty-spec-modal__commodity-group-label jetty-spec-modal__commodity-group-label--${type.toLowerCase()}`}
      >
        {type}
      </span>
      <div className="jetty-spec-modal__commodity-badges">
        {commodities.map((c) => (
          <span
            key={c.id}
            className={`jetty-spec-modal__commodity-badge jetty-spec-modal__commodity-badge--${type.toLowerCase()}`}
          >
            {c.shortName || c.name}
          </span>
        ))}
      </div>
    </div>
  )
}

function CommodityColumn({ title, commodities }) {
  const { Solid, Liquid } = groupCommoditiesByType(commodities)
  const isEmpty = Solid.length === 0 && Liquid.length === 0
  return (
    <div className="jetty-spec-modal__commodity-col">
      <h3 className="jetty-spec-modal__commodity-col-title">{title}</h3>
      {isEmpty ? (
        <p className="jetty-spec-modal__commodity-empty">No commodities configured</p>
      ) : (
        <>
          <CommodityBadgeGroup type="Solid" commodities={Solid} />
          <CommodityBadgeGroup type="Liquid" commodities={Liquid} />
        </>
      )}
    </div>
  )
}

/**
 * Jetty specifications modal — opened by clicking a jetty label on the Jetty Schematic.
 * Shows general specs (capacity/length/draft/DWT) and commodity handling capabilities
 * grouped by operational purpose (unloading/loading) and commodity type (Solid/Liquid).
 */
export default function JettySpecModal({ jetty, onClose }) {
  const closeButtonRef = useRef(null)

  useEffect(() => {
    if (!jetty) return undefined
    function handleKeyDown(e) {
      if (e.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', handleKeyDown)
    closeButtonRef.current?.focus()
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [jetty, onClose])

  if (!jetty) return null

  const formatNumber = (n) => (n != null && Number.isFinite(Number(n)) ? Number(n).toLocaleString('en-US') : null)

  return (
    <div className="modal-overlay jetty-spec-modal-overlay" onClick={onClose} aria-hidden="true">
      <div
        className="modal modal--jetty-spec"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="jetty-spec-modal-title"
      >
        <div className="modal__header">
          <h2 id="jetty-spec-modal-title" className="modal__title modal__title--flush">
            {jetty.name} Specifications
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            className="modal__close"
            onClick={onClose}
            aria-label="Close jetty specifications"
          >
            ×
          </button>
        </div>

        <div className="modal__section jetty-spec-modal__section">
          <h3 className="jetty-spec-modal__section-title">General Specs</h3>
          <div className="jetty-spec-modal__stats">
            <StatCard label="Capacity" value={jetty.capacity ?? '—'} />
            <StatCard label="Length (m)" value={formatNumber(jetty.jettyLengthM)} />
            <StatCard label="Draft" value={formatNumber(jetty.jettyDraft)} />
            <StatCard label="DWT" value={formatNumber(jetty.jettyDwt)} />
          </div>
        </div>

        <hr className="modal__divider" />

        <div className="modal__section jetty-spec-modal__section">
          <h3 className="jetty-spec-modal__section-title">Commodities Handling</h3>
          <div className="jetty-spec-modal__commodities">
            <CommodityColumn title="Unloading Commodities" commodities={jetty.unloadingCommodities} />
            <CommodityColumn title="Loading Commodities" commodities={jetty.loadingCommodities} />
          </div>
        </div>
      </div>
    </div>
  )
}
