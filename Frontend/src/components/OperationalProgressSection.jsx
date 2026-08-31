import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchActivityTimeline, fetchOperationalProgress } from '../api/operations'
import CargoDischargeProgressChart from './CargoDischargeProgressChart'
import HourlyCargoProgressTable from './HourlyCargoProgressTable'
import OperationActivityTimeline from './OperationActivityTimeline'
import CargoScheduleProgressIndicator from './CargoScheduleProgressIndicator'
import { parseQtyDisplay } from '../utils/cargoQtyDisplay'
import { buildLiveCargoProgressSnapshot } from '../utils/cargoSessionHelpers'

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
  jettyName = null,
  vesselName = null,
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
    let cancelled = false
    const load = () => {
      setLoading(true)
      setError(null)
      Promise.all([fetchActivityTimeline(operationId), fetchOperationalProgress(operationId)])
        .then(([timelineRes, progressRes]) => {
          if (cancelled) return
          setEvents(Array.isArray(timelineRes?.events) ? timelineRes.events : [])
          setProgress(progressRes || null)
        })
        .catch((e) => {
          if (cancelled) return
          setEvents([])
          setProgress(null)
          setError(e?.message || 'Failed to load operational data')
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }
    load()
    const pollId = window.setInterval(load, 30000)
    return () => {
      cancelled = true
      window.clearInterval(pollId)
    }
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
  const hourlyBuckets = useMemo(
    () => (Array.isArray(progress?.hourlyBuckets) ? progress.hourlyBuckets : []),
    [progress]
  )

  const liveCargoProgress = useMemo(() => {
    let openLoadLineId = null
    for (const ev of events) {
      if (ev.source !== 'operational_activity') continue
      const lines = ev.cargoLoadLines
      if (!Array.isArray(lines)) continue
      const open = lines.find((l) => l.startAt && !l.endAt && l.id != null)
      if (open?.id) {
        openLoadLineId = String(open.id)
        break
      }
    }
    return buildLiveCargoProgressSnapshot({
      openLoadLineId,
      openLineDraft: null,
      atgRef: null,
      sessionOperationalProgress: progress,
      tankMetaById: null,
      activityRows: events
        .filter((ev) => ev.source === 'operational_activity')
        .map((ev) => ({ cargoLoadLines: ev.cargoLoadLines || [] })),
    })
  }, [events, progress])

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
            movedQty={progress?.movedQty ?? scheduleComparison?.movedQty ?? null}
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
              {rateSummary.currentHourLine || rateSummary.hourlyLine || rateSummary.dailyLine ? (
                <span className="operational-progress-section__summary-item operational-progress-section__summary-rates">
                  {[rateSummary.currentHourLine || rateSummary.hourlyLine, rateSummary.lastActiveHourLine, rateSummary.dailyLine]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              ) : null}
            </div>
          )}

          <HourlyCargoProgressTable
            hourlyBuckets={hourlyBuckets}
            unit={cargoSiMetricLabel ?? 'MT'}
            purpose={progress?.purpose ?? null}
            currentHourLine={rateSummary.currentHourLine ?? null}
            collapsible
            collapsedRowLimit={6}
            jettyName={jettyName}
            vesselName={vesselName}
            exportable
          />

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
            liveCargoProgress={liveCargoProgress}
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
