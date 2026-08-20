import { CheckCircle2, AlertTriangle, Layers, Loader2 } from 'lucide-react'

const ITEMS = [
  { key: 'ok', icon: CheckCircle2, className: 'bg-emerald-700 border-emerald-800' },
  { key: 'manual', icon: Layers, className: 'cm-hatch-manual border-slate-500' },
  { key: 'gap', icon: AlertTriangle, className: 'bg-amber-100 border-amber-500 ring-1 ring-amber-400' },
  { key: 'progress', icon: Loader2, className: 'bg-blue-100 border-blue-500 border-dashed cm-pulse-edge' },
]

export default function CargoMovementLegend({ t }) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600" aria-label={t('cargoMovementLegendAria')}>
      {ITEMS.map(({ key, icon: Icon, className }) => (
        <span key={key} className="inline-flex items-center gap-1.5">
          <span className={`inline-block h-3.5 w-3.5 rounded-sm border ${className}`} aria-hidden />
          <Icon className="h-3.5 w-3.5 opacity-70" aria-hidden />
          {t(`cargoMovementLegend_${key}`)}
        </span>
      ))}
    </div>
  )
}
