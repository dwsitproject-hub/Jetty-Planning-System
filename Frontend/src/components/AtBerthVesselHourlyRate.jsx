import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchOperationalProgress } from '../api/operations'
import HourlyCargoProgressTable from './HourlyCargoProgressTable'
import AtBerthHourlyRateChart from './AtBerthHourlyRateChart'

/**
 * Lazy-load hourly MT/h for one at-berth operation when the detail row is expanded.
 */
export default function AtBerthVesselHourlyRate({ operationId, purpose = null, vesselName = null, jettyName = null }) {
  const { t } = useTranslation('atBerth')
  const [progress, setProgress] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!operationId) return undefined
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetchOperationalProgress(operationId)
        if (!cancelled) setProgress(res)
      } catch (e) {
        if (!cancelled) setError(e?.message || t('flowPatternError'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [operationId, t])

  const buckets = progress?.hourlyBuckets || []
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, loading: null, unloading: null }))
  for (const b of buckets) {
    const start = b.hourStart || b.hour_start
    if (!start) continue
    const h = new Date(start).getHours()
    if (!Number.isFinite(h)) continue
    const rate = Number(b.displayRateTph ?? b.rateTph)
    if (!Number.isFinite(rate)) continue
    if (purpose === 'Unloading') hours[h].unloading = rate
    else hours[h].loading = rate
  }

  return (
    <div className="at-berth-vessel-rate">
      <h4 className="at-berth-vessel-rate__title">{t('flowPatternVesselTitle')}</h4>
      {loading ? <p className="text-steel">{t('loading')}</p> : null}
      {error ? <p className="at-berth-flow__error">{error}</p> : null}
      {!loading && !error && buckets.length === 0 ? (
        <p className="text-steel">{t('flowPatternVesselEmpty')}</p>
      ) : null}
      {!loading && buckets.length > 0 ? (
        <>
          <AtBerthHourlyRateChart hours={hours} />
          <HourlyCargoProgressTable
            hourlyBuckets={buckets}
            unit={progress?.siMetric || 'MT'}
            purpose={purpose || progress?.purpose}
            compact
            collapsible
            collapsedRowLimit={6}
            vesselName={vesselName}
            jettyName={jettyName}
          />
        </>
      ) : null}
    </div>
  )
}
