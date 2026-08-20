import { useMemo } from 'react'
import { DateTime } from 'luxon'
import { formatDateTimeDisplay } from '../../utils/formatDateTimeDisplay.js'
import CargoMovementLegend from './CargoMovementLegend.jsx'
import TankMovementRow from './TankMovementRow.jsx'

function applyFilters(tanks, { atgOnly, hasMovement, showIdle }) {
  return tanks.filter((tank) => {
    const segCount = tank.segments?.length ?? 0
    if (!showIdle && segCount === 0) return false
    if (hasMovement && segCount === 0) return false
    if (atgOnly && !tank.hasAtg) return false
    return true
  })
}

export default function CargoMovementBoard({
  board,
  samplesByTank = {},
  filters,
  onFilterChange,
  loading,
  onRefresh,
  t,
  nowMs = Date.now(),
}) {
  const timezone = board?.scheduleTimezone || 'Asia/Jakarta'
  const fromIso = board?.from
  const toIso = board?.to

  const filteredTanks = useMemo(
    () => applyFilters(board?.tanks ?? [], filters),
    [board?.tanks, filters]
  )

  const axisTicks = useMemo(() => {
    if (!fromIso || !toIso) return []
    const from = DateTime.fromISO(fromIso, { zone: timezone })
    const to = DateTime.fromISO(toIso, { zone: timezone })
    const mid = from.plus({ milliseconds: to.toMillis() - from.toMillis() })
    return [
      { label: formatDateTimeDisplay(fromIso, timezone), pos: '0%' },
      { label: formatDateTimeDisplay(mid.toISO(), timezone), pos: '50%' },
      { label: formatDateTimeDisplay(toIso, timezone), pos: '100%' },
    ]
  }, [fromIso, toIso, timezone])

  return (
    <section className="card">
      <div className="cargo-movement-toolbar">
        <CargoMovementLegend t={t} />
        <button type="button" className="btn btn--secondary btn--small" onClick={onRefresh} disabled={loading}>
          {t('cargoMovementRefresh')}
        </button>
      </div>

      <div className="cargo-movement-filters">
        <label>
          <input
            type="checkbox"
            checked={filters.atgOnly}
            onChange={(e) => onFilterChange({ ...filters, atgOnly: e.target.checked })}
          />
          {t('cargoMovementFilterAtgOnly')}
        </label>
        <label>
          <input
            type="checkbox"
            checked={filters.hasMovement}
            onChange={(e) => onFilterChange({ ...filters, hasMovement: e.target.checked })}
          />
          {t('cargoMovementFilterHasMovement')}
        </label>
        <label>
          <input
            type="checkbox"
            checked={filters.showIdle}
            onChange={(e) => onFilterChange({ ...filters, showIdle: e.target.checked })}
          />
          {t('cargoMovementFilterShowIdle')}
        </label>
      </div>

      {loading && !board ? (
        <p className="text-steel">{t('cargoMovementLoading')}</p>
      ) : filteredTanks.length === 0 ? (
        <p className="text-steel">{t('cargoMovementEmpty')}</p>
      ) : (
        <div className="cargo-movement-board">
          {filteredTanks.map((tank) => (
            <TankMovementRow
              key={tank.tankId}
              tank={tank}
              samples={samplesByTank[tank.tankId] ?? []}
              fromIso={fromIso}
              toIso={toIso}
              timezone={timezone}
              t={t}
              nowMs={nowMs}
            />
          ))}
          {axisTicks.length ? (
            <div className="cargo-movement-axis" aria-hidden>
              {axisTicks.map((tick) => (
                <span key={tick.pos} style={{ position: 'absolute', left: tick.pos, transform: 'translateX(-50%)' }}>
                  {tick.label}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      )}

      <p className="cargo-movement-safety">{t('cargoMovementSafetyNote')}</p>
    </section>
  )
}
