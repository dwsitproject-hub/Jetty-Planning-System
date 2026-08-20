import { useMemo } from 'react'
import { splitSampleRuns } from '../../utils/cargoMovementTimeScale.js'

const LANE_H = 52
const PAD_Y = 8

/**
 * @param {object} props
 * @param {import('../../utils/cargoMovementTimeScale.js').createCargoMovementTimeScale extends Function ? ReturnType<typeof import('../../utils/cargoMovementTimeScale.js').createCargoMovementTimeScale> : object} props.scale
 * @param {Array<{ sampledAt: string, totalMass: number }>} props.samples
 * @param {Array<{ startAt: string|null, endAt: string|null, atgAuditStatus: string }>} [props.segments]
 */
export default function TankMassCurveLane({ scale, samples = [], segments = [], t }) {
  const model = useMemo(() => {
    if (!samples.length) return null

    const masses = samples.map((s) => s.totalMass).filter((v) => Number.isFinite(v))
    if (!masses.length) return null

    const minM = Math.min(...masses)
    const maxM = Math.max(...masses)
    const span = Math.max(maxM - minM, 1)
    const innerH = LANE_H - PAD_Y * 2;

    const runs = splitSampleRuns(samples)
    const paths = runs.map((run) => {
      const pts = run.map((s) => {
        const x = scale.toX(Date.parse(s.sampledAt))
        const y = PAD_Y + innerH - ((s.totalMass - minM) / span) * innerH
        return `${x.toFixed(1)},${y.toFixed(1)}`
      })
      return pts.join(' ')
    })

    const gapMarkers = []
    for (const seg of segments) {
      if (seg.atgAuditStatus !== 'sample_gap' || !seg.endAt) continue
      const x = scale.toX(Date.parse(seg.endAt))
      gapMarkers.push({ x, label: t('cargoMovementSampleGap') })
    }

    return { paths, minM, maxM, gapMarkers, innerH }
  }, [samples, scale, segments, t])

  if (!model) {
    return <div className="cargo-movement-empty-lane">{t('cargoMovementNoSamples')}</div>
  }

  return (
    <svg className="cargo-movement-lane-svg" viewBox={`0 0 ${scale.width} ${LANE_H}`} role="img" aria-label={t('cargoMovementMassLaneAria')}>
      <defs>
        <pattern id="cm-hatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
          <rect width="6" height="6" fill="#e5e7eb" />
          <line x1="0" y1="0" x2="0" y2="6" stroke="#9ca3af" strokeWidth="2" />
        </pattern>
      </defs>
      {model.paths.map((pts, i) => (
        <polyline key={i} className="cargo-movement-curve" points={pts} />
      ))}
      {model.gapMarkers.map((g, i) => (
        <g key={`gap-${i}`}>
          <line
            className="cargo-movement-gap-line"
            x1={g.x}
            y1={PAD_Y}
            x2={g.x}
            y2={LANE_H - PAD_Y}
          />
          <text x={g.x + 4} y={PAD_Y + 10} className="cargo-movement-seg-label" fill="#92400e">
            {g.label}
          </text>
        </g>
      ))}
    </svg>
  )
}

export { LANE_H }
