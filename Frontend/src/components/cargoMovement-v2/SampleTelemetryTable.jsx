import { formatDateTimeDisplay } from '../../utils/formatDateTimeDisplay.js'
import { formatMass } from './cargoMovementFilters.js'

export default function SampleTelemetryTable({ samples, timezone, t }) {
  if (!samples?.length) {
    return <p className="text-xs text-slate-500">{t('cargoMovementInspectorNoSamples')}</p>
  }

  return (
    <div className="max-h-48 overflow-auto rounded border border-slate-200">
      <table className="min-w-full text-left text-xs">
        <thead className="sticky top-0 bg-slate-50 text-slate-500">
          <tr>
            <th className="px-2 py-1.5">{t('cargoMovementInspectorSampleTime')}</th>
            <th className="px-2 py-1.5">{t('cargoMovementInspectorSampleMass')}</th>
            <th className="px-2 py-1.5">{t('cargoMovementInspectorSampleLevel')}</th>
          </tr>
        </thead>
        <tbody>
          {samples.map((s) => (
            <tr key={s.sampledAt} className="border-t border-slate-100">
              <td className="px-2 py-1">{formatDateTimeDisplay(s.sampledAt, timezone)}</td>
              <td className="px-2 py-1">{formatMass(s.totalMass)}</td>
              <td className="px-2 py-1">{s.levelMm != null ? formatMass(s.levelMm) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function BoundarySamplesTable({ tanks, t }) {
  if (!tanks?.length) return null
  return (
    <section>
      <h3 className="text-sm font-semibold text-slate-800">{t('cargoMovementInspectorBoundary')}</h3>
      <dl className="mt-2 space-y-2 text-xs">
        {tanks.map((tk) => (
          <div key={tk.tankId || tk.code} className="rounded border border-slate-200 p-2">
            <div className="font-medium">{tk.code || tk.tankId}</div>
            <div className="mt-1 text-slate-600">
              Start: {formatMass(tk.massStart)} @ {tk.sampleStartAt || '—'}
            </div>
            <div className="text-slate-600">
              End: {formatMass(tk.massEnd)} @ {tk.sampleEndAt || '—'}
            </div>
            {tk.error ? <div className="mt-1 text-amber-700">{tk.error}</div> : null}
          </div>
        ))}
      </dl>
    </section>
  )
}
