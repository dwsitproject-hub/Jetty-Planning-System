/**
 * Hourly cargo rates for Operations load lines on one calendar day (Mgmt flow evidence).
 */
import { useEffect, useMemo, useState } from 'react'
import { fetchActivityTimeline, fetchCargoSegmentHourly } from '../../api/operations.js'
import { formatDailyRateDateLabel } from '../../utils/cargoDailyRates.js'
import { mapCargoSegmentHourlyResponse } from '../../utils/cargoSegmentHourlyHelpers.js'
import { formatDateTimeDisplay } from '../../utils/formatDateTimeDisplay.js'
import { formatHourlyRangeDisplay } from '../../utils/hourlyCargoDisplay.js'
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

function lineWindowLabel(line) {
  const start = line?.startedAt || line?.startAt
  const end = line?.endedAt || line?.endAt
  if (!start) return '—'
  const a = formatDateTimeDisplay(start)
  const b = end ? formatDateTimeDisplay(end) : 'In progress'
  return `${a} → ${b}`
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
    <div className="mgmt-product-metric-evidence__day-detail">
      <p className="mgmt-product-metric-evidence__section-title">
        Cargo entries · {dateLabel || dateKey}
      </p>
      {entries.map((entry) => (
        <div key={entry.key} className="mgmt-product-metric-evidence__entry-block">
          <p className="mgmt-product-metric-evidence__entry-head">
            <strong>{entry.label}</strong>
            <span className="text-steel"> · {entry.window}</span>
          </p>
          {entry.fetchError ? (
            <p className="mgmt-product-metric-evidence__warn">{entry.fetchError}</p>
          ) : null}
          {entry.hours.length === 0 ? (
            <p className="text-steel mgmt-product-metric-evidence__note">No logged hours on this date.</p>
          ) : (
            <table className="mgmt-product-metric-evidence__kv mgmt-product-metric-evidence__kv--grid">
              <thead>
                <tr>
                  <th scope="col">Hour</th>
                  <th scope="col" className="mgmt-product-metric-evidence__num">
                    MT moved
                  </th>
                  <th scope="col" className="mgmt-product-metric-evidence__num">
                    MT/h
                  </th>
                </tr>
              </thead>
              <tbody>
                {entry.hours.map((b) => {
                  const hourStart = b.hourStart || b.hour_start
                  const hourEnd = b.hourEnd || b.hour_end
                  const range = formatHourlyRangeDisplay(hourStart, hourEnd, {
                    timeZone: MGMT_DASHBOARD_TIMEZONE,
                    locale: 'en-GB',
                  })
                  return (
                    <tr key={hourStart}>
                      <td>{range}</td>
                      <td className="mgmt-product-metric-evidence__num">{fmtNum(bucketQtyMoved(b), 0)}</td>
                      <td className="mgmt-product-metric-evidence__num">{fmtNum(bucketRateTph(b))}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </div>
  )
}
