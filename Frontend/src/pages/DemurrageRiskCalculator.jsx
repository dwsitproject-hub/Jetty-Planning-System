import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchOperation, saveEstimatedCompletion } from '../api/operations'
import { fetchSlaConfig } from '../api/slaConfig'
import { fetchSiLookupList } from '../api/siLookupCrud'
import { fetchShippingInstruction, fetchShippingInstructionCandidates } from '../api/shippingInstructions'
import { useRbac } from '../context/RbacContext'
import '../styles/allocation.css'
import '../styles/demurrage-risk-calculator.css'

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

function formatDisplayDateTime(dt) {
  if (!dt) return '—'
  const d = new Date(dt)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
}

function rateToPerHour(rateValue, metric) {
  if (rateValue == null) return null
  const rv = Number(rateValue)
  if (!Number.isFinite(rv) || rv <= 0) return null
  if (metric === 'MTPH') return rv
  if (metric === 'MTPD') return rv / 24
  return null
}

function purposeToDirection(purpose) {
  const p = String(purpose || '').toLowerCase()
  if (p === 'loading') return 'LOADING'
  if (p === 'unloading') return 'UNLOADING'
  return 'UNLOADING'
}

export default function DemurrageRiskCalculator() {
  const pageKey = 'demurrage-risk-calculator'
  const { canEdit, canView } = useRbac()
  const canDoView = canView(pageKey)
  const canDoEdit = canEdit(pageKey)

  const [toast, setToast] = useState(null)
  const [err, setErr] = useState(null)

  const [fromDate, setFromDate] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 30)
    return d.toISOString().slice(0, 10)
  })
  const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [includeIncoming, setIncludeIncoming] = useState(true)
  const [includeBerthed, setIncludeBerthed] = useState(true)

  const [candidatesLoading, setCandidatesLoading] = useState(false)
  const [candidates, setCandidates] = useState([])
  const [selectedSiId, setSelectedSiId] = useState(null)
  const [shippingInstruction, setShippingInstruction] = useState(null)

  const [selectedOpId, setSelectedOpId] = useState(null)
  const [operation, setOperation] = useState(null)
  const [loadingOp, setLoadingOp] = useState(false)

  const [commodities, setCommodities] = useState([])
  const [loadingCommodities, setLoadingCommodities] = useState(false)

  const [bufferDefault, setBufferDefault] = useState(0.85)
  const [buffer, setBuffer] = useState('0.85')

  const [overrideRate, setOverrideRate] = useState(false)
  const [overrideRateValue, setOverrideRateValue] = useState('')
  const [overrideRateMetric, setOverrideRateMetric] = useState('MTPH')

  const [advancedOpen, setAdvancedOpen] = useState(false)

  const [result, setResult] = useState(null)
  const [saving, setSaving] = useState(false)

  const bufferAtLastEstimateRef = useRef(null)

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
        includeIncoming,
        includeBerthed,
      })
      setCandidates(Array.isArray(list) ? list : [])
    } catch (e) {
      setCandidates([])
      setErr(e?.message || 'Failed to load shipping instructions')
    } finally {
      setCandidatesLoading(false)
    }
  }, [fromDate, toDate, includeIncoming, includeBerthed])

  useEffect(() => {
    loadCandidates()
  }, [loadCandidates])

  const breakdownRows = useMemo(() => {
    return Array.isArray(shippingInstruction?.breakdown) ? shippingInstruction.breakdown : []
  }, [shippingInstruction?.breakdown])

  /** First MT line if any, else first line — drives volume + commodity for calculation. */
  const contextBreakdownRow = useMemo(() => {
    if (!breakdownRows.length) return null
    const mt = breakdownRows.find((r) => String(r.metricCode || '').toUpperCase().includes('MT'))
    return mt || breakdownRows[0]
  }, [breakdownRows])

  const matchedCommodityId = useMemo(() => {
    const name = (shippingInstruction?.commodityDisplay || shippingInstruction?.commodity || operation?.commodity || '').trim()
    if (!name) return null
    const found = commodities.find((c) => String(c.value || c.name || '').trim().toLowerCase() === name.toLowerCase())
    return found ? Number(found.id) : null
  }, [shippingInstruction?.commodityDisplay, shippingInstruction?.commodity, operation?.commodity, commodities])

  const contextCommodityId = useMemo(() => {
    if (contextBreakdownRow?.commodityId != null) return Number(contextBreakdownRow.commodityId)
    return matchedCommodityId
  }, [contextBreakdownRow, matchedCommodityId])

  const selectedCommodity = useMemo(() => {
    if (contextCommodityId == null) return null
    return commodities.find((c) => Number(c.id) === Number(contextCommodityId)) || null
  }, [commodities, contextCommodityId])

  const direction = useMemo(
    () => purposeToDirection(shippingInstruction?.purpose),
    [shippingInstruction?.purpose]
  )

  const volumeMtNum = useMemo(() => {
    if (!contextBreakdownRow) return null
    if (!String(contextBreakdownRow.metricCode || '').toUpperCase().includes('MT')) return null
    return toNum(contextBreakdownRow.qty)
  }, [contextBreakdownRow])

  const startInstantIso = useMemo(() => {
    const raw = operation?.dockingStartTime || shippingInstruction?.etaFrom || shippingInstruction?.etaTo
    if (!raw) return null
    const d = new Date(raw)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }, [operation?.dockingStartTime, shippingInstruction?.etaFrom, shippingInstruction?.etaTo])

  const startForCalcDisplay = useMemo(() => formatDisplayDateTime(startInstantIso), [startInstantIso])

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

  const showMetricHint = !overrideRate && resolvedRate?.rateMetric === 'KLPH'

  const bufferStale =
    result != null && bufferAtLastEstimateRef.current != null && String(bufferAtLastEstimateRef.current) !== String(buffer)

  const selectCandidate = useCallback(async (row) => {
    setErr(null)
    setResult(null)
    bufferAtLastEstimateRef.current = null
    setOverrideRate(false)
    setOverrideRateValue('')
    setAdvancedOpen(false)
    setSelectedSiId(Number(row.siId))
    setShippingInstruction(null)
    setOperation(null)
    setSelectedOpId(row?.operation?.id ? Number(row.operation.id) : null)
    try {
      const si = await fetchShippingInstruction(row.siId)
      setShippingInstruction(si)

      if (row?.operation?.id) {
        setLoadingOp(true)
        const op = await fetchOperation(row.operation.id)
        setOperation(op)
      }
    } catch (e) {
      setErr(e?.message || 'Failed to load selected SI/operation')
    } finally {
      setLoadingOp(false)
    }
  }, [])

  const estimate = useCallback(() => {
    setErr(null)
    if (volumeMtNum == null || volumeMtNum <= 0) {
      setErr('Volume is not available in MT for the primary commodity line. Update the SI breakdown or metric in Shipping Instruction.')
      return
    }
    if (!effectiveRatePerHour) {
      setErr('Missing or invalid rate/buffer. Set a master commodity rate or use Advanced → Override rate.')
      return
    }
    if (!startInstantIso) {
      setErr('Start time for calculation is missing (operation docking / SI ETA).')
      return
    }
    const start = new Date(startInstantIso)
    const hours = volumeMtNum / effectiveRatePerHour
    const estimated = new Date(start.getTime() + hours * 60 * 60 * 1000)
    bufferAtLastEstimateRef.current = buffer
    setResult({
      effectivePerHour: effectiveRatePerHour,
      durationHours: hours,
      estimatedCompletionIso: estimated.toISOString(),
    })
    setToast({ message: 'Estimate updated', variant: 'success' })
  }, [buffer, effectiveRatePerHour, startInstantIso, volumeMtNum])

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
        commodityId: contextCommodityId,
        breakdownRowId: contextBreakdownRow?.id != null ? Number(contextBreakdownRow.id) : null,
        direction,
        volumeMt: volumeMtNum,
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
  }, [
    buffer,
    contextBreakdownRow,
    contextCommodityId,
    direction,
    overrideRate,
    overrideRateMetric,
    overrideRateValue,
    result,
    selectedOpId,
    volumeMtNum,
  ])

  const resetBufferToDefault = useCallback(() => {
    setBuffer(String(bufferDefault))
  }, [bufferDefault])

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

  const purposeLabel = shippingInstruction?.purpose ? String(shippingInstruction.purpose) : '—'
  const commodityLineLabel = contextBreakdownRow
    ? `${contextBreakdownRow.commodityName || '—'} · ${contextBreakdownRow.qty ?? '—'} ${contextBreakdownRow.metricCode || ''}`.trim()
    : '—'
  const lineIndex =
    contextBreakdownRow && breakdownRows.length
      ? breakdownRows.findIndex((r) => Number(r.id) === Number(contextBreakdownRow.id)) + 1
      : 0
  const masterRateLabel = resolvedRate ? `${resolvedRate.rate} ${resolvedRate.rateMetric}` : '— (not set)'

  return (
    <div className="allocation-page">
      <h1 className="page-title">Demurrage Risk Calculator</h1>
      <p className="text-steel" style={{ fontSize: 'var(--font-size-small)' }}>
        <Link to="/" className="link">
          ← Back
        </Link>
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
          <span className="toast__icon" aria-hidden>
            {toast.variant === 'error' ? '!' : '✓'}
          </span>
          <p className="toast__message">{toast.message}</p>
          <button type="button" className="toast__close" onClick={() => setToast(null)} aria-label="Dismiss notification">
            ×
          </button>
        </div>
      )}

      <div className="reporting-list__grid drc-grid" style={{ gridTemplateColumns: '1fr 1fr', alignItems: 'start' }}>
        <section className="card at-berth-list-section drc-filter-card">
          <div className="card__header-row">
            <h2 className="card__title">Choose voyage</h2>
          </div>

          <div className="modal__section">
            <label className="modal__label">Shipping instruction filter</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label className="text-steel" style={{ fontSize: 'var(--font-size-small)' }} htmlFor="drc-from">
                  From
                </label>
                <input id="drc-from" type="date" className="modal__input" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
              </div>
              <div>
                <label className="text-steel" style={{ fontSize: 'var(--font-size-small)' }} htmlFor="drc-to">
                  To
                </label>
                <input id="drc-to" type="date" className="modal__input" value={toDate} onChange={(e) => setToDate(e.target.value)} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 14, marginTop: 10, flexWrap: 'wrap' }}>
              <label className="text-steel" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={includeIncoming} onChange={(e) => setIncludeIncoming(e.target.checked)} />
                Incoming
              </label>
              <label className="text-steel" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={includeBerthed} onChange={(e) => setIncludeBerthed(e.target.checked)} />
                Berthed
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
                candidates.map((r) => {
                  const planLabel = r.berthingPlanStatus === 'berthed' ? 'Berthed' : 'Incoming'
                  const jettySeg = r.jettyName ? ` · ${r.jettyName}` : ''
                  return (
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
                      {` · ${planLabel}`}
                      {jettySeg}
                      {r.commodity ? ` · ${r.commodity}` : ''}
                    </button>
                  )
                })
              )}
            </div>
            {loadingOp && <p className="text-steel">Loading operation…</p>}
          </div>

          <div className="drc-voyage-context">
            <h3 className="drc-voyage-context__title">Voyage context</h3>
            {!selectedSiId ? (
              <p className="text-steel" style={{ margin: 0, fontSize: 'var(--font-size-small)' }}>
                Select a shipping instruction from the list above.
              </p>
            ) : !shippingInstruction ? (
              <p className="text-steel" style={{ margin: 0, fontSize: 'var(--font-size-small)' }}>
                Loading…
              </p>
            ) : (
              <>
                <dl className="drc-voyage-context__dl">
                  <dt>Purpose</dt>
                  <dd>{purposeLabel}</dd>
                  <dt>Commodity line</dt>
                  <dd>
                    {lineIndex > 0 && breakdownRows.length > 1
                      ? `Line ${lineIndex} of ${breakdownRows.length} (${commodityLineLabel})`
                      : commodityLineLabel}
                  </dd>
                  <dt>Volume (MT)</dt>
                  <dd>{volumeMtNum != null && volumeMtNum > 0 ? String(volumeMtNum) : '—'}</dd>
                  <dt>Start for calculation</dt>
                  <dd>
                    {startForCalcDisplay}
                    <span className="text-steel" style={{ display: 'block', fontSize: '11px', marginTop: 4 }}>
                      {operation?.dockingStartTime ? 'From operation docking start' : 'From SI ETA (no operation docking yet)'}
                    </span>
                  </dd>
                  <dt>Master rate</dt>
                  <dd>
                    <strong>{masterRateLabel}</strong>
                    {direction === 'LOADING' ? ' (loading)' : ' (unloading)'}
                  </dd>
                </dl>
                {contextBreakdownRow && !String(contextBreakdownRow.metricCode || '').toUpperCase().includes('MT') && (
                  <p className="drc-voyage-context__hint">
                    Primary line uses <strong>{contextBreakdownRow.metricCode}</strong>, not MT. Estimation needs MT — adjust the SI
                    or add an MT line in Shipping Instruction.
                  </p>
                )}
                {loadingCommodities && (
                  <p className="drc-voyage-context__hint">Loading commodity rates…</p>
                )}
                <div className="drc-voyage-context__edit">
                  <Link to="/shipping-instruction" className="link">
                    Open Shipping Instruction
                  </Link>{' '}
                  to edit commodity, lines, or ETA.
                </div>
              </>
            )}
          </div>

          <div className="drc-scenario">
            <h3 className="drc-scenario__title">Scenario</h3>
            <label className="modal__label" htmlFor="drc-buffer">
              Throughput buffer <span className="text-steel">{`(default ${bufferDefault})`}</span>
            </label>
            <div className="drc-scenario__buffer-row">
              <input
                id="drc-buffer"
                type="number"
                min={0}
                step="any"
                className="modal__input"
                value={buffer}
                onChange={(e) => setBuffer(e.target.value)}
                aria-describedby="drc-buffer-help"
              />
              <button type="button" className="btn btn--secondary btn--small" onClick={resetBufferToDefault}>
                Reset to default
              </button>
            </div>
            <p id="drc-buffer-help" className="drc-scenario__helper">
              Multiplies the standard rate from master data. Lower buffer → lower effective MT/h → longer estimated duration.
            </p>
            {bufferStale && <p className="drc-stale-hint">Buffer changed — click Estimate to refresh results.</p>}

            <div className="drc-advanced">
              <button
                type="button"
                className="btn btn--secondary btn--small"
                aria-expanded={advancedOpen}
                onClick={() => setAdvancedOpen((o) => !o)}
              >
                {advancedOpen ? '▼ Hide advanced' : '▶ Advanced'}
              </button>
              {advancedOpen && (
                <div className="drc-advanced__body">
                  <label className="modal__label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input type="checkbox" checked={overrideRate} onChange={(e) => setOverrideRate(e.target.checked)} />
                    Override rate
                  </label>
                  {showMetricHint && (
                    <p className="text-steel" style={{ marginTop: 6, fontSize: 'var(--font-size-small)' }}>
                      KLPH needs density to convert to MT/h. Use override with MTPH or MTPD.
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
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}
            </div>
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
              TB:{' '}
              <strong>
                {operation?.tbAt
                  ? new Date(operation.tbAt).toLocaleString()
                  : operation?.dockingStartTime
                    ? new Date(operation.dockingStartTime).toLocaleString()
                    : '—'}
              </strong>
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
