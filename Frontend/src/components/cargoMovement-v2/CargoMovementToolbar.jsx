import { Search, RefreshCw } from 'lucide-react'
import CargoMovementLegend from './CargoMovementLegend.jsx'

export default function CargoMovementToolbar({
  t,
  portName,
  ports,
  portId,
  onPortChange,
  fromInput,
  toInput,
  onFromChange,
  onToChange,
  onQuickRange,
  onRefresh,
  loading,
  filters,
  onFiltersChange,
  kpis,
}) {
  return (
    <div className="sticky top-0 z-20 space-y-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[140px]">
          <div className="text-xs font-medium text-slate-500">{t('cargoMovementPort')}</div>
          <div className="text-sm font-semibold text-slate-900">{portName || '—'}</div>
        </div>
        {ports.length > 1 ? (
          <label className="flex flex-col gap-1 text-xs text-slate-600">
            {t('cargoMovementPort')}
            <select
              className="rounded border border-slate-300 px-2 py-1.5 text-sm"
              value={portId}
              onChange={(e) => onPortChange(e.target.value)}
            >
              {ports.map((p) => (
                <option key={p.id} value={String(p.id)}>{p.name || `#${p.id}`}</option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          {t('cargoMovementFrom')}
          <input
            type="datetime-local"
            className="rounded border border-slate-300 px-2 py-1.5 text-sm"
            value={fromInput}
            onChange={(e) => onFromChange(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          {t('cargoMovementTo')}
          <input
            type="datetime-local"
            className="rounded border border-slate-300 px-2 py-1.5 text-sm"
            value={toInput}
            onChange={(e) => onToChange(e.target.value)}
          />
        </label>
        <div className="flex gap-1">
          {[7, 14, 30].map((d) => (
            <button
              key={d}
              type="button"
              className="rounded border border-slate-300 px-2 py-1.5 text-xs hover:bg-slate-50"
              onClick={() => onQuickRange(d)}
            >
              {d}d
            </button>
          ))}
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded bg-slate-800 px-3 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
          onClick={onRefresh}
          disabled={loading}
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          {t('cargoMovementRefresh')}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-4 border-t border-slate-100 pt-3">
        <label className="relative flex items-center gap-2 text-sm text-slate-700">
          <Search className="h-4 w-4 text-slate-400" />
          <input
            type="search"
            className="w-48 rounded border border-slate-300 py-1 pl-1 pr-2 text-sm"
            placeholder={t('cargoMovementSearchPlaceholder')}
            value={filters.search}
            onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={filters.anomaliesOnly}
            onChange={(e) => onFiltersChange({ ...filters, anomaliesOnly: e.target.checked })}
          />
          {t('cargoMovementFilterAnomaliesOnly')}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={filters.atgOnly}
            onChange={(e) => onFiltersChange({ ...filters, atgOnly: e.target.checked })}
          />
          {t('cargoMovementFilterAtgOnly')}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={filters.hideIdle}
            onChange={(e) => onFiltersChange({ ...filters, hideIdle: e.target.checked })}
          />
          {t('cargoMovementFilterHideIdle')}
        </label>
        <div className="ml-auto flex flex-wrap gap-2">
          <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 ring-1 ring-red-200">
            {kpis.anomalyCount} {t('cargoMovementKpiAnomalies')}
          </span>
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-amber-200">
            {kpis.gapCount} {t('cargoMovementKpiGaps')}
          </span>
          <span className="rounded-full bg-orange-50 px-2 py-0.5 text-xs font-medium text-orange-800 ring-1 ring-orange-200">
            {kpis.pollFaultCount} {t('cargoMovementKpiPollFaults')}
          </span>
        </div>
      </div>

      <CargoMovementLegend t={t} />
    </div>
  )
}
