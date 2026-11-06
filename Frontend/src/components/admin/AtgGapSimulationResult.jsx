import { useEffect, useState } from 'react'
import { formatWhen } from '../../utils/adminOpsDisplay'
import {
  formatGapDuration,
  formatHourRange,
  formatQty,
  formatQtyDelta,
  isSimulationStale,
  simulationAgeMinutes,
  visibleHourlyRows,
} from '../../utils/atgGapDisplay'

function deltaClass(value) {
  if (value > 0.05) return 'atg-gap-text--ok'
  if (value < -0.05) return 'atg-gap-text--warn'
  return ''
}

function useNowEvery(ms) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}

function HourlyTable({ rows, t }) {
  return (
    <table className="data-table atg-gap-sim__hours">
      <thead>
        <tr>
          <th>{t('atgGapSimColHour')}</th>
          <th className="admin-ops-detail-table__num">{t('atgGapSimColBefore')}</th>
          <th className="admin-ops-detail-table__num">{t('atgGapSimColAfter')}</th>
          <th className="admin-ops-detail-table__num">{t('atgGapSimColChange')}</th>
          <th>{t('atgGapSimColMovement')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((h) => (
          <tr key={`${h.loadLineId}|${h.hourStart}`} className={h.changed ? '' : 'atg-gap-op__row--acked'}>
            <td>
              {formatHourRange(h.hourStart, h.hourEnd)}
              {h.inGap ? null : <span className="text-steel"> · {t('atgGapSimOutsideGap')}</span>}
            </td>
            <td className="admin-ops-detail-table__num">{formatQty(h.qtyBefore)}</td>
            <td className="admin-ops-detail-table__num">{formatQty(h.qtyAfter)}</td>
            <td className={`admin-ops-detail-table__num ${deltaClass(h.qtyDelta)}`}>{formatQtyDelta(h.qtyDelta)}</td>
            <td>
              {h.statusBefore ? t(`atgGapMovement_${h.statusBefore}`) : '—'} → {h.statusAfter ? t(`atgGapMovement_${h.statusAfter}`) : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function CommodityRow({ summary, hourly, colSpan, t }) {
  const [open, setOpen] = useState(false)
  const [showUnchanged, setShowUnchanged] = useState(false)
  const rows = visibleHourlyRows(hourly, summary.commodity, showUnchanged)
  const unchangedCount = summary.hoursTotal - summary.hoursChanged
  const name = summary.commodity === '—' ? t('atgGapSimNoCommodity') : summary.commodity

  return (
    <>
      <tr>
        <td>{name}</td>
        <td className="admin-ops-detail-table__num">{formatQty(summary.qtyBefore)}</td>
        <td className="admin-ops-detail-table__num">{formatQty(summary.qtyAfter)}</td>
        <td className={`admin-ops-detail-table__num ${deltaClass(summary.qtyDelta)}`}>
          <strong>{formatQtyDelta(summary.qtyDelta)}</strong>
        </td>
        <td className="admin-ops-detail-table__num">{summary.hoursChanged} / {summary.hoursTotal}</td>
        <td>
          <button type="button" className="btn btn--ghost btn--sm" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {open ? t('atgGapSimHideHourly') : t('atgGapSimShowHourly')}
          </button>
        </td>
      </tr>
      {open ? (
        <tr className="atg-gap-sim__detail">
          <td colSpan={colSpan}>
            {rows.length ? <HourlyTable rows={rows} t={t} /> : <p className="text-steel">{t('atgGapSimNoChangedHours')}</p>}
            {unchangedCount > 0 ? (
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowUnchanged((v) => !v)}>
                {showUnchanged ? t('atgGapSimHideUnchanged') : t('atgGapSimShowUnchanged', { count: unchangedCount })}
              </button>
            ) : null}
          </td>
        </tr>
      ) : null}
    </>
  )
}

/**
 * What Run would do, computed in a rolled-back transaction. Default view is quantity per
 * commodity; per-hour numbers open on request.
 */
export default function AtgGapSimulationResult({ sim, t }) {
  const now = useNowEvery(30000)
  const stale = isSimulationStale(sim.simulatedAt, now)
  const { byCommodity, total } = sim.quantity
  const closed = sim.closedGapKeys.length
  const targeted = sim.targetGapKeys.length

  return (
    <section className="atg-gap-sim" aria-label={t('atgGapSimTitle')}>
      <p className="atg-gap-callout atg-gap-callout--neutral">
        <strong>{t('atgGapSimBanner')}</strong>
        <br />
        {t('atgGapSimAge', { minutes: simulationAgeMinutes(sim.simulatedAt, now) })}
      </p>
      {stale ? <p className="atg-gap-callout atg-gap-callout--warning">{t('atgGapSimStale')}</p> : null}

      <div className="atg-gap-stats">
        <div className="atg-gap-stat">
          <span className="atg-gap-stat__value">{closed} / {targeted}</span>
          <span className="atg-gap-stat__label">{t('atgGapSimGapsClosed')}</span>
        </div>
        <div className="atg-gap-stat">
          <span className="atg-gap-stat__value">{t(`adminOpsStatus_${sim.status.before}`)} → {t(`adminOpsStatus_${sim.status.after}`)}</span>
          <span className="atg-gap-stat__label">{t('atgGapSimStatus')}</span>
        </div>
        <div className="atg-gap-stat">
          <span className="atg-gap-stat__value">{sim.samplesWouldInsert}</span>
          <span className="atg-gap-stat__label">{t('atgGapSimSamples')}</span>
        </div>
        <div className="atg-gap-stat">
          <span className="atg-gap-stat__value">{sim.daily.changed}</span>
          <span className="atg-gap-stat__label">{t('atgGapSimDailyRows')}</span>
        </div>
      </div>

      <h3 className="atg-gap-result__heading">{t('atgGapSimQtyTitle')}</h3>
      {byCommodity.length ? (
        <table className="data-table atg-gap-dialog__table">
          <thead>
            <tr>
              <th>{t('atgGapColCommodity')}</th>
              <th className="admin-ops-detail-table__num">{t('atgGapSimColBefore')}</th>
              <th className="admin-ops-detail-table__num">{t('atgGapSimColAfter')}</th>
              <th className="admin-ops-detail-table__num">{t('atgGapSimColChange')}</th>
              <th className="admin-ops-detail-table__num">{t('atgGapSimColHours')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {byCommodity.map((s) => (
              <CommodityRow key={s.commodity} summary={s} hourly={sim.hourly} colSpan={6} t={t} />
            ))}
            <tr className="atg-gap-sim__total">
              <td>{t('atgGapSimTotal')}</td>
              <td className="admin-ops-detail-table__num">{formatQty(total.qtyBefore)}</td>
              <td className="admin-ops-detail-table__num">{formatQty(total.qtyAfter)}</td>
              <td className={`admin-ops-detail-table__num ${deltaClass(total.qtyDelta)}`}>
                <strong>{formatQtyDelta(total.qtyDelta)}</strong>
              </td>
              <td className="admin-ops-detail-table__num">{total.hoursChanged} / {total.hoursTotal}</td>
              <td />
            </tr>
          </tbody>
        </table>
      ) : (
        <p className="text-steel">{t('atgGapSimNoQty')}</p>
      )}
      <p className="text-steel atg-gap-dialog__sub">{t('atgGapSimQtyNote')}</p>

      {sim.stillMissing.length ? (
        <>
          <h3 className="atg-gap-result__heading">{t('atgGapSimStillMissing')}</h3>
          <ul className="atg-gap-result__list">
            {sim.stillMissing.map((g) => (
              <li key={g.gapKey}>
                {formatWhen(g.startAt)} → {formatWhen(g.endAt)} ({formatGapDuration(g.durationMinutes)})
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {sim.archiveErrors.length ? (
        <ul className="atg-gap-result__list admin-ops-error">
          {sim.archiveErrors.map((e, i) => (
            <li key={`${e.tankCode}-${i}`}>{e.tankCode}: {e.message}</li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
