import { formatMass } from './cargoMovementFilters.js'

export default function IntegritySummary({ integrity, t }) {
  if (!integrity) return null
  const rows = [
    [t('cargoMovementInspectorMode'), integrity.atgQtyMode],
    [t('cargoMovementInspectorStoredQty'), `${formatMass(integrity.storedQty)} MT`],
    [t('cargoMovementInspectorStoredDelta'), `${formatMass(integrity.storedAtgMassDelta)} MT`],
    [t('cargoMovementInspectorLiveDelta'), `${formatMass(integrity.liveAtgMassDelta)} MT`],
    [t('cargoMovementInspectorAuditStatus'), integrity.atgAuditStatus],
    [t('cargoMovementInspectorQtySource'), integrity.qtySource ?? '—'],
  ]
  if (integrity.liveAtgError) {
    rows.push([t('cargoMovementInspectorLiveError'), integrity.liveAtgError])
  }

  return (
    <section>
      <h3 className="text-sm font-semibold text-slate-800">{t('cargoMovementInspectorIntegrity')}</h3>
      <dl className="mt-2 divide-y divide-slate-100 rounded border border-slate-200 text-xs">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3 px-3 py-2">
            <dt className="text-slate-500">{label}</dt>
            <dd className="font-medium text-slate-900">{value ?? '—'}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
