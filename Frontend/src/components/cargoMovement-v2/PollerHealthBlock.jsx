import { formatDateTimeDisplay } from '../../utils/formatDateTimeDisplay.js'

export default function PollerHealthBlock({ poller, timezone, t }) {
  if (!poller) return null
  const ok = poller.lastPollOk !== false

  return (
    <section>
      <h3 className="text-sm font-semibold text-slate-800">{t('cargoMovementInspectorPoller')}</h3>
      <dl className="mt-2 space-y-2 rounded border border-slate-200 p-3 text-xs">
        <div className="flex justify-between gap-2">
          <dt className="text-slate-500">{t('cargoMovementInspectorPollStatus')}</dt>
          <dd className={ok ? 'text-emerald-700' : 'text-red-700'}>
            {ok ? t('cargoMovementPollerNormal') : t('cargoMovementPollerFault')}
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-slate-500">{t('cargoMovementInspectorLastPoll')}</dt>
          <dd>{poller.lastPollAt ? formatDateTimeDisplay(poller.lastPollAt, timezone) : '—'}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-slate-500">{t('cargoMovementInspectorSource')}</dt>
          <dd className="break-all text-right">{poller.sourceBaseUrl || '—'}</dd>
        </div>
        {poller.lastError ? (
          <div>
            <dt className="text-slate-500">{t('cargoMovementInspectorLastError')}</dt>
            <dd className="mt-1 text-red-700">{poller.lastError}</dd>
          </div>
        ) : null}
      </dl>
    </section>
  )
}
