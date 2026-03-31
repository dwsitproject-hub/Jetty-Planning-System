import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchOperation, saveEstimatedCompletion } from '../api/operations'
import { fetchSlaConfig } from '../api/slaConfig'
import { fetchSiLookupList } from '../api/siLookupCrud'
import { fetchShippingInstruction, fetchShippingInstructionCandidates } from '../api/shippingInstructions'
import { useRbac } from '../context/RbacContext'
import '../styles/allocation.css'

const METRIC_OPTIONS = ['KLPH', 'MTPH', 'MTPD']

function toNum(v) {
  if (v === undefined || v === null || v === '') return null
  const n = Number(v)
  return Number.isNaN(n) ? null : n
}

function formatLocalInput(dt) {
  if (!dt) return ''
  const d = new Date(dt)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (x) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function rateToPerHour(rateValue, metric) {
  if (rateValue == null) return null
  const rv = Number(rateValue)
  if (!Number.isFinite(rv) || rv <= 0) return null
  if (metric === 'MTPH') return rv
  if (metric === 'MTPD') return rv / 24
  // KLPH needs density (not in v1 calculator)
  return null
}

export default function DemurrageRiskCalculator() {
  const pageKey = 'demurrage-risk-calculator'
  const { canEdit, canView } = useRbac()
  const canDoView = canView(pageKey)
  const canDoEdit = canEdit(pageKey)

  const [toast, setToast] = useState(null) // { message, variant }
  const [err, setErr] = useState(null)

  const [fromDate, setFromDate] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 30)
    return d.toISOString().slice(0, 10)
  })
  const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [includeOpen, setIncludeOpen] = useState(true)
  const [includeWithOperation, setIncludeWithOperation] = useState(true)

  const [candidatesLoading, setCandidatesLoading] = useState(false)
  const [candidates, setCandidates] = useState([])
  const [selectedSiId, setSelectedSiId] = useState(null)
  const [shippingInstruction, setShippingInstruction] = useState(null)
  const [selectedBreakdownRowId, setSelectedBreakdownRowId] = useState(null)

  const [selectedOpId, setSelectedOpId] = useState(null)
  const [operation, setOperation] = useState(null)
  const [loadingOp, setLoadingOp] = useState(false)

  const [commodities, setCommodities] = useState([])
  const [loadingCommodities, setLoadingCommodities] = useState(false)
  const [selectedCommodityId, setSelectedCommodityId] = useState(null)

  const [direction, setDirection] = useState('UNLOADING') // LOADING | UNLOADING
  const [volumeMt, setVolumeMt] = useState('')
  const [startAt, setStartAt] = useState(formatLocalInput(new Date()))

  const [bufferDefault, setBufferDefault] = useState(0.85)
  const [buffer, setBuffer] = useState('0.85')

  const [overrideRate, setOverrideRate] = useState(false)
  const [overrideRateValue, setOverrideRateValue] = useState('')
  const [overrideRateMetric, setOverrideRateMetric] = useState('MTPH')

  const [result, setResult] = useState(null) // { effectivePerHour, durationHours, estimatedCompletionIso }
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!toast?.message) return undefined
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  useEffect(() => {
    let mounted = true
    fetchSlaConfig()
      .then((cfg) => {
        if (!mounted) return
        const b = Number(cfg?.bufferDefault)
        if (Number.isFinite(b) && b > 0) {
          setBufferDefault(b)
          setBuffer(String(b))
        }
      })
      .catch(() => {})
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    setLoadingCommodities(true)
    fetchSiLookupList('commodities')
      .then((list) => setCommodities(Array.isArray(list) ? list : []))
      .catch(() => setCommodities([]))
      .finally(() => setLoadingCommodities(false))
  }, [])

  const loadCandidates = useCallback(async () => {
    setCandidatesLoading(true)
    setErr(null)
    try {
      const list = await fetchShippingInstructionCandidates({
        from: fromDate ? `${fromDate}T00:00:00Z` : undefined,
        to: toDate ? `${toDate}T23:59:59Z` : undefined,
        includeOpen,
        includeWithOperation,
      })
      setCandidates(Array.isArray(list) ? list : [])
    } catch (e) {
      setCandidates([])
      setErr(e?.message || 'Failed to load shipping instructions')
    } finally {
      setCandidatesLoading(false)
    }
  }, [fromDate, toDate, includeOpen, includeWithOperation])

  useEffect(() => {
    loadCandidates()
  }, [loadCandidates])

  const matchedCommodityId = useMemo(() => {
    const name = (shippingInstruction?.commodityDisplay || shippingInstruction?.commodity || operation?.commodity || '').trim()
    if (!name) return null
    const found = commodities.find((c) => String(c.value || c.name || '').trim().toLowerCase() === name.toLowerCase())
    return found ? Number(found.id) : null
  }, [shippingInstruction?.commodityDisplay, shippingInstruction?.commodity, operation?.commodity, commodities])

  useEffect(() => {
    if (matchedCommodityId != null && selectedCommodityId == null) {
      setSelectedCommodityId(matchedCommodityId)
    }
  }, [matchedCommodityId, selectedCommodityId])

  const selectedCommodity = useMemo(() => {
    return commodities.find((c) => Number(c.id) === Number(selectedCommodityId)) || null
  }, [commodities, selectedCommodityId])

  const breakdownRows = useMemo(() => {
    return Array.isArray(shippingInstruction?.breakdown) ? shippingInstruction.breakdown : []
  }, [shippingInstruction?.breakdown])

  const selectedBreakdownRow = useMemo(() => {
    if (!breakdownRows.length) return null
    if (selectedBreakdownRowId == null) return breakdownRows[0]
    return breakdownRows.find((r) => Number(r.id) === Number(selectedBreakdownRowId)) || breakdownRows[0]
  }, [breakdownRows, selectedBreakdownRowId])

  const resolvedRate = useMemo(() => {
    if (!selectedCommodity) return null
    const pr = selectedCommodity?.portRates || {}
    return direction === 'LOADING' ? pr.loading : pr.unloading
  }, [selectedCommodity, direction])

  const effectiveRatePerHour = useMemo(() => {
    const b = toNum(buffer)
    if (b == null || b <= 0) return null
    let rateValue = null
    let rateMetric = null
    if (overrideRate) {
      rateValue = toNum(overrideRateValue)
      rateMetric = overrideRateMetric
    } else if (resolvedRate) {
      rateValue = toNum(resolvedRate.rate)
      rateMetric = resolvedRate.rateMetric
    }
    const perHr = rateToPerHour(rateValue, rateMetric)
    if (perHr == null) return null
    const eff = perHr * b
    return Number.isFinite(eff) && eff > 0 ? eff : null
  }, [buffer, overrideRate, overrideRateMetric, overrideRateValue, resolvedRate])

  const selectCandidate = useCallback(async (row) => {
    setErr(null)
    setResult(null)
    setSelectedSiId(Number(row.siId))
    setShippingInstruction(null)
    setSelectedBreakdownRowId(null)
    setOperation(null)
    // Reset so commodity follows the newly selected SI.
    setSelectedCommodityId(null)
    setSelectedOpId(row?.operation?.id ? Number(row.operation.id) : null)
    setDirection(row?.purpose === 'Loading' ? 'LOADING' : row?.purpose === 'Unloading' ? 'UNLOADING' : 'UNLOADING')
    try {
      const si = await fetchShippingInstruction(row.siId)
      setShippingInstruction(si)

      const bd = Array.isArray(si?.breakdown) ? si.breakdown : []
      const first = bd[0] || null
      if (first?.commodityId != null) {
        setSelectedCommodityId(Number(first.commodityId))
      }
      if (first?.id != null) {
        setSelectedBreakdownRowId(Number(first.id))
      }
      if (first && String(first.metricCode || '').toUpperCase().includes('MT')) {
        setVolumeMt(first.qty != null ? String(first.qty) : '')
      }

      if (row?.operation?.id) {
        setLoadingOp(true)
        const op = await fetchOperation(row.operation.id)
        setOperation(op)
        setStartAt(formatLocalInput(op?.dockingStartTime || new Date()))
        setLoadingOp(false)
      } else {
        // Use SI eta_from as a reasonable default start when no operation exists.
        setStartAt(formatLocalInput(si?.etaFrom || new Date()))
      }
    } catch (e) {
      setErr(e?.message || 'Failed to load selected SI/operation')
    } finally {
      setLoadingOp(false)
    }
  }, [])

  const estimate = useCallback(() => {
    setErr(null)
    const v = toNum(volumeMt)
    if (v == null || v <= 0) {
      setErr('Volume (MT) must be a positive number.')
      return
    }
    if (!effectiveRatePerHour) {
      setErr('Missing or invalid rate/buffer. Set a master rate or use Override rate.')
      return
    }
    const start = new Date(startAt)
    if (Number.isNaN(start.getTime())) {
      setErr('Start time is invalid.')
      return
    }
    const hours = v / effectiveRatePerHour
    const estimated = new Date(start.getTime() + hours * 60 * 60 * 1000)
    setResult({
      effectivePerHour: effectiveRatePerHour,
      durationHours: hours,
      estimatedCompletionIso: estimated.toISOString(),
    })
    setToast({ message: 'Estimate updated', variant: 'success' })
  }, [effectiveRatePerHour, startAt, volumeMt])

  const doSave = useCallback(async () => {
    if (!selectedOpId) {
      setErr('This SI has no operation yet. Create/allocate an operation first to save estimation.')
      return
    }
    if (!result?.estimatedCompletionIso) {
      setErr('Click Estimate first.')
      return
    }
    setSaving(true)
    setErr(null)
    try {
      await saveEstimatedCompletion(selectedOpId, result.estimatedCompletionIso, {
        tool: 'demurrage-risk-calculator',
        commodityId: selectedCommodityId,
        breakdownRowId: selectedBreakdownRowId,
        direction,
        volumeMt: toNum(volumeMt),
        buffer: toNum(buffer),
        overrideRate,
        overrideRateValue: overrideRate ? toNum(overrideRateValue) : null,
        overrideRateMetric: overrideRate ? overrideRateMetric : null,
      })
      setToast({ message: 'Saved as estimation of completion', variant: 'success' })
    } catch (e) {
      setErr(e?.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }, [buffer, direction, overrideRate, overrideRateMetric, overrideRateValue, result, selectedBreakdownRowId, selectedCommodityId, selectedOpId, volumeMt])

  if (!canDoView) {
    return (
      <div className="allocation-page">
        <h1 className="page-title">Demurrage Risk Calculator</h1>
        <p className="allocation-page__intro" style={{ color: 'var(--color-danger, #c00)' }}>
          You do not have permission to view this page.
        </p>
      </div>
    )
  }

  const showMetricHint = !overrideRate && resolvedRate?.rateMetric === 'KLPH'

  return (
    <div className="allocation-page">
      <h1 className="page-title">Demurrage Risk Calculator</h1>
      <p className="text-steel" style={{ fontSize: 'var(--font-size-small)' }}>
        <Link to="/" className="link">← Back</Link>
      </p>

      {err && (
        <p className="allocation-page__intro" style={{ color: 'var(--color-danger, #c00)' }} role="alert">
          {err}
        </p>
      )}
      {toast?.message && (
        <div
          className={`toast ${toast.variant === 'error' ? 'toast--warning' : 'toast--success'}`}
          role={toast.variant === 'error' ? 'alert' : 'status'}
          aria-live={toast.variant === 'error' ? 'assertive' : 'polite'}
          aria-atomic="true"
        >
          <span className="toast__icon" aria-hidden>{toast.variant === 'error' ? '!' : '✓'}</span>
          <p className="toast__message">{toast.message}</p>
          <button type="button" className="toast__close" onClick={() => setToast(null)} aria-label="Dismiss notification">
            ×
          </button>
        </div>
      )}

      <div className="reporting-list__grid" style={{ gridTemplateColumns: '1fr 1fr', alignItems: 'start' }}>
        <section className="card at-berth-list-section">
          <div className="card__header-row">
            <h2 className="card__title">Inputs</h2>
          </div>

          <div className="modal__section">
            <label className="modal__label">Shipping instruction filter</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label className="text-steel" style={{ fontSize: 'var(--font-size-small)' }} htmlFor="drc-from">From</label>
                <input id="drc-from" type="date" className="modal__input" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
              </div>
              <div>
                <label className="text-steel" style={{ fontSize: 'var(--font-size-small)' }} htmlFor="drc-to">To</label>
                <input id="drc-to" type="date" className="modal__input" value={toDate} onChange={(e) => setToDate(e.target.value)} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 14, marginTop: 10, flexWrap: 'wrap' }}>
              <label className="text-steel" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={includeOpen} onChange={(e) => setIncludeOpen(e.target.checked)} />
                Open SI
              </label>
              <label className="text-steel" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={includeWithOperation} onChange={(e) => setIncludeWithOperation(e.target.checked)} />
                Has Operation
              </label>
              <button type="button" className="btn btn--secondary btn--small" onClick={loadCandidates} disabled={candidatesLoading}>
                {candidatesLoading ? 'Loading…' : 'Apply'}
              </button>
            </div>

            <div className="card" style={{ marginTop: 10, padding: 10, maxHeight: 260, overflow: 'auto' }}>
              {candidatesLoading ? (
                <p className="text-steel">Loading…</p>
              ) : candidates.length === 0 ? (
                <p className="text-steel">No shipping instructions in this date range.</p>
              ) : (
                candidates.map((r) => (
                  <button
                    key={`${r.siId}-${r.operation?.id || 'no-op'}`}
                    type="button"
                    className="btn btn--secondary btn--small"
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      marginBottom: 6,
                      borderColor: Number(selectedSiId) === Number(r.siId) ? 'var(--color-primary, #b00)' : undefined,
                    }}
                    onClick={() => selectCandidate(r)}
                  >
                    <strong>{r.vesselName || '—'}</strong>
                    {r.referenceNumber ? ` · ${r.referenceNumber}` : ''}
                    {r.operation?.id ? ` · OP #${r.operation.id}` : ' · (Open SI)'}
                    {r.commodity ? ` · ${r.commodity}` : ''}
                  </button>
                ))
              )}
            </div>
            {loadingOp && <p className="text-steel">Loading operation…</p>}
          </div>

          <div className="modal__section">
            <label className="modal__label" htmlFor="drc-commodity">Commodity</label>
            <select
              id="drc-commodity"
              className="modal__input"
              value={selectedCommodityId ?? ''}
              onChange={(e) => setSelectedCommodityId(e.target.value ? Number(e.target.value) : null)}
              disabled={loadingCommodities}
            >
              <option value="">{loadingCommodities ? 'Loading…' : 'Select commodity'}</option>
              {commodities.map((c) => (
                <option key={c.id} value={c.id}>{c.value || c.name}</option>
              ))}
            </select>
            {breakdownRows.length > 0 && (
              <>
                {breakdownRows.length > 1 && (
                  <div style={{ marginTop: 10 }}>
                    <label className="modal__label" htmlFor="drc-breakdown">
                      Commodity line
                    </label>
                    <select
                      id="drc-breakdown"
                      className="modal__input"
                      value={selectedBreakdownRowId ?? ''}
                      onChange={(e) => {
                        const nextId = e.target.value ? Number(e.target.value) : null
                        setSelectedBreakdownRowId(nextId)
                        const row = breakdownRows.find((r) => Number(r.id) === Number(nextId)) || null
                        if (row?.commodityId != null) setSelectedCommodityId(Number(row.commodityId))
                        const isMt = String(row?.metricCode || '').toUpperCase().includes('MT')
                        if (isMt) setVolumeMt(row?.qty != null ? String(row.qty) : '')
                      }}
                    >
                      {breakdownRows.map((r, idx) => (
                        <option key={r.id} value={r.id}>
                          {`${idx + 1} · ${r.commodityName || '—'} · ${r.qty ?? 0} ${r.metricCode || ''}`.trim()}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {selectedBreakdownRow && !String(selectedBreakdownRow.metricCode || '').toUpperCase().includes('MT') && (
                  <p className="text-steel" style={{ marginTop: 6, fontSize: 'var(--font-size-small)' }}>
                    Selected line uses <strong>{selectedBreakdownRow.metricCode}</strong>. Volume auto-fill is only for MT. Enter Volume (MT) manually or adjust the SI metric.
                  </p>
                )}
              </>
            )}
          </div>

          <div className="modal__section">
            <label className="modal__label">Direction</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className={`btn btn--small ${direction === 'LOADING' ? 'btn--primary' : 'btn--secondary'}`}
                onClick={() => setDirection('LOADING')}
              >
                Loading
              </button>
              <button
                type="button"
                className={`btn btn--small ${direction === 'UNLOADING' ? 'btn--primary' : 'btn--secondary'}`}
                onClick={() => setDirection('UNLOADING')}
              >
                Unloading
              </button>
            </div>
          </div>

          <div className="modal__section">
            <label className="modal__label" htmlFor="drc-volume">Volume (MT)</label>
            <input
              id="drc-volume"
              type="number"
              min={0}
              step="any"
              className="modal__input"
              value={volumeMt}
              onChange={(e) => setVolumeMt(e.target.value)}
              placeholder="e.g. 12000"
            />
          </div>

          <div className="modal__section">
            <label className="modal__label" htmlFor="drc-start">Start time</label>
            <input
              id="drc-start"
              type="datetime-local"
              className="modal__input"
              value={startAt}
              onChange={(e) => setStartAt(e.target.value)}
            />
          </div>

          <div className="modal__section">
            <label className="modal__label" htmlFor="drc-buffer">
              Buffer <span className="text-steel">{`(default ${bufferDefault})`}</span>
            </label>
            <input
              id="drc-buffer"
              type="number"
              min={0}
              step="any"
              className="modal__input"
              value={buffer}
              onChange={(e) => setBuffer(e.target.value)}
            />
          </div>

          <div className="modal__section">
            <label className="modal__label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={overrideRate} onChange={(e) => setOverrideRate(e.target.checked)} />
              Override rate
            </label>
            {!overrideRate && (
              <p className="text-steel" style={{ marginTop: 6 }}>
                Rate: <strong>{resolvedRate ? `${resolvedRate.rate} ${resolvedRate.rateMetric}` : '— (not set)'}</strong>
              </p>
            )}
            {showMetricHint && (
              <p className="text-steel" style={{ marginTop: 6 }}>
                KLPH needs density to convert to MT/h. Use Override rate with MTPH/MTPD for now.
              </p>
            )}
            {overrideRate && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: 10, marginTop: 10 }}>
                <input
                  type="number"
                  min={0}
                  step="any"
                  className="modal__input"
                  value={overrideRateValue}
                  onChange={(e) => setOverrideRateValue(e.target.value)}
                  placeholder="Rate value"
                />
                <select
                  className="modal__input"
                  value={overrideRateMetric}
                  onChange={(e) => setOverrideRateMetric(e.target.value)}
                >
                  {METRIC_OPTIONS.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </section>

        <section className="card at-berth-list-section">
          <div className="card__header-row">
            <h2 className="card__title">Result</h2>
          </div>

          <div className="modal__section">
            <p className="text-steel">
              ETB: <strong>{operation?.etb ? new Date(operation.etb).toLocaleString() : '—'}</strong>
            </p>
            <p className="text-steel">
              TB: <strong>{operation?.tbAt ? new Date(operation.tbAt).toLocaleString() : operation?.dockingStartTime ? new Date(operation.dockingStartTime).toLocaleString() : '—'}</strong>
            </p>
            <p className="text-steel">
              Effective throughput: <strong>{result ? `${result.effectivePerHour.toFixed(2)} MT/h` : '—'}</strong>
            </p>
            <p className="text-steel">
              Estimated duration: <strong>{result ? `${result.durationHours.toFixed(2)} hours` : '—'}</strong>
            </p>
            <p className="text-steel">
              Estimated completion: <strong>{result ? new Date(result.estimatedCompletionIso).toLocaleString() : '—'}</strong>
            </p>
          </div>

          <div className="modal__footer" style={{ justifyContent: 'flex-start', gap: 10 }}>
            <button type="button" className="btn btn--primary" onClick={estimate}>
              Estimate
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              onClick={doSave}
              disabled={!canDoEdit || saving || !selectedOpId}
              title={!canDoEdit ? 'Edit permission required.' : ''}
            >
              {saving ? 'Saving…' : 'Save As Estimation of Completion'}
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}

