import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchAtBerthFlowPattern } from '../api/operations'
import AtBerthHourlyRateChart from './AtBerthHourlyRateChart'

export default function AtBerthFlowPatternPanel() {
  const { t } = useTranslation('atBerth')
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetchAtBerthFlowPattern(14)
        if (!cancelled) setData(res)
      } catch (e) {
        if (!cancelled) setError(e?.message || t('flowPatternError'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [t])

  return (
    <section className="at-berth-flow card" aria-label={t('flowPatternTitle')}>
      <div className="at-berth-flow__header">
        <div className="at-berth-flow__heading">
          <h2 className="card__title">{t('flowPatternTitle')}</h2>
          <p className="at-berth-flow__sub text-steel" title={t('flowPatternHint')}>{t('flowPatternHint')}</p>
        </div>
        {!loading && !error && data?.insight ? (
          <p className="at-berth-flow__insight">{data.insight}</p>
        ) : null}
      </div>
      {loading ? <p className="text-steel">{t('loading')}</p> : null}
      {error ? <p className="at-berth-flow__error">{error}</p> : null}
      {!loading && !error && data ? (
        <AtBerthHourlyRateChart
          hours={data.hours || []}
          loadingStandard={data.standards?.loading}
          unloadingStandard={data.standards?.unloading}
        />
      ) : null}
    </section>
  )
}
