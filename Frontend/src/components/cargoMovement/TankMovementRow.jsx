import { useMemo, useRef, useState, useLayoutEffect } from 'react'
import TankMassCurveLane from './TankMassCurveLane.jsx'
import TankVesselSegmentLane from './TankVesselSegmentLane.jsx'
import { createCargoMovementTimeScale } from '../../utils/cargoMovementTimeScale.js'

export default function TankMovementRow({ tank, samples = [], fromIso, toIso, timezone, t, nowMs }) {
  const laneWrapRef = useRef(null)
  const [laneWidth, setLaneWidth] = useState(640)

  useLayoutEffect(() => {
    const el = laneWrapRef.current
    if (!el) return undefined
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width
      if (w && w > 0) setLaneWidth(Math.floor(w))
    })
    ro.observe(el)
    setLaneWidth(Math.max(el.clientWidth, 320))
    return () => ro.disconnect()
  }, [])

  const scale = useMemo(
    () => createCargoMovementTimeScale(fromIso, toIso, laneWidth),
    [fromIso, toIso, laneWidth]
  )

  const currentLabel = tank.currentMovement
    ? `${tank.currentMovement.vesselName} (${tank.currentMovement.purpose || '—'})`
    : t('cargoMovementIdle')

  return (
    <article className="cargo-movement-row" data-tank-id={tank.tankId}>
      <header className="cargo-movement-row__header">
        <span className="cargo-movement-row__title">
          {tank.code}{tank.name ? ` · ${tank.name}` : ''}
        </span>
        {tank.hasAtg ? (
          <span className="cargo-movement-chip">{t('cargoMovementAtgMapped')}</span>
        ) : null}
        {tank.sourceLastPollOk === false ? (
          <span className="cargo-movement-chip cargo-movement-chip--warn">{t('cargoMovementPollerFault')}</span>
        ) : null}
        <span className={`cargo-movement-chip ${tank.currentMovement ? '' : 'cargo-movement-chip--idle'}`}>
          {t('cargoMovementCurrent')}: {currentLabel}
        </span>
      </header>

      <div className="cargo-movement-lanes" ref={laneWrapRef}>
        <div className="cargo-movement-lane-label">{t('cargoMovementLaneMass')}</div>
        <TankMassCurveLane scale={scale} samples={samples} segments={tank.segments} t={t} />

        <div className="cargo-movement-lane-label">{t('cargoMovementLaneVessel')}</div>
        <TankVesselSegmentLane
          scale={scale}
          segments={tank.segments}
          timezone={timezone}
          t={t}
          nowMs={nowMs}
        />
      </div>
    </article>
  )
}
