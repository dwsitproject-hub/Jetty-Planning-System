import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchActivityTimeline } from '../api/operations'
import CargoDischargeProgressChart from './CargoDischargeProgressChart'
import OperationActivityTimeline from './OperationActivityTimeline'
import {
  buildCumulativeSeriesFromLoadLines,
  buildDailyBarsFromLoadLines,
  buildOperationalRateSummary,
  extractCargoLoadLinesFromTimeline,
} from '../utils/cargoDailyRates'
import { parseQtyDisplay } from '../utils/cargoQtyDisplay'

/**
 * Operational progress block for Active Vessel Detail (rates, chart, Operational activity log).
 */
export default function OperationalProgressSection({
  operationId,
  totalQtyDisplay = null,
  vesselId = null,
  basePath = null,
  scheduleTimezone = 'Asia/Jakarta',
  refreshToken: refreshTokenProp = 0,
}) {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [refreshToken, setRefreshToken] = useState(0)

  const bumpRefresh = useCallback(() => {
    setRefreshToken((n) => n + 1)
  }, [])

  useEffect(() => {
    if (!operationId) {
      setEvents([])
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    fetchActivityTimeline(operationId)
      .then((res) => {
        setEvents(Array.isArray(res?.events) ? res.events : [])
      })
      .catch((e) => {
        setEvents([])
        setError(e?.message || 'Failed to load activity timeline')
      })
      .finally(() => setLoading(false))
  }, [operationId, refreshToken, refreshTokenProp])

  const loadLines = useMemo(() => extractCargoLoadLinesFromTimeline(events), [events])
  const dailyBars = useMemo(
    () => buildDailyBarsFromLoadLines(loadLines, scheduleTimezone),
    [loadLines, scheduleTimezone]
  )
  const cumulativeSeries = useMemo(
    () => buildCumulativeSeriesFromLoadLines(loadLines, scheduleTimezone),
    [loadLines, scheduleTimezone]
  )
  const parsedQty = useMemo(() => parseQtyDisplay(totalQtyDisplay), [totalQtyDisplay])
  const rateSummary = useMemo(
    () =>
      buildOperationalRateSummary({
        totalQtyDisplay,
        loadLines,
        dailyBars,
        nowMs: Date.now(),
        timezone: scheduleTimezone,
      }),
    [totalQtyDisplay, loadLines, dailyBars, scheduleTimezone]
  )

  const cargoSiQty = parsedQty?.total ?? null
  const cargoSiMetricLabel = parsedQty?.unit ?? null

  return (
    <section className="berthing-modal__card operational-progress-section">
      <h3 className="berthing-modal__card-title">Operational progress</h3>

      {loading && !events.length ? <p className="text-steel">Loading operational data…</p> : null}
      {error ? (
        <p className="text-steel" style={{ color: 'var(--danger-600, #c00)' }}>
          {error}
        </p>
      ) : null}

      {!loading && !error ? (
        <>
          {(rateSummary.movedLine || rateSummary.hourlyLine || rateSummary.dailyLine) && (
            <div className="operational-progress-section__summary">
              {rateSummary.movedLine ? (
                <span className="operational-progress-section__summary-item">{rateSummary.movedLine}</span>
              ) : null}
              {rateSummary.balanceLine ? (
                <span className="operational-progress-section__summary-item operational-progress-section__summary-balance">
                  {rateSummary.balanceLine}
                </span>
              ) : null}
              {rateSummary.hourlyLine || rateSummary.dailyLine ? (
                <span className="operational-progress-section__summary-item operational-progress-section__summary-rates">
                  {[rateSummary.hourlyLine, rateSummary.dailyLine].filter(Boolean).join(' · ')}
                </span>
              ) : null}
            </div>
          )}

          <CargoDischargeProgressChart
            dailyBars={dailyBars}
            cumulativeSeries={cumulativeSeries}
            totalQty={parsedQty?.total ?? null}
            unit={parsedQty?.unit ?? 'MT'}
            timezone={scheduleTimezone}
          />

          <h4 className="operational-progress-section__activity-title">Operational activity</h4>
          <OperationActivityTimeline
            operationId={operationId}
            eventsOverride={events}
            loadingOverride={loading}
            errorOverride={error}
            refreshToken={refreshToken}
            vesselId={vesselId}
            basePath={basePath}
            onActivityLogRefresh={bumpRefresh}
            cargoSiQty={cargoSiQty}
            cargoSiMetricLabel={cargoSiMetricLabel}
            phaseFilter="Operational"
            title="Operational activity"
            hidePhaseColumn
            embedded
            className="operational-progress-section__timeline"
          />
        </>
      ) : null}
    </section>
  )
}
