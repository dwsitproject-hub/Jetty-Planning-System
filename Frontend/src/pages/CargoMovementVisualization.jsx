import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { DateTime } from 'luxon'
import { fetchTankCargoMovementBoard } from '../api/cargoMovement'
import { fetchTankGaugingSamples } from '../api/tankGauging'
import { fetchPorts } from '../api/ports'
import CargoMovementBoard from '../components/cargoMovement/CargoMovementBoard.jsx'
import { usePortScope } from '../context/PortScopeContext.jsx'
import { useRbac } from '../context/RbacContext.jsx'
import '../styles/allocation.css'
import '../styles/cargo-movement.css'

const PAGE_KEY = 'cargo-movement'

function defaultRangeDays(days) {
  const to = DateTime.now()
  const from = to.minus({ days })
  return {
    from: from.toUTC().toISO(),
    to: to.toUTC().toISO(),
    fromLocal: from.toFormat("yyyy-MM-dd'T'HH:mm"),
    toLocal: to.toFormat("yyyy-MM-dd'T'HH:mm"),
  }
}

export default function CargoMovementVisualization() {
  const { t } = useTranslation('pages')
  const { canView } = useRbac()
  const { selectedPortId, selectedPort } = usePortScope()

  const initial = useMemo(() => defaultRangeDays(7), [])
  const [fromInput, setFromInput] = useState(initial.fromLocal)
  const [toInput, setToInput] = useState(initial.toLocal)
  const [board, setBoard] = useState(null)
  const [samplesByTank, setSamplesByTank] = useState({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [filters, setFilters] = useState({ atgOnly: false, hasMovement: false, showIdle: false })
  const [ports, setPorts] = useState([])
  const [portId, setPortId] = useState(selectedPortId ? String(selectedPortId) : '')

  useEffect(() => {
    fetchPorts()
      .then((list) => setPorts(Array.isArray(list) ? list : []))
      .catch(() => setPorts([]))
  }, [])

  useEffect(() => {
    if (selectedPortId) setPortId(String(selectedPortId))
  }, [selectedPortId])

  const portName = useMemo(() => {
    const fromScope = selectedPort?.name
    if (fromScope && String(selectedPortId) === String(portId)) return fromScope
    const p = ports.find((x) => String(x.id) === String(portId))
    return p?.name || (portId ? `Port #${portId}` : '')
  }, [ports, portId, selectedPort, selectedPortId])

  const parseRange = useCallback(() => {
    const fromDt = DateTime.fromISO(fromInput, { zone: 'local' })
    const toDt = DateTime.fromISO(toInput, { zone: 'local' })
    if (!fromDt.isValid || !toDt.isValid) return null
    if (fromDt.toMillis() >= toDt.toMillis()) return null
    return { from: fromDt.toUTC().toISO(), to: toDt.toUTC().toISO() }
  }, [fromInput, toInput])

  const loadBoard = useCallback(async () => {
    if (!portId || !canView(PAGE_KEY)) return
    const range = parseRange()
    if (!range) {
      setError(t('cargoMovementInvalidRange'))
      return
    }
    setLoading(true)
    setError(null)
    try {
      const payload = await fetchTankCargoMovementBoard({
        portId,
        from: range.from,
        to: range.to,
      })
      setBoard(payload)

      const tankIds = (payload?.tanks ?? [])
        .filter((tk) => tk.hasAtg && (tk.segments?.length ?? 0) > 0)
        .map((tk) => tk.tankId)

      if (tankIds.length) {
        const samplePayload = await fetchTankGaugingSamples({
          portId,
          tankIds,
          from: range.from,
          to: range.to,
        })
        setSamplesByTank(samplePayload?.samples ?? {})
      } else {
        setSamplesByTank({})
      }
    } catch (e) {
      setBoard(null)
      setSamplesByTank({})
      setError(e?.message || t('cargoMovementLoadError'))
    } finally {
      setLoading(false)
    }
  }, [portId, canView, parseRange, t])

  useEffect(() => {
    loadBoard()
  }, [loadBoard])

  const applyQuickRange = (days) => {
    const r = defaultRangeDays(days)
    setFromInput(r.fromLocal)
    setToInput(r.toLocal)
  }

  if (!canView(PAGE_KEY)) {
    return (
      <div className="allocation-page">
        <h1 className="page-title">{t('cargoMovementTitle')}</h1>
        <p className="text-steel">{t('cargoMovementNoAccess')}</p>
      </div>
    )
  }

  return (
    <div className="allocation-page cargo-movement-page" data-page-key={PAGE_KEY}>
      <h1 className="page-title">{t('cargoMovementTitle')}</h1>
      <p className="allocation-page__intro">{t('cargoMovementDesc')}</p>
      <p className="text-steel">
        <Link to="/tank-farm" className="link">{t('cargoMovementBackTankFarm')}</Link>
        {' · '}
        <Link to="/at-berth" className="link">{t('cargoMovementBackAtBerth')}</Link>
      </p>

      <div className="cargo-movement-toolbar card" style={{ padding: '0.75rem 1rem' }}>
        <strong>{portName || t('cargoMovementPort')}</strong>
        {ports.length > 1 ? (
          <label>
            {t('cargoMovementPort')}
            <select
              className="berthing-modal__input"
              value={portId}
              onChange={(e) => setPortId(e.target.value)}
            >
              {ports.map((p) => (
                <option key={p.id} value={String(p.id)}>{p.name || `#${p.id}`}</option>
              ))}
            </select>
          </label>
        ) : null}
        <label>
          {t('cargoMovementFrom')}
          <input
            type="datetime-local"
            className="berthing-modal__input"
            value={fromInput}
            onChange={(e) => setFromInput(e.target.value)}
          />
        </label>
        <label>
          {t('cargoMovementTo')}
          <input
            type="datetime-local"
            className="berthing-modal__input"
            value={toInput}
            onChange={(e) => setToInput(e.target.value)}
          />
        </label>
        <button type="button" className="btn btn--secondary btn--small" onClick={() => applyQuickRange(7)}>
          7d
        </button>
        <button type="button" className="btn btn--secondary btn--small" onClick={() => applyQuickRange(14)}>
          14d
        </button>
        <button type="button" className="btn btn--secondary btn--small" onClick={() => applyQuickRange(30)}>
          30d
        </button>
        <button type="button" className="btn btn--primary btn--small" onClick={loadBoard} disabled={loading}>
          {t('cargoMovementRefresh')}
        </button>
      </div>

      {error ? (
        <p className="allocation-page__intro" style={{ color: 'var(--color-danger, #c00)' }} role="alert">
          {error}
        </p>
      ) : null}

      <CargoMovementBoard
        board={board}
        samplesByTank={samplesByTank}
        filters={filters}
        onFilterChange={setFilters}
        loading={loading}
        onRefresh={loadBoard}
        t={t}
      />
    </div>
  )
}
