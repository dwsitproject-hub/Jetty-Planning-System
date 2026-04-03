import { useState, useCallback, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { fetchJetties } from '../api/jetties'
import { fetchJettyLayout, saveJettyLayout } from '../api/jettyLayout'
import { usePortScope } from '../context/PortScopeContext'
import '../styles/allocation.css'
import '../styles/modal.css'
import '../styles/dashboard.css'
import '../styles/shipping-instruction.css'

const MIN_COLUMNS = 1
const MAX_COLUMNS = 12

const emptyColumn = () => ({
  top: { type: 'unused' },
  middle: { type: 'block' },
  bottom: { type: 'unused' },
})

export default function MasterJettyLayout() {
  const { selectedPortId, selectedPort, requiresSelection, noPortAssigned, noPortMessage } = usePortScope()
  const activePortId = selectedPortId != null ? String(selectedPortId) : ''
  const [columnCount, setColumnCount] = useState(3)
  const [columns, setColumns] = useState(() => [emptyColumn(), emptyColumn(), emptyColumn()])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [jetties, setJetties] = useState([])
  const [toast, setToast] = useState(null) // { message, variant }

  const canLoad = selectedPortId != null && !requiresSelection && !noPortAssigned

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 4500)
    return () => window.clearTimeout(t)
  }, [toast])

  useEffect(() => {
    if (!canLoad) {
      setColumns([emptyColumn(), emptyColumn(), emptyColumn()])
      setColumnCount(3)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        const [layout, jetList] = await Promise.all([
          fetchJettyLayout(),
          fetchJetties(selectedPortId),
        ])
        if (cancelled) return
        setJetties(Array.isArray(jetList) ? jetList : [])
        const cols = Array.isArray(layout?.columns) ? layout.columns : []
        if (cols.length > 0) {
          setColumns(cols.map((c) => ({ ...c, top: { ...c.top }, middle: { ...c.middle }, bottom: { ...c.bottom } })))
          setColumnCount(cols.length)
        } else {
          setColumns([emptyColumn(), emptyColumn(), emptyColumn()])
          setColumnCount(3)
        }
      } catch (e) {
        if (!cancelled) {
          setError(e?.message || 'Failed to load jetty layout')
          setColumns([emptyColumn(), emptyColumn(), emptyColumn()])
          setColumnCount(3)
          setJetties([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [canLoad, selectedPortId])

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
    if (!canLoad) return
    setError(null)
    setLoading(true)
    ;(async () => {
      try {
        await saveJettyLayout(columns)
        setToast({ message: 'Layout saved.', variant: 'success' })
      } catch (e) {
        const msg = e?.message || 'Save failed'
        setError(msg)
        setToast({ message: msg, variant: 'error' })
      } finally {
        setLoading(false)
      }
    })()
  }, [canLoad, columns])

  const handleUseDefault = useCallback(() => {
    if (!canLoad) return
    setColumns([emptyColumn(), emptyColumn(), emptyColumn()])
    setColumnCount(3)
  }, [canLoad])

  return (
    <div className="allocation-page">
      {toast && (
        <div
          className={`si-toast si-toast--${toast.variant}`}
          role={toast.variant === 'error' ? 'alert' : 'status'}
          aria-live={toast.variant === 'error' ? 'assertive' : 'polite'}
          aria-atomic="true"
        >
          <span className="si-toast__icon" aria-hidden>
            {toast.variant === 'error' ? '!' : '✓'}
          </span>
          <p className="si-toast__message">{toast.message}</p>
          <button
            type="button"
            className="si-toast__close"
            onClick={() => setToast(null)}
            aria-label="Dismiss notification"
          >
            ×
          </button>
        </div>
      )}
      <h1 className="page-title">Master – Jetty Layout</h1>
      <p className="allocation-page__intro">
        Define how jetties are arranged in the Jetty Schematic for each port. Each column has a top slot, middle block, and bottom slot.
      </p>
      <p className="text-steel">
        <Link to="/master" className="link">← Back to Master Menu</Link>
      </p>
      {noPortAssigned && (
        <p className="allocation-page__intro" style={{ color: 'var(--color-danger, #c00)' }} role="alert">
          {noPortMessage}
        </p>
      )}
      {requiresSelection && (
        <p className="allocation-page__intro" style={{ color: 'var(--color-danger, #c00)' }} role="alert">
          Select a port first (top bar port switcher), then return here.
        </p>
      )}
      {error && (
        <p className="allocation-page__intro" style={{ color: 'var(--color-danger, #c00)' }} role="alert">
          {error}
        </p>
      )}

      <section className="card">
        <h2 className="card__title">Layout editor</h2>
        <div className="jetty-layout-editor">
          <div className="jetty-layout-editor__field">
            {selectedPort ? (
              <div className="dashboard-port-chip" role="status">
                <span className="dashboard-port-chip__dot" aria-hidden />
                <span className="dashboard-port-chip__label">Port</span>
                <span className="dashboard-port-chip__name">{selectedPort.name}</span>
                <span className="dashboard-port-chip__meta">
                  · {jetties.length} jetty{jetties.length === 1 ? '' : 'ies'}
                </span>
              </div>
            ) : (
              <>
                <label className="modal__label">Active port</label>
                <input className="modal__input" value={activePortId || '—'} readOnly />
              </>
            )}
          </div>
          {canLoad && (
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
                  disabled={loading}
                />
              </div>
              <div className="jetty-layout-editor__actions">
                <button type="button" className="btn btn--secondary" onClick={handleUseDefault}>
                  Use default layout
                </button>
                <button type="button" className="btn btn--primary" onClick={handleSave} disabled={columns.length === 0 || loading}>
                  {loading ? 'Saving…' : 'Save layout'}
                </button>
              </div>
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
                          disabled={loading}
                        >
                          <option value="unused">Unused</option>
                          {jetties.map((j) => (
                            <option key={j.id} value={j.id}>{String(j.name).replace(/^Jetty\s+/i, '').trim()}</option>
                          ))}
                        </select>
                      </div>
                      <div className="jetty-layout-editor__cell">
                        <label className="jetty-layout-editor__cell-label">Middle</label>
                        <select
                          className="modal__input"
                          value={col.middle.type}
                          onChange={(e) => updateColumn(colIndex, 'middle', { type: e.target.value })}
                          disabled={loading}
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
                          disabled={loading}
                        >
                          <option value="unused">Unused</option>
                          {jetties.map((j) => (
                            <option key={j.id} value={j.id}>{String(j.name).replace(/^Jetty\s+/i, '').trim()}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
          {!canLoad && !requiresSelection && !noPortAssigned && <p className="text-steel">Select a port to edit its jetty layout.</p>}
        </div>
      </section>
    </div>
  )
}
