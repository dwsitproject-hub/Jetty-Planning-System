import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchActivityTimeline, fetchOperationalProgress } from '../api/operations'
import CargoDischargeProgressChart from './CargoDischargeProgressChart'
import HourlyCargoProgressTable from './HourlyCargoProgressTable'
import OperationActivityTimeline from './OperationActivityTimeline'
import CargoScheduleProgressIndicator from './CargoScheduleProgressIndicator'
import { parseQtyDisplay } from '../utils/cargoQtyDisplay'
import { buildLiveCargoProgressSnapshot, findOpenCargoLoadLine } from '../utils/cargoSessionHelpers'
import { operationalProgressPayloadChanged } from '../utils/snapshotChanged'

const POLL_MS = 30_000

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
  const [initialLoading, setInitialLoading] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState(null)
  const [refreshToken, setRefreshToken] = useState(0)
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false)

  const eventsRef = useRef(events)
  const progressRef = useRef(progress)
  eventsRef.current = events
  progressRef.current = progress

  const bumpRefresh = useCallback(() => {
    setRefreshToken((n) => n + 1)
  }, [])

  useEffect(() => {
    if (!operationId) {
      setEvents([])
      setProgress(null)
      setError(null)
      setInitialLoading(false)
      setIsRefreshing(false)
      setHasLoadedOnce(false)
      return undefined
    }

    let cancelled = false
    let pollId = null

    const applyPayload = (timelineRes, progressRes, { silent }) => {
      const nextEvents = Array.isArray(timelineRes?.events) ? timelineRes.events : []
      const nextProgress = progressRes || null

      setHasLoadedOnce(true)
      if (!silent) setError(null)

      if (
        !operationalProgressPayloadChanged(
          eventsRef.current,
          nextEvents,
          progressRef.current,
          nextProgress
        )
      ) {
        return
      }

      setEvents(nextEvents)
      setProgress(nextProgress)
    }

    const load = ({ silent = false } = {}) => {
      if (cancelled) return

      if (!silent) {
        const hasCached = eventsRef.current.length > 0 || progressRef.current != null
        if (!hasCached) {
          setInitialLoading(true)
        }
        setError(null)
      } else {
        setIsRefreshing(true)
      }

      Promise.all([fetchActivityTimeline(operationId), fetchOperationalProgress(operationId)])
        .then(([timelineRes, progressRes]) => {
          if (cancelled) return
          applyPayload(timelineRes, progressRes, { silent })
        })
        .catch((e) => {
          if (cancelled) return
          const hasCached = eventsRef.current.length > 0 || progressRef.current != null
          if (!silent && !hasCached) {
            setEvents([])
            setProgress(null)
            setError(e?.message || 'Failed to load operational data')
          }
        })
        .finally(() => {
          if (cancelled) return
          setInitialLoading(false)
          setIsRefreshing(false)
        })
    }

    const startPoll = () => {
      if (pollId != null) window.clearInterval(pollId)
      pollId = window.setInterval(() => load({ silent: true }), POLL_MS)
    }

    const stopPoll = () => {
      if (pollId != null) {
        window.clearInterval(pollId)
        pollId = null
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        stopPoll()
        return
      }
      load({ silent: true })
      startPoll()
    }

    load({ silent: false })
    startPoll()
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      stopPoll()
      document.removeEventListener('visibilitychange', onVisibility)
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
      const open = findOpenCargoLoadLine(ev.cargoLoadLines)
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

  const showInitialSpinner = initialLoading && !events.length && !progress
  const showContent = hasLoadedOnce || events.length > 0 || progress != null

  return (
    <section
      className={[
        'berthing-modal__card',
        'operational-progress-section',
        isRefreshing ? 'operational-progress-section--refreshing' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <h3 className="berthing-modal__card-title">
        Operational progress
        {isRefreshing ? (
          <span className="operational-progress-section__refresh-hint" aria-live="polite">
            Updating…
          </span>
        ) : null}
      </h3>

      {showInitialSpinner ? (
        <p className="text-steel">Loading operational data…</p>
      ) : null}
      {error ? (
        <p className="text-steel" style={{ color: 'var(--danger-600, #c00)' }}>
          {error}
        </p>
      ) : null}

      {showContent && !error ? (
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
            loadingOverride={initialLoading}
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
