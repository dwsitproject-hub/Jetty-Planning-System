import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchActivityTimeline, fetchOperationalProgress } from '../api/operations'
import CargoDischargeProgressChart from './CargoDischargeProgressChart'
import OperationActivityTimeline from './OperationActivityTimeline'
import CargoScheduleProgressIndicator from './CargoScheduleProgressIndicator'
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
  const [progress, setProgress] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [refreshToken, setRefreshToken] = useState(0)

  const bumpRefresh = useCallback(() => {
    setRefreshToken((n) => n + 1)
  }, [])

  useEffect(() => {
    if (!operationId) {
      setEvents([])
      setProgress(null)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    Promise.all([fetchActivityTimeline(operationId), fetchOperationalProgress(operationId)])
      .then(([timelineRes, progressRes]) => {
        setEvents(Array.isArray(timelineRes?.events) ? timelineRes.events : [])
        setProgress(progressRes || null)
      })
      .catch((e) => {
        setEvents([])
        setProgress(null)
        setError(e?.message || 'Failed to load operational data')
      })
      .finally(() => setLoading(false))
  }, [operationId, refreshToken, refreshTokenProp])

  const dailyBars = useMemo(
    () => (Array.isArray(progress?.dailyBars) ? progress.dailyBars : []),
    [progress]
  )
  const cumulativeSeries = useMemo(() => {
    if (!Array.isArray(progress?.cumulativeSeries)) return []
    return progress.cumulativeSeries.map((p) => ({
      dateKey: p.date,
      cumulativeQty: p.cumulativeQty,
    }))
  }, [progress])
  const parsedQty = useMemo(() => parseQtyDisplay(totalQtyDisplay), [totalQtyDisplay])
  const rateSummary = progress?.rateSummary || {}
  const tz = progress?.scheduleTimezone || scheduleTimezone
  const scheduleComparison = progress?.scheduleComparison ?? null

  const cargoSiQty = progress?.siQty ?? parsedQty?.total ?? null
  const cargoSiMetricLabel = progress?.siMetric ?? parsedQty?.unit ?? null

  return (
    <section className="berthing-modal__card operational-progress-section">
      <h3 className="berthing-modal__card-title">Operational progress</h3>

      {loading && !events.length && !progress ? (
        <p className="text-steel">Loading operational data…</p>
      ) : null}
      {error ? (
        <p className="text-steel" style={{ color: 'var(--danger-600, #c00)' }}>
          {error}
        </p>
      ) : null}

      {!loading && !error ? (
        <>
          {Array.isArray(progress?.warnings) && progress.warnings.length > 0 ? (
            <p className="operational-progress-section__warning text-steel">{progress.warnings.join(' · ')}</p>
          ) : null}

          <CargoScheduleProgressIndicator
            mode="full"
            comparison={scheduleComparison}
            movedQty={scheduleComparison?.movedQty ?? null}
            siQty={scheduleComparison?.siQty ?? cargoSiQty}
            siMetric={scheduleComparison?.siMetric ?? cargoSiMetricLabel}
            sourceLabel={progress?.source ? String(progress.source).toUpperCase() : null}
          />

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
            totalQty={cargoSiQty}
            unit={cargoSiMetricLabel ?? 'MT'}
            timezone={tz}
            operationalDayStart={progress?.operationalDayStart || '06:00:00'}
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
