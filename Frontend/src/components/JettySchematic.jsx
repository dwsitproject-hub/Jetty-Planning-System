import { berths as defaultBerths, vessels } from '../data/mockData'
import '../styles/jetty-schematic.css'

function getOperationType(vessel) {
  if (!vessel) return 'DISCH'
  const s = (vessel.status || '').toUpperCase()
  const p = (vessel.phaseLabel || '').toUpperCase()
  if (s.includes('LOAD') || p.includes('LOAD')) return 'LOAD'
  return 'DISCH'
}

function formatQtyK(quantity) {
  if (quantity == null) return '—'
  const k = Number(quantity) / 1000
  return k >= 1 ? `${k % 1 === 0 ? k : k.toFixed(1)}K` : String(quantity)
}

const JETTY_LAYOUT = [
  { jetty: 1, topId: '1A', bottomId: '1B' },
  { jetty: 2, topId: '2A', bottomId: '2B' },
  { jetty: 3, topId: '3A', bottomId: '3B' },
]

export default function JettySchematic({ berths: berthsProp, selectedBerthId, onSelectBerth }) {
  const berths = berthsProp ?? defaultBerths
  const interactive = typeof onSelectBerth === 'function'

  function renderSlot(berthId, slotClassName, content) {
    const berth = berths.find((b) => b.id === berthId)
    const v = berth?.currentVesselId ? vessels[berth.currentVesselId] : null
    const selected = selectedBerthId === berthId
    const className = `${slotClassName} ${selected ? 'jetty-schematic__slot--selected' : ''}`

    if (interactive) {
      return (
        <button
          type="button"
          className={className}
          onClick={() => onSelectBerth(berthId)}
          title={berthId}
        >
          {content}
        </button>
      )
    }
    return (
      <div className={className} title={berthId} role="img" aria-label={v ? `${berthId}: ${v.vesselName}` : `${berthId}: Vacant`}>
        {content}
      </div>
    )
  }

  return (
    <section className="card jetty-schematic-section">
      <h2 className="card__title">🚢 Jetty Schematic</h2>
      <div className="jetty-schematic-wrap">
        <div className="jetty-schematic">
          {JETTY_LAYOUT.map(({ jetty, topId, bottomId }) => {
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
                {renderSlot(
                  topId,
                  topSlotClass,
                  topV ? (
                    <span className="jetty-slot__inner">
                      <span className="jetty-slot__title">{topV.vesselName}</span>
                      <span className="jetty-slot__line">SI No: {topV.siId ?? '—'}</span>
                      <span className="jetty-slot__line">Purpose: {topV.purpose ?? (topOp === 'LOAD' ? 'Loading' : 'Unloading')}</span>
                      <span className="jetty-slot__line">Material: {topV.product ?? topV.commodity ?? '—'}</span>
                      <span className="jetty-slot__row">
                        <span className="jetty-slot__eta">ETA completion: {topV.etaToCompletion ?? '—'}</span>
                        <span className={`jetty-slot__rag jetty-slot__rag--${topV.ragStatus || 'green'}`} title={topV.ragStatus === 'red' ? 'Alert' : topV.ragStatus === 'amber' ? 'Risk' : 'On track'} />
                      </span>
                    </span>
                  ) : (
                    'Vacant'
                  )
                )}
                <div className="jetty-schematic__pipeline-segment">{jetty}</div>
                {bottomId ? (
                  renderSlot(
                    bottomId,
                    bottomSlotClass,
                    bottomV ? (
                      <span className="jetty-slot__inner">
                        <span className="jetty-slot__title">{bottomV.vesselName}</span>
                        <span className="jetty-slot__line">SI No: {bottomV.siId ?? '—'}</span>
                        <span className="jetty-slot__line">Purpose: {bottomV.purpose ?? (bottomOp === 'LOAD' ? 'Loading' : 'Unloading')}</span>
                        <span className="jetty-slot__line">Material: {bottomV.product ?? bottomV.commodity ?? '—'}</span>
                        <span className="jetty-slot__row">
                          <span className="jetty-slot__eta">ETA completion: {bottomV.etaToCompletion ?? '—'}</span>
                          <span className={`jetty-slot__rag jetty-slot__rag--${bottomV.ragStatus || 'green'}`} title={bottomV.ragStatus === 'red' ? 'Alert' : bottomV.ragStatus === 'amber' ? 'Risk' : 'On track'} />
                        </span>
                      </span>
                    ) : (
                      'Vacant'
                    )
                  )
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
