import { berths as defaultBerths, vessels } from '../data/mockData'
import { getJettyLayout, getJettyById } from '../data/masterData'
import '../styles/jetty-schematic.css'

function getOperationType(vessel) {
  if (!vessel) return 'DISCH'
  const s = (vessel.status || '').toUpperCase()
  const p = (vessel.phaseLabel || '').toUpperCase()
  if (s.includes('LOAD') || p.includes('LOAD')) return 'LOAD'
  return 'DISCH'
}

/** Fallback when no layout from master (e.g. port without layout) */
const FALLBACK_LAYOUT = [
  { jetty: 1, topId: '1A', bottomId: '1B' },
  { jetty: 2, topId: '2A', bottomId: '2B' },
  { jetty: 3, topId: '3A', bottomId: '3B' },
]

export default function JettySchematic({ berths: berthsProp, selectedBerthId, onSelectBerth, portId = 'p1' }) {
  const berths = berthsProp ?? defaultBerths
  const interactive = typeof onSelectBerth === 'function'
  const layout = getJettyLayout(portId)
  const useLayout = layout && layout.columns && layout.columns.length > 0

  function renderSlot(berthId, slotClassName, content) {
    const berth = berths.find((b) => b.id === berthId)
    const v = berth?.currentVesselId ? vessels[berth.currentVesselId] : null
    const selected = selectedBerthId === berthId
    const className = `${slotClassName} ${selected ? 'jetty-schematic__slot--selected' : ''}`
    const slotBody = (
      <>
        <span className="jetty-schematic__slot-jetty-name" aria-hidden>Jetty {berthId}</span>
        {content}
      </>
    )

    if (interactive) {
      return (
        <button
          type="button"
          className={className}
          onClick={() => onSelectBerth(berthId)}
          title={`Jetty ${berthId}`}
        >
          {slotBody}
        </button>
      )
    }
    return (
      <div className={className} title={`Jetty ${berthId}`} role="img" aria-label={v ? `${berthId}: ${v.vesselName}` : `${berthId}: Vacant`}>
        {slotBody}
      </div>
    )
  }

  function slotContent(v) {
    if (!v) return 'Vacant'
    const op = getOperationType(v)
    return (
      <span className="jetty-slot__inner">
        <span className="jetty-slot__title">{v.vesselName}</span>
        <span className="jetty-slot__line">SI No: {v.siId ?? '—'}</span>
        <span className="jetty-slot__line">Purpose: {v.purpose ?? (op === 'LOAD' ? 'Loading' : 'Unloading')}</span>
        <span className="jetty-slot__line">Material: {v.product ?? v.commodity ?? '—'}</span>
        <span className="jetty-slot__row">
          <span className="jetty-slot__eta">ETA completion: {v.etaToCompletion ?? '—'}</span>
          <span className={`jetty-slot__rag jetty-slot__rag--${v.ragStatus || 'green'}`} title={v.ragStatus === 'red' ? 'Alert' : v.ragStatus === 'amber' ? 'Risk' : 'On track'} />
        </span>
      </span>
    )
  }

  if (useLayout) {
    return (
      <section className="card jetty-schematic-section">
        <h2 className="card__title">Jetty Schematic</h2>
        <div className="jetty-schematic-wrap">
          <div className="jetty-schematic">
            {layout.columns.map((col, colIndex) => {
              const topBerthId = col.top?.type === 'jetty' && col.top.jettyId ? (getJettyById(col.top.jettyId)?.jettyName ?? null) : null
              const bottomBerthId = col.bottom?.type === 'jetty' && col.bottom.jettyId ? (getJettyById(col.bottom.jettyId)?.jettyName ?? null) : null
              const topBerth = topBerthId ? berths.find((b) => b.id === topBerthId) : null
              const bottomBerth = bottomBerthId ? berths.find((b) => b.id === bottomBerthId) : null
              const topV = topBerth?.currentVesselId ? vessels[topBerth.currentVesselId] : null
              const bottomV = bottomBerth?.currentVesselId ? vessels[bottomBerth.currentVesselId] : null
              const topOp = topV ? getOperationType(topV) : null
              const bottomOp = bottomV ? getOperationType(bottomV) : null
              const topSlotClass = topV ? `jetty-schematic__slot jetty-schematic__slot--${topOp === 'LOAD' ? 'load' : 'disch'} jetty-schematic__slot--rag-${topV.ragStatus || 'green'}` : 'jetty-schematic__slot jetty-schematic__slot--vacant'
              const bottomSlotClass = bottomV ? `jetty-schematic__slot jetty-schematic__slot--${bottomOp === 'LOAD' ? 'load' : 'disch'} jetty-schematic__slot--rag-${bottomV.ragStatus || 'green'}` : 'jetty-schematic__slot jetty-schematic__slot--vacant'

              return (
                <div key={colIndex} className="jetty-schematic__column">
                  {col.top?.type === 'jetty' && topBerthId ? (
                    renderSlot(topBerthId, topSlotClass, slotContent(topV))
                  ) : (
                    <div className="jetty-schematic__slot jetty-schematic__slot--vacant jetty-schematic__slot--empty" aria-hidden><span className="jetty-schematic__slot-jetty-name">—</span></div>
                  )}
                  {col.middle?.type === 'block' ? (
                    <div className="jetty-schematic__pipeline-segment" aria-hidden />
                  ) : (
                    <div className="jetty-schematic__slot jetty-schematic__slot--vacant jetty-schematic__slot--empty" aria-hidden>—</div>
                  )}
                  {col.bottom?.type === 'jetty' && bottomBerthId ? (
                    renderSlot(bottomBerthId, bottomSlotClass, slotContent(bottomV))
                  ) : (
                    <div className="jetty-schematic__slot jetty-schematic__slot--vacant jetty-schematic__slot--empty" aria-hidden><span className="jetty-schematic__slot-jetty-name">—</span></div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="card jetty-schematic-section">
      <h2 className="card__title">Jetty Schematic</h2>
      <div className="jetty-schematic-wrap">
        <div className="jetty-schematic">
          {FALLBACK_LAYOUT.map(({ jetty, topId, bottomId }) => {
            const topBerth = berths.find((b) => b.id === topId)
            const bottomBerth = bottomId ? berths.find((b) => b.id === bottomId) : null
            const topV = topBerth?.currentVesselId ? vessels[topBerth.currentVesselId] : null
            const bottomV = bottomBerth?.currentVesselId ? vessels[bottomBerth.currentVesselId] : null
            const topOp = topV ? getOperationType(topV) : null
            const bottomOp = bottomV ? getOperationType(bottomV) : null
            const topSlotClass = `jetty-schematic__slot ${topV ? `jetty-schematic__slot--${topOp === 'LOAD' ? 'load' : 'disch'} jetty-schematic__slot--rag-${topV.ragStatus || 'green'}` : 'jetty-schematic__slot--vacant'}`
            const bottomSlotClass = bottomV ? `jetty-schematic__slot jetty-schematic__slot--${bottomOp === 'LOAD' ? 'load' : 'disch'} jetty-schematic__slot--rag-${bottomV.ragStatus || 'green'}` : 'jetty-schematic__slot jetty-schematic__slot--vacant'

            return (
              <div key={jetty} className="jetty-schematic__column">
                {renderSlot(topId, topSlotClass, slotContent(topV))}
                <div className="jetty-schematic__pipeline-segment" aria-hidden />
                {bottomId ? (
                  renderSlot(bottomId, bottomSlotClass, slotContent(bottomV))
                ) : (
                  <div className="jetty-schematic__slot jetty-schematic__slot--vacant jetty-schematic__slot--empty" aria-hidden>—</div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
