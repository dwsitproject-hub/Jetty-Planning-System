/**
 * Charts in the By Vessel drill-down: where each voyage's time went, and each voyage's rate.
 */
import { useMemo } from 'react'
import { voyageFlowRate } from '../../utils/managementDashboardFlow.js'
import { fmtMgmtCastOffDate } from '../../utils/managementDashboardMetricEvidence.js'
import { voyageTimeSegments } from '../../utils/managementDashboardVesselCharts.js'
import { fmtMgmtDurationHours } from './ManagementProductTable.jsx'

const BAR_MAX_PX = 64
const DATE_ROW_PX = 14
const shortDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : 'Now')
const purposeChip = (r) => (r.purpose === 'Loading' ? 'LOAD' : 'UNLOAD')
const purposeCls = (r) => (r.purpose === 'Loading' ? 'wf-load' : 'wf-disch')

export function TimeSplitChart({ voyages, split }) {
  const rows = useMemo(
    () => voyages.map((r) => ({ r, ...voyageTimeSegments(r, split) })).filter((x) => x.total > 0),
    [voyages, split],
  )
  const max = Math.max(...rows.map((x) => x.total), 0)
  const legend = useMemo(() => {
    const seen = new Map()
    rows.forEach(({ segs }) => segs.forEach((s) => seen.has(s.key) || seen.set(s.key, s)))
    return [...seen.values()]
  }, [rows])

  return (
    <div className="mgmt-vchart">
      <h4 className="mgmt-vchart__title">Where each voyage's time went</h4>
      {rows.length ? (
        <>
          <div className="mgmt-vtime">
            {rows.map(({ r, segs, total }) => (
              <div key={r.id} className="mgmt-vtime__row">
                <span className="mgmt-vtime__lbl">
                  {r.castOff ? fmtMgmtCastOffDate(r.castOff) : 'At berth'}
                  <span className={`mgmt-vtime__purpose ${purposeCls(r)}`}>{purposeChip(r)}</span>
                </span>
                <span className="mgmt-vtime__track">
                  <span className="mgmt-vtime__bar" style={{ width: `${(total / max) * 100}%` }}>
                    {segs.map((s) => (
                      <span
                        key={s.key}
                        className={`mgmt-vtime__seg ${s.cls}`}
                        style={{ flex: `${s.v} 0 0` }}
                        title={`${s.n}: ${fmtMgmtDurationHours(s.v)}`}
                      />
                    ))}
                  </span>
                </span>
                <span className="mgmt-vtime__tot">{fmtMgmtDurationHours(total)}</span>
              </div>
            ))}
          </div>
          <div className="mgmt-legend">
            {legend.map((s) => (
              <span key={s.key}><i className={`mgmt-sw ${s.cls}`} />{s.n}</span>
            ))}
          </div>
        </>
      ) : (
        <p className="text-steel mgmt-sub">No time stages recorded for these voyages yet.</p>
      )}
    </div>
  )
}

/** Achieved rate of each voyage, oldest to newest, with a dashed line at the vessel's average. */
export function RateBarsChart({ voyages, average }) {
  const items = useMemo(() => [...voyages].reverse().map((r) => ({ r, rate: voyageFlowRate(r) })), [voyages])
  const max = Math.max(...items.map((i) => i.rate ?? 0), average ?? 0, 0)
  const px = (v) => (max > 0 ? Math.max(Math.round((v / max) * BAR_MAX_PX), 3) : 0)
  const hasData = items.some((i) => i.rate != null)
  const purposes = [...new Set(items.map((i) => i.r.purpose === 'Loading' ? 'Loading' : 'Unloading'))]

  return (
    <div className="mgmt-vchart">
      <h4 className="mgmt-vchart__title">Achieved rate per voyage (MT/h)</h4>
      {hasData ? (
        <>
          <div className="mgmt-vspeed">
            {average != null ? (
              <span
                className="mgmt-vspeed__avg"
                style={{ bottom: `${DATE_ROW_PX + px(average)}px` }}
                title={`Average ${average.toLocaleString('en-US', { maximumFractionDigits: 1 })} MT/h`}
              />
            ) : null}
            {items.map(({ r, rate }) => (
              <div key={r.id} className="mgmt-vspeed__col" title={`${shortDate(r.castOff)} · ${rate == null ? 'no rate' : `${rate.toLocaleString('en-US', { maximumFractionDigits: 1 })} MT/h`}`}>
                <span className="mgmt-vspeed__val">{rate == null ? '—' : Math.round(rate)}</span>
                {rate == null ? null : <span className={`mgmt-vspeed__bar ${purposeCls(r)}`} style={{ height: `${px(rate)}px` }} />}
                <span className="mgmt-vspeed__date" style={{ height: `${DATE_ROW_PX}px` }}>{shortDate(r.castOff)}</span>
              </div>
            ))}
          </div>
          <div className="mgmt-legend">
            {purposes.includes('Loading') ? <span><i className="mgmt-sw wf-load" />Loading</span> : null}
            {purposes.includes('Unloading') ? <span><i className="mgmt-sw wf-disch" />Unloading</span> : null}
            <span><i className="mgmt-vspeed__avg-key" />Vessel average</span>
          </div>
        </>
      ) : (
        <p className="text-steel mgmt-sub">No rate recorded for these voyages yet.</p>
      )}
    </div>
  )
}
