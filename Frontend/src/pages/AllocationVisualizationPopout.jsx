import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useParams, useSearchParams } from 'react-router-dom'
import JettySchematic from '../components/JettySchematic'
import JettyScheduleGantt from '../components/JettyScheduleGantt'
import useAllocationVisualizationData from '../hooks/useAllocationVisualizationData'
import '../styles/allocation.css'

const VALID_MODES = new Set(['schematic', 'schedule'])

export default function AllocationVisualizationPopout() {
  const { mode } = useParams()
  const [searchParams] = useSearchParams()
  const { t } = useTranslation('allocation')

  const profile = searchParams.get('profile') === 'legacy' ? 'legacy' : 'plan'

  const { loading, error, isPlanCentric, selectedPort, planViz, vesselById, berthIds, berthsState, jetties, breachNowMs, reload } =
    useAllocationVisualizationData(profile)

  useEffect(() => {
    document.documentElement.classList.add('allocation-viz-popout-open')
    return () => document.documentElement.classList.remove('allocation-viz-popout-open')
  }, [])

  const title = useMemo(() => {
    if (mode === 'schematic') {
      return t('jettySchematic', { defaultValue: 'Jetty schematic' })
    }
    return t('jettySchedule', { defaultValue: 'Jetty schedule' })
  }, [mode, t])

  const closeHint = t('vizPopoutCloseHint', { defaultValue: 'Close this window to return to Allocation' })

  if (!VALID_MODES.has(mode)) {
    return <Navigate to="/allocation-plans" replace />
  }

  const manageHref = '/allocation-plans'

  const handleManageClick = () => {
    if (window.opener && !window.opener.closed) {
      try {
        window.opener.focus()
        window.opener.location.href = manageHref
        return
      } catch {
        /* fall through */
      }
    }
    window.open(manageHref, '_blank', 'noopener,noreferrer')
  }

  const headerTitle = selectedPort?.name ? `${title} · ${selectedPort.name}` : title

  return (
    <div className="allocation-viz-popout allocation-viz-popout--maximized">
      <header
        className="allocation-viz-popout__header"
        title={closeHint}
      >
        <h1 className="allocation-viz-popout__title">{headerTitle}</h1>
        <span className="allocation-viz-popout__hint-inline" aria-hidden>
          · {closeHint}
        </span>
        <button type="button" className="btn btn--secondary btn--small" onClick={handleManageClick}>
          {t('vizPopoutManageInAllocation', { defaultValue: 'Manage in Allocation' })}
        </button>
      </header>

      <main className="allocation-viz-popout__body">
        {loading ? (
          <p className="allocation-viz-popout__status" role="status">
            Loading…
          </p>
        ) : error ? (
          <p className="allocation-viz-popout__status allocation-viz-popout__status--error" role="alert">
            {error}
          </p>
        ) : mode === 'schematic' ? (
          <JettySchematic
            berths={planViz.mergedBerths}
            scheduleList={planViz.mergedSchedule}
            viewAsOfMs={breachNowMs}
            vesselById={vesselById}
            popoutProfile={profile}
            hidePopoutButton
            isPopout
          />
        ) : (
          <JettyScheduleGantt
            berthIds={berthIds}
            berthsState={berthsState}
            jetties={jetties}
            list={planViz.mergedSchedule}
            onScheduleChanged={reload}
            popoutProfile={profile}
            hidePopoutButton
            isPopout
          />
        )}
      </main>
    </div>
  )
}
