import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { DateTime } from 'luxon'
import { fetchPorts } from '../api/ports'
import CargoMovementBoardV2 from '../components/cargoMovement-v2/CargoMovementBoardV2.jsx'
import { useCargoMovementBoard } from '../components/cargoMovement-v2/hooks/useCargoMovementBoard.js'
import { usePortScope } from '../context/PortScopeContext.jsx'
import { useRbac } from '../context/RbacContext.jsx'
import '../styles/cargo-movement-tailwind.css'

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
  const [ports, setPorts] = useState([])
  const [portId, setPortId] = useState(selectedPortId ? String(selectedPortId) : '')
  const [range, setRange] = useState({ from: initial.from, to: initial.to })

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

  useEffect(() => {
    const r = parseRange()
    if (r) setRange(r)
  }, [fromInput, toInput, parseRange])

  const allowed = canView(PAGE_KEY)
  const { board, samplesByTank, loading, error, reload } = useCargoMovementBoard({
    portId,
    from: range.from,
    to: range.to,
    enabled: allowed && Boolean(portId),
  })

  const applyQuickRange = (days) => {
    const r = defaultRangeDays(days)
    setFromInput(r.fromLocal)
    setToInput(r.toLocal)
    setRange({ from: r.from, to: r.to })
  }

  const handleRefresh = () => {
    const r = parseRange()
    if (!r) return
    setRange(r)
    reload()
  }

  if (!allowed) {
    return (
      <div className="cm-root min-h-full bg-slate-50 p-4 text-slate-900">
        <h1 className="text-xl font-semibold">{t('cargoMovementTitle')}</h1>
        <p className="mt-2 text-sm text-slate-600">{t('cargoMovementNoAccess')}</p>
      </div>
    )
  }

  return (
    <div className="cm-root min-h-full bg-slate-50 p-4 text-slate-900">
      <header className="mb-4">
        <h1 className="text-xl font-semibold tracking-tight">{t('cargoMovementTitle')}</h1>
        <p className="mt-1 text-sm text-slate-600">{t('cargoMovementDesc')}</p>
        <p className="mt-2 text-sm">
          <Link to="/tank-farm" className="text-slate-700 underline hover:text-slate-900">
            {t('cargoMovementBackTankFarm')}
          </Link>
          {' · '}
          <Link to="/at-berth" className="text-slate-700 underline hover:text-slate-900">
            {t('cargoMovementBackAtBerth')}
          </Link>
        </p>
      </header>

      {error ? (
        <p className="mb-3 text-sm text-red-700" role="alert">{error}</p>
      ) : null}
      {!parseRange() && fromInput && toInput ? (
        <p className="mb-3 text-sm text-red-700">{t('cargoMovementInvalidRange')}</p>
      ) : null}

      <CargoMovementBoardV2
        board={board}
        samplesByTank={samplesByTank}
        loading={loading}
        onRefresh={handleRefresh}
        portName={portName}
        ports={ports}
        portId={portId}
        onPortChange={setPortId}
        fromInput={fromInput}
        toInput={toInput}
        onFromChange={setFromInput}
        onToChange={setToInput}
        onQuickRange={applyQuickRange}
        t={t}
      />
    </div>
  )
}
