/**
 * Hourly cargo rates for Operations load lines on one calendar day (Mgmt flow evidence).
 */
import { useEffect, useMemo, useState } from 'react'
import { fetchActivityTimeline, fetchCargoSegmentHourly } from '../../api/operations.js'
import { formatDailyRateDateLabel } from '../../utils/cargoDailyRates.js'
import { mapCargoSegmentHourlyResponse } from '../../utils/cargoSegmentHourlyHelpers.js'
import { formatDateTimeDisplay } from '../../utils/formatDateTimeDisplay.js'
import { formatCompactHourlyRange } from '../../utils/hourlyCargoDisplay.js'
import {
  MGMT_DASHBOARD_TIMEZONE,
  buildPersistedCargoSegmentHourlyRequests,
  cargoEntryEvidenceLabel,
  cargoEntryOverlapsLocalDate,
  cargoPersistedLoadLinesFromTimeline,
  hourlyBucketsOnLocalDate,
} from '../../utils/managementDashboardMetricEvidence.js'

function fmtNum(n, d = 1) {
  return n == null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: d })
}

function bucketQtyMoved(bucket) {
  const tanks = bucket?.tankDetail
  if (Array.isArray(tanks) && tanks.length) {
    return tanks.reduce((s, t) => s + (Number(t.qtyMoved ?? t.displayQtyMoved) || 0), 0)
  }
  const direct = Number(bucket?.displayQtyMoved ?? bucket?.qtyMoved ?? bucket?.moved_qty)
  if (Number.isFinite(direct)) return direct
  return 0
}

function bucketRateTph(bucket) {
  const rate = Number(bucket?.displayRateTph ?? bucket?.rateTph)
  return Number.isFinite(rate) ? rate : null
}

function entryDayStats(hours) {
  const list = hours || []
  if (!list.length) return null
  let qty = 0
  let rateSum = 0
  let rateCount = 0
  for (const b of list) {
    qty += bucketQtyMoved(b)
    const r = bucketRateTph(b)
    if (r != null && r > 0) {
      rateSum += r
      rateCount += 1
    }
  }
  const avg = rateCount > 0 ? +(rateSum / rateCount).toFixed(1) : null
  return { hours: list.length, qty, avg }
}

function lineWindowLabel(line) {
  const start = line?.startedAt || line?.startAt
  const end = line?.endedAt || line?.endAt
  if (!start) return '—'
  const a = formatDateTimeDisplay(start)
  const b = end ? formatDateTimeDisplay(end) : 'In progress'
  return `${a} → ${b}`
}

function parseEntryLabel(label) {
  const raw = String(label ?? '').trim()
  const parts = raw.split(' · ')
  if (parts.length >= 2) {
    return { title: parts[0], tanks: parts.slice(1).join(' · ') }
  }
  return { title: raw || '—', tanks: null }
}

export default function FlowEvidenceDayDetail({
  operationId,
  dateKey,
  productKey,
  timelineEvents,
  onTimelineLoaded,
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [entries, setEntries] = useState([])

  useEffect(() => {
    if (!operationId || !dateKey) {
      setEntries([])
      setError(null)
      return undefined
    }
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      setEntries([])
      try {
        let events = Array.isArray(timelineEvents) ? timelineEvents : null
        if (!events?.length) {
          const res = await fetchActivityTimeline(operationId)
          events = (res && res.events) || []
          if (!cancelled && onTimelineLoaded) onTimelineLoaded(events)
        }
        const lines = cargoPersistedLoadLinesFromTimeline(events, productKey).filter((line) =>
          cargoEntryOverlapsLocalDate(line, dateKey),
        )
        if (!lines.length) {
          if (!cancelled) setEntries([])
          return
        }
        const segments = buildPersistedCargoSegmentHourlyRequests(lines)
        const res = await fetchCargoSegmentHourly(operationId, segments)
        if (cancelled) return
        const byKey = mapCargoSegmentHourlyResponse(res)
        setEntries(
          lines.map((line) => {
            const key = String(line.id)
            const slice = byKey.get(key)
            const hours = hourlyBucketsOnLocalDate(slice?.hourlyBuckets || [], dateKey)
            return {
              key,
              label: cargoEntryEvidenceLabel(line),
              window: lineWindowLabel(line),
              hours,
              fetchError: slice?.error ?? null,
            }
          }),
        )
      } catch (err) {
        if (!cancelled) setError(err?.message || 'Failed to load hourly detail')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [operationId, dateKey, productKey, timelineEvents, onTimelineLoaded])

  const dateLabel = useMemo(() => formatDailyRateDateLabel(dateKey), [dateKey])

  if (loading) {
    return <p className="text-steel mgmt-product-metric-evidence__note">Loading cargo entry hours…</p>
  }
  if (error) {
    return <p className="mgmt-product-metric-evidence__warn">{error}</p>
  }
  if (!entries.length) {
    return (
      <p className="text-steel mgmt-product-metric-evidence__note">
        No cargo entries saved in Operations for {dateLabel || dateKey}.
      </p>
    )
  }

  return (
    <div className="mgmt-flow-evidence__entries">
      {entries.map((entry) => {
        const { title, tanks } = parseEntryLabel(entry.label)
        const stats = entryDayStats(entry.hours)
        return (
          <article key={entry.key} className="mgmt-flow-evidence__entry-card">
            <header className="mgmt-flow-evidence__entry-head">
              <div className="mgmt-flow-evidence__entry-title">
                <strong>{title}</strong>
                {tanks ? <span className="mgmt-flow-evidence__entry-tanks">{tanks}</span> : null}
              </div>
              <p className="mgmt-flow-evidence__entry-window text-steel">{entry.window}</p>
            </header>
            {entry.fetchError ? (
              <p className="mgmt-product-metric-evidence__warn">{entry.fetchError}</p>
            ) : null}
            {entry.hours.length === 0 ? (
              <p className="text-steel mgmt-product-metric-evidence__note">No logged hours on this date.</p>
            ) : (
              <>
                <table className="mgmt-flow-hourly-table">
                  <colgroup>
                    <col className="mgmt-flow-hourly-table__col-time" />
                    <col className="mgmt-flow-hourly-table__col-moved" />
                    <col className="mgmt-flow-hourly-table__col-rate" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th scope="col">Time</th>
                      <th scope="col" className="mgmt-flow-hourly-table__num">
                        Moved (MT)
                      </th>
                      <th scope="col" className="mgmt-flow-hourly-table__num">
                        Rate (MT/h)
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {entry.hours.map((b) => {
                      const hourStart = b.hourStart || b.hour_start
                      const hourEnd = b.hourEnd || b.hour_end
                      const range = formatCompactHourlyRange(hourStart, hourEnd, {
                        timeZone: MGMT_DASHBOARD_TIMEZONE,
                        locale: 'en-GB',
                      })
                      return (
                        <tr key={hourStart}>
                          <td className="mgmt-flow-hourly-table__time">{range}</td>
                          <td className="mgmt-flow-hourly-table__num">
                            {fmtNum(bucketQtyMoved(b), 0)}
                          </td>
                          <td className="mgmt-flow-hourly-table__num mgmt-flow-hourly-table__rate">
                            {fmtNum(bucketRateTph(b))}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {stats ? (
                  <p className="mgmt-flow-evidence__entry-foot text-steel">
                    {stats.hours} hour{stats.hours === 1 ? '' : 's'} · {fmtNum(stats.qty, 0)} MT moved
                    {stats.avg != null ? ` · avg ${fmtNum(stats.avg)} MT/h` : ''}
                  </p>
                ) : null}
              </>
            )}
          </article>
        )
      })}
    </div>
  )
}
