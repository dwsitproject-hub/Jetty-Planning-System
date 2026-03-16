import { useState, useCallback, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { getPorts, getJettiesByPort, getJettyLayout, setJettyLayout, buildDefaultJettyLayout } from '../data/masterData'
import { useActivityLog } from '../context/ActivityLogContext'
import '../styles/allocation.css'
import '../styles/modal.css'

const MIN_COLUMNS = 1
const MAX_COLUMNS = 12

const emptyColumn = () => ({
  top: { type: 'unused' },
  middle: { type: 'block' },
  bottom: { type: 'unused' },
})

export default function MasterJettyLayout() {
  const { logActivity } = useActivityLog()
  const [ports, setPorts] = useState(() => getPorts())
  const [selectedPortId, setSelectedPortId] = useState('')
  const [columnCount, setColumnCount] = useState(3)
  const [columns, setColumns] = useState(() => [emptyColumn(), emptyColumn(), emptyColumn()])
  const [saved, setSaved] = useState(false)

  const jetties = selectedPortId ? getJettiesByPort(selectedPortId) : []

  useEffect(() => {
    if (!selectedPortId) {
      setColumns([emptyColumn(), emptyColumn(), emptyColumn()])
      setColumnCount(3)
      return
    }
    const layout = getJettyLayout(selectedPortId)
    if (layout && layout.columns && layout.columns.length > 0) {
      setColumns(layout.columns.map((c) => ({ ...c, top: { ...c.top }, middle: { ...c.middle }, bottom: { ...c.bottom } })))
      setColumnCount(layout.columns.length)
    } else {
      const def = buildDefaultJettyLayout(selectedPortId)
      if (def.columns.length > 0) {
        setColumns(def.columns.map((c) => ({ ...c, top: { ...c.top }, middle: { ...c.middle }, bottom: { ...c.bottom } })))
        setColumnCount(def.columns.length)
      } else {
        setColumns([emptyColumn()])
        setColumnCount(1)
      }
    }
  }, [selectedPortId])

  const setColumnCountAndResize = useCallback((n) => {
    const num = Math.max(MIN_COLUMNS, Math.min(MAX_COLUMNS, parseInt(n, 10) || 1))
    setColumnCount(num)
    setColumns((prev) => {
      const next = prev.slice(0, num)
      while (next.length < num) next.push(emptyColumn())
      return next
    })
  }, [])

  const updateColumn = useCallback((colIndex, row, value) => {
    if (row === 'top') {
      setColumns((prev) => {
        const next = prev.map((c, i) => (i === colIndex ? { ...c, top: value } : c))
        return next
      })
    } else if (row === 'middle') {
      setColumns((prev) => {
        const next = prev.map((c, i) => (i === colIndex ? { ...c, middle: value } : c))
        return next
      })
    } else if (row === 'bottom') {
      setColumns((prev) => {
        const next = prev.map((c, i) => (i === colIndex ? { ...c, bottom: value } : c))
        return next
      })
    }
  }, [])

  const handleSave = useCallback(() => {
    if (!selectedPortId) return
    setJettyLayout(selectedPortId, { portId: selectedPortId, columns })
    const portName = ports.find((p) => p.id === selectedPortId)?.name || selectedPortId
    logActivity({ pageKey: 'master-jetty-layout', action: 'update', entityType: 'Jetty Layout', entityLabel: portName })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }, [selectedPortId, columns, ports, logActivity])

  const handleUseDefault = useCallback(() => {
    if (!selectedPortId) return
    const def = buildDefaultJettyLayout(selectedPortId)
    if (def.columns.length > 0) {
      setColumns(def.columns.map((c) => ({ ...c, top: { ...c.top }, middle: { ...c.middle }, bottom: { ...c.bottom } })))
      setColumnCount(def.columns.length)
    }
  }, [selectedPortId])

  return (
    <div className="allocation-page">
      <h1 className="page-title">Master – Jetty Layout</h1>
      <p className="allocation-page__intro">
        Define how jetties are arranged in the Jetty Schematic for each port. Each column has a top slot, middle block, and bottom slot.
      </p>
      <p className="text-steel">
        <Link to="/master" className="link">← Back to Master Menu</Link>
      </p>

      <section className="card">
        <h2 className="card__title">Layout editor</h2>
        <div className="jetty-layout-editor">
          <div className="jetty-layout-editor__field">
            <label htmlFor="layout-port" className="modal__label">Port</label>
            <select
              id="layout-port"
              className="modal__input"
              value={selectedPortId}
              onChange={(e) => setSelectedPortId(e.target.value)}
            >
              <option value="">Select port</option>
              {ports.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          {selectedPortId && (
            <>
              <div className="jetty-layout-editor__field">
                <label htmlFor="layout-columns" className="modal__label">Number of columns</label>
                <input
                  id="layout-columns"
                  type="number"
                  min={MIN_COLUMNS}
                  max={MAX_COLUMNS}
                  className="modal__input"
                  value={columnCount}
                  onChange={(e) => setColumnCountAndResize(e.target.value)}
                />
              </div>
              <div className="jetty-layout-editor__actions">
                <button type="button" className="btn btn--secondary" onClick={handleUseDefault}>
                  Use default layout
                </button>
                <button type="button" className="btn btn--primary" onClick={handleSave} disabled={columns.length === 0}>
                  Save layout
                </button>
              </div>
              {saved && <p className="jetty-layout-editor__saved">Layout saved.</p>}

              <div className="jetty-layout-editor__grid-wrap">
                <p className="jetty-layout-editor__hint">Top = upper jetty label, Middle = block, Bottom = lower jetty label. Unused = empty cell.</p>
                <div className="jetty-layout-editor__grid">
                  {columns.map((col, colIndex) => (
                    <div key={colIndex} className="jetty-layout-editor__column">
                      <div className="jetty-layout-editor__cell">
                        <label className="jetty-layout-editor__cell-label">Top</label>
                        <select
                          className="modal__input"
                          value={col.top.type === 'jetty' ? col.top.jettyId : 'unused'}
                          onChange={(e) => {
                            const v = e.target.value
                            updateColumn(colIndex, 'top', v === 'unused' ? { type: 'unused' } : { type: 'jetty', jettyId: v })
                          }}
                        >
                          <option value="unused">Unused</option>
                          {jetties.map((j) => (
                            <option key={j.id} value={j.id}>{j.jettyName}</option>
                          ))}
                        </select>
                      </div>
                      <div className="jetty-layout-editor__cell">
                        <label className="jetty-layout-editor__cell-label">Middle</label>
                        <select
                          className="modal__input"
                          value={col.middle.type}
                          onChange={(e) => updateColumn(colIndex, 'middle', { type: e.target.value })}
                        >
                          <option value="unused">Unused</option>
                          <option value="block">Block</option>
                        </select>
                      </div>
                      <div className="jetty-layout-editor__cell">
                        <label className="jetty-layout-editor__cell-label">Bottom</label>
                        <select
                          className="modal__input"
                          value={col.bottom.type === 'jetty' ? col.bottom.jettyId : 'unused'}
                          onChange={(e) => {
                            const v = e.target.value
                            updateColumn(colIndex, 'bottom', v === 'unused' ? { type: 'unused' } : { type: 'jetty', jettyId: v })
                          }}
                        >
                          <option value="unused">Unused</option>
                          {jetties.map((j) => (
                            <option key={j.id} value={j.id}>{j.jettyName}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
          {!selectedPortId && <p className="text-steel">Select a port to edit its jetty layout.</p>}
        </div>
      </section>
    </div>
  )
}
