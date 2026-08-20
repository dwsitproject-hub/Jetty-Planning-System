import { useMemo, useState } from 'react'
import CargoMovementToolbar from './CargoMovementToolbar.jsx'
import TankAuditCard from './TankAuditCard.jsx'
import AuditInspectorDrawer from './AuditInspectorDrawer.jsx'
import {
  filterCargoMovementTanks,
  computeBoardKpis,
} from './cargoMovementFilters.js'

export default function CargoMovementBoardV2({
  board,
  samplesByTank,
  loading,
  onRefresh,
  portName,
  ports,
  portId,
  onPortChange,
  fromInput,
  toInput,
  onFromChange,
  onToChange,
  onQuickRange,
  t,
}) {
  const [filters, setFilters] = useState({
    search: '',
    anomaliesOnly: false,
    atgOnly: false,
    hideIdle: true,
  })
  const [inspect, setInspect] = useState({ segment: null, tankId: null })

  const timezone = board?.scheduleTimezone || 'Asia/Jakarta'
  const tanks = board?.tanks ?? []

  const filteredTanks = useMemo(
    () => filterCargoMovementTanks(tanks, filters),
    [tanks, filters]
  )

  const kpis = useMemo(() => computeBoardKpis(tanks), [tanks])

  return (
    <div className="space-y-3">
      <CargoMovementToolbar
        t={t}
        portName={portName}
        ports={ports}
        portId={portId}
        onPortChange={onPortChange}
        fromInput={fromInput}
        toInput={toInput}
        onFromChange={onFromChange}
        onToChange={onToChange}
        onQuickRange={onQuickRange}
        onRefresh={onRefresh}
        loading={loading}
        filters={filters}
        onFiltersChange={setFilters}
        kpis={kpis}
      />

      {loading && !board ? (
        <p className="text-sm text-slate-500">{t('cargoMovementLoading')}</p>
      ) : filteredTanks.length === 0 ? (
        <p className="text-sm text-slate-500">{t('cargoMovementEmpty')}</p>
      ) : (
        <div className="space-y-2">
          {filteredTanks.map((tank, idx) => (
            <TankAuditCard
              key={tank.tankId}
              tank={tank}
              samples={samplesByTank[tank.tankId] ?? []}
              fromIso={board.from}
              toIso={board.to}
              timezone={timezone}
              t={t}
              defaultExpanded={filteredTanks.length <= 5 && idx < 3}
              onSelectSegment={(seg) => setInspect({ segment: seg, tankId: tank.tankId })}
            />
          ))}
        </div>
      )}

      <p className="text-xs text-slate-500">{t('cargoMovementSafetyNote')}</p>

      <AuditInspectorDrawer
        open={Boolean(inspect.segment)}
        onClose={() => setInspect({ segment: null, tankId: null })}
        portId={portId}
        tankId={inspect.tankId}
        segment={inspect.segment}
        timezone={timezone}
        t={t}
      />
    </div>
  )
}
