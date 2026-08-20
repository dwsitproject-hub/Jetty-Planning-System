import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { X } from 'lucide-react'
import { formatDateTimeDisplay } from '../../utils/formatDateTimeDisplay.js'
import { useSegmentInspect } from './hooks/useSegmentInspect.js'
import IntegritySummary from './IntegritySummary.jsx'
import PollerHealthBlock from './PollerHealthBlock.jsx'
import SampleTelemetryTable, { BoundarySamplesTable } from './SampleTelemetryTable.jsx'

export default function AuditInspectorDrawer({ open, onClose, portId, tankId, segment, timezone, t }) {
  const { inspect, detailSamples, loading, error } = useSegmentInspect({
    portId,
    segment,
    tankId,
    open,
  })

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || !segment) return null

  const purposePath = segment.purpose === 'Unloading' ? 'unloading' : 'loading'
  const opLink = segment.operationId
    ? `/${purposePath}/op-${encodeURIComponent(segment.operationId)}/loading?cargo=1`
    : null

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-40 bg-slate-900/30"
        aria-label={t('cargoMovementInspectorClose')}
        onClick={onClose}
      />
      <aside
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-xl"
        aria-label={t('cargoMovementInspectorTitle')}
      >
        <header className="flex items-start justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">{t('cargoMovementInspectorTitle')}</h2>
            <p className="text-sm text-slate-600">{segment.vesselName}</p>
          </div>
          <button type="button" className="rounded p-1 hover:bg-slate-100" onClick={onClose}>
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 text-sm">
          {loading ? <p className="text-slate-500">{t('cargoMovementLoading')}</p> : null}
          {error ? <p className="text-red-700">{error}</p> : null}

          <section>
            <h3 className="text-sm font-semibold text-slate-800">{t('cargoMovementInspectorSegment')}</h3>
            <dl className="mt-2 space-y-1 text-xs text-slate-600">
              <div>{segment.purpose} · {segment.jettyName || '—'}</div>
              <div>
                {formatDateTimeDisplay(segment.startAt, timezone)}
                {' → '}
                {segment.endAt ? formatDateTimeDisplay(segment.endAt, timezone) : t('cargoMovementOpen')}
              </div>
            </dl>
          </section>

          {inspect ? (
            <>
              <IntegritySummary integrity={inspect.integrity} t={t} />
              <BoundarySamplesTable tanks={inspect.integrity?.boundaryTanks} t={t} />
              <section>
                <h3 className="text-sm font-semibold text-slate-800">{t('cargoMovementInspectorTelemetry')}</h3>
                <div className="mt-2">
                  <SampleTelemetryTable samples={detailSamples} timezone={timezone} t={t} />
                </div>
              </section>
              <PollerHealthBlock poller={inspect.poller} timezone={timezone} t={t} />
            </>
          ) : null}
        </div>

        {opLink ? (
          <footer className="border-t border-slate-200 px-4 py-3 text-sm">
            <Link to={opLink} className="text-slate-700 underline hover:text-slate-900">
              {t('cargoMovementOpenOperation')}
            </Link>
          </footer>
        ) : null}
      </aside>
    </>
  )
}
