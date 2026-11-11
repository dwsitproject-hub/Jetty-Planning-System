/**
 * "Hours by rate" cell, header, and click-through breakdown for the By Voyage table.
 */
import {
  HOURS_BY_RATE_VIEWS,
  RATE_BAND_DEFS,
  bandPieGradient,
  fastShare,
  noFlowShare,
  profileTotalHours,
} from '../../utils/hourlyRateBands.js'
import HourlyRateSparkline from './HourlyRateSparkline.jsx'

const MIN_LISTED_HOURS = 0.5

function fmtH(n, d = 0) {
  return Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: d })
}

function pct(part, total) {
  return total > 0 ? Math.round((part / total) * 100) : 0
}

function Swatch({ color }) {
  return <i className="mgmt-rate-swatch" style={{ background: color }} aria-hidden="true" />
}

function StackedBar({ profile, total }) {
  return (
    <div className="mgmt-rate-bar">
      {RATE_BAND_DEFS.map((b) => {
        const h = Number(profile.bands[b.key]) || 0
        return h > 0 ? (
          <span key={b.key} style={{ width: `${(h / total) * 100}%`, background: b.color }} title={`${b.name}: ${fmtH(h, 1)} h`} />
        ) : null
      })}
    </div>
  )
}

function Caption({ profile }) {
  const fast = fastShare(profile)
  const stop = noFlowShare(profile)
  return (
    <div className="mgmt-rate-caption">
      {fmtH(profileTotalHours(profile))} h · {Math.round(fast * 100)}% fast · {Math.round(stop * 100)}% no flow
    </div>
  )
}

export function HourlyRateCell({ profile, view, scaleMax, loading, manual }) {
  const total = profileTotalHours(profile)
  if (!(total > 0)) {
    return (
      <span className="text-steel mgmt-rate-empty">
        {loading ? 'Loading…' : `No hourly data${manual ? ' (manual)' : ''}`}
      </span>
    )
  }
  if (view === 'line') {
    return (
      <>
        <HourlyRateSparkline series={profile.series} scaleMax={scaleMax} />
        <Caption profile={profile} />
      </>
    )
  }
  if (view === 'bar') {
    return (
      <>
        <StackedBar profile={profile} total={total} />
        <Caption profile={profile} />
      </>
    )
  }
  return (
    <div className="mgmt-rate-pie-cell">
      <div className="mgmt-rate-pie" style={{ background: bandPieGradient(profile) }} aria-hidden="true" />
      <div className="mgmt-rate-list">
        {RATE_BAND_DEFS.filter((b) => (Number(profile.bands[b.key]) || 0) >= MIN_LISTED_HOURS).map((b) => (
          <div key={b.key} className="mgmt-rate-list__row">
            <span><Swatch color={b.color} />{b.key === 'zero' ? b.name : b.range}</span>
            <span className="mgmt-r">{fmtH(profile.bands[b.key])} h</span>
            <span className="mgmt-r text-steel">{pct(profile.bands[b.key], total)}%</span>
          </div>
        ))}
        <div className="mgmt-rate-list__total">Total {fmtH(total)} h</div>
      </div>
    </div>
  )
}

function HeaderLegend({ view }) {
  if (view === 'line') {
    return (
      <div className="mgmt-rate-legend mgmt-rate-legend--line">
        <span><i className="mgmt-rate-legend__line" />Rate per hour (MT/h)</span>
        <span><i className="mgmt-rate-legend__dash" />75 MT/h = fast</span>
        <span><Swatch color="#B4B2A9" />Hours with no flow</span>
      </div>
    )
  }
  return (
    <div className="mgmt-rate-legend">
      {RATE_BAND_DEFS.map((b) => (
        <span key={b.key}>
          <Swatch color={b.color} />
          <b>{b.name}</b> {b.key === 'zero' ? '0' : b.range}
        </span>
      ))}
    </div>
  )
}

export function HoursByRateHeader({ view, onViewChange, sort, onSort }) {
  const active = sort?.key === 'hoursByRate'
  return (
    <th className="mgmt-voyage-th mgmt-voyage-th--rate-hours">
      <div className="mgmt-rate-head">
        <button
          type="button"
          className="mgmt-modal-sort mgmt-voyage-th__sort"
          onClick={() => onSort('hoursByRate')}
          aria-label="Sort by share of fast hours"
        >
          Hours by rate
          <span className="mgmt-voyage-th__sort-icon" aria-hidden="true">
            {active ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ' ⇅'}
          </span>
        </button>
        <span className="mgmt-rate-toggle" role="group" aria-label="Chart type">
          {HOURS_BY_RATE_VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              className={view === v.key ? 'is-on' : ''}
              aria-pressed={view === v.key}
              onClick={() => onViewChange(v.key)}
            >
              {v.label}
            </button>
          ))}
        </span>
      </div>
      <HeaderLegend view={view} />
      <div className="mgmt-rate-legend__note">
        {view === 'line' ? 'Hover for each hour' : 'Share of operational hours'} · click for breakdown
      </div>
    </th>
  )
}

export function HourlyRateBreakdownRow({ row, view, scaleMax, colSpan }) {
  const profile = row.hourlyProfile
  const total = profileTotalHours(profile)
  if (!(total > 0)) return null
  const fast = Math.round((fastShare(profile) || 0) * 100)
  const stop = Math.round((noFlowShare(profile) || 0) * 100)
  return (
    <tr className="mgmt-product-metric-evidence-row">
      <td colSpan={colSpan}>
        <div className="mgmt-rate-breakdown">
          <div className="mgmt-rate-breakdown__head">
            <b>Hours by rate · {row.vessel}</b>
            <span className="text-steel">
              source {String(profile.source || '—').toUpperCase()}
              {profile.excludedHours > 0 ? ` · ${fmtH(profile.excludedHours, 1)} h excluded (incomplete or direction mismatch)` : ''}
            </span>
          </div>
          <p className="mgmt-rate-breakdown__summary">
            Of <b>{fmtH(total)} operational hours</b>, cargo ran fast (≥75 MT/h) for <b>{fast}%</b> and did not flow for{' '}
            <b>{stop}%</b>.
          </p>
          {view === 'line' ? (
            <HourlyRateSparkline series={profile.series} scaleMax={scaleMax} width={560} height={150} detailed />
          ) : (
            <div className="mgmt-rate-breakdown__body">
              {view === 'pie' ? (
                <div className="mgmt-rate-pie mgmt-rate-pie--lg" style={{ background: bandPieGradient(profile) }} aria-hidden="true" />
              ) : null}
              <div className="mgmt-rate-breakdown__list">
                {RATE_BAND_DEFS.map((b) => (
                  <div key={b.key} className={`mgmt-rate-breakdown__row${view === 'bar' ? ' mgmt-rate-breakdown__row--track' : ''}`}>
                    <span><Swatch color={b.color} />{b.name} <span className="text-steel">{b.range}</span></span>
                    {view === 'bar' ? (
                      <span className="mgmt-rate-breakdown__track">
                        <span style={{ width: `${pct(profile.bands[b.key], total)}%`, background: b.color }} />
                      </span>
                    ) : null}
                    <span className="mgmt-r">{fmtH(profile.bands[b.key], 1)} h</span>
                    <b className="mgmt-r">{pct(profile.bands[b.key], total)}%</b>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </td>
    </tr>
  )
}
