import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useParams, useSearchParams } from 'react-router-dom'
import JettySchematic from '../components/JettySchematic'
import JettyScheduleGantt from '../components/JettyScheduleGantt'
import ActiveVesselDetailModal from '../components/allocation/ActiveVesselDetailModal'
import ShipmentPlanCombinedFormModal from '../components/ShipmentPlanCombinedFormModal'
import { useRbac } from '../context/RbacContext'
import useAllocationVisualizationData from '../hooks/useAllocationVisualizationData'
import { buildRailRows } from '../utils/berthColorState'
import { usePortScope } from '../context/PortScopeContext'
import { parsePortIdParam, popoutModeToVizTab, withAllocationReturnParams } from '../utils/portScopeUrl.js'
import '../styles/allocation.css'

const VALID_MODES = new Set(['schematic', 'schedule'])

export default function AllocationVisualizationPopout() {
  const { mode } = useParams()
  const [searchParams] = useSearchParams()
  const { t } = useTranslation('allocation')

  const profile = searchParams.get('profile') === 'legacy' ? 'legacy' : 'plan'
  const portIdHint = parsePortIdParam(searchParams)
  const { setSelectedPortId } = usePortScope()

  useLayoutEffect(() => {
    if (portIdHint != null) {
      setSelectedPortId(portIdHint)
    }
  }, [portIdHint, setSelectedPortId])

  const {
    loading,
    error,
    isPlanCentric,
    selectedPort,
    planViz,
    list,
    scheduleList,
    vesselById,
    scheduleListLive,
    berthIds,
    berthsState,
    jetties,
    breachNowMs,
    reload,
  } = useAllocationVisualizationData(profile, portIdHint)

  // Same "Unallocated" rail as the Berthing Plan tab (plan profile only).
  const unallocatedRailRows = useMemo(
    () => (isPlanCentric && profile === 'plan' ? buildRailRows(scheduleListLive) : undefined),
    [isPlanCentric, profile, scheduleListLive]
  )

  // Vessel detail modal: same modal and same vessel resolution as the Allocation page, so a rail
  // card click behaves the same in the full view as in the normal view.
  const { canEdit } = useRbac()
  const canCreateShipmentPlan = isPlanCentric && canEdit('shipment-plan')
  const [vesselDetailId, setVesselDetailId] = useState(null)
  const [vesselDetailPlanId, setVesselDetailPlanId] = useState(null)
  const [createPlanOpen, setCreatePlanOpen] = useState(false)
  const [createPlanToast, setCreatePlanToast] = useState(null)

  const openCreatePlanModal = useCallback(() => setCreatePlanOpen(true), [])

  const closeVesselDetail = useCallback(() => {
    setVesselDetailId(null)
    setVesselDetailPlanId(null)
  }, [])

  const selectVessel = useCallback(
    (vesselId) => {
      if (!vesselId) return
      const isPlanKey = isPlanCentric && typeof vesselId === 'string' && vesselId.startsWith('plan-')
      let planId = null
      let resolved = vesselId
      if (isPlanKey) {
        const n = parseInt(String(vesselId).replace(/^plan-/i, ''), 10)
        planId = Number.isFinite(n) && n > 0 ? n : null
        if (planViz.planVesselToRepresentativeVesselId.has(vesselId)) {
          resolved = planViz.planVesselToRepresentativeVesselId.get(vesselId)
        }
        if (typeof resolved === 'string' && resolved.startsWith('plan-') && planId != null) {
          const sameRows = [...list, ...scheduleList]
          const fallback =
            sameRows.find((r) => Number(r?.shipmentPlanId) === planId && r?.operationId != null && r?.vesselId) ||
            sameRows.find((r) => Number(r?.shipmentPlanId) === planId && r?.vesselId)
          if (fallback?.vesselId) resolved = fallback.vesselId
        }
      } else {
        const directRow = [...list, ...scheduleList].find((r) => r.vesselId === vesselId)
        const pid = directRow?.shipmentPlanId != null ? Number(directRow.shipmentPlanId) : null
        if (pid != null && !Number.isNaN(pid)) planId = pid
      }
      setVesselDetailPlanId(planId)
      setVesselDetailId(resolved || vesselId)
    },
    [isPlanCentric, planViz, list, scheduleList]
  )

  useEffect(() => {
    document.documentElement.classList.add('allocation-viz-popout-open')
    return () => document.documentElement.classList.remove('allocation-viz-popout-open')
  }, [])

  const title = useMemo(() => {
    if (mode === 'schematic') {
      return t('jettySchematic', { defaultValue: 'Jetty schematic' })
    }
    return t('jettySchedule', { defaultValue: 'Berthing Plan' })
  }, [mode, t])

  const closeHint = t('vizPopoutCloseHint', { defaultValue: 'Close this window to return to Allocation' })

  if (!VALID_MODES.has(mode)) {
    return <Navigate to="/allocation-plans" replace />
  }

  const manageHref = withAllocationReturnParams('/allocation-plans', {
    portId: portIdHint,
    vizTab: popoutModeToVizTab(mode),
  })

  const handleManageClick = () => {
    if (window.opener && !window.opener.closed) {
      try {
        window.opener.focus()
        window.opener.location.href = manageHref
        window.close()
        return
      } catch {
        /* fall through */
      }
    }
    window.open(manageHref, '_blank', 'noreferrer')
  }

  const headerTitle = selectedPort?.name ? `${title} · ${selectedPort.name}` : title
  const isSchedule = mode === 'schedule'

  return (
    <div
      className={`allocation-viz-popout allocation-viz-popout--maximized${isSchedule ? ' allocation-viz-popout--schedule' : ''}`}
    >
      {!isSchedule ? (
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
      ) : null}

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
            onCreatePlan={canCreateShipmentPlan ? openCreatePlanModal : undefined}
          />
        ) : (
          <JettyScheduleGantt
            berthIds={berthIds}
            berthsState={berthsState}
            jetties={jetties}
            list={scheduleListLive}
            onScheduleChanged={reload}
            railRows={unallocatedRailRows}
            onSelectRailVessel={selectVessel}
            popoutProfile={profile}
            hidePopoutButton
            isPopout
            popoutTitle={headerTitle}
            closeHint={closeHint}
            onManage={handleManageClick}
            onCreatePlan={canCreateShipmentPlan ? openCreatePlanModal : undefined}
          />
        )}
      </main>

      {createPlanToast ? (
        <div
          className={`toast toast--${createPlanToast.variant}`}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <span className="toast__icon" aria-hidden>
            {createPlanToast.variant === 'warning' ? '!' : '✓'}
          </span>
          <p className="toast__message">{createPlanToast.text}</p>
          <button
            type="button"
            className="toast__close"
            onClick={() => setCreatePlanToast(null)}
            aria-label={t('dismissNotification', { defaultValue: 'Dismiss notification' })}
          >
            ×
          </button>
        </div>
      ) : null}

      <ShipmentPlanCombinedFormModal
        isOpen={createPlanOpen}
        mode="create"
        occupancyRows={list}
        onClose={() => setCreatePlanOpen(false)}
        onSaved={(result) => {
          if (result?.toast?.message) {
            setCreatePlanToast({
              text: result.toast.message,
              variant: result.toast.variant === 'warning' ? 'warning' : 'success',
            })
          }
          reload().catch(() => {})
        }}
      />

      {isSchedule && isPlanCentric ? (
        <ActiveVesselDetailModal
          vesselId={vesselDetailId}
          planId={vesselDetailPlanId}
          onClose={closeVesselDetail}
          isPlanCentric={isPlanCentric}
          canEditAllocation={canEdit('allocation-plan')}
          queueList={list}
          scheduleList={scheduleList}
          berthsState={berthsState}
          onRefreshOverview={reload}
          plannedBerthingPath="/allocation-plans"
          activityLogPage="allocation-plan"
        />
      ) : null}
    </div>
  )
}
