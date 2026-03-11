import { createContext, useContext, useState, useCallback } from 'react'
import { initialLoadingStepsByVesselId, initialLoadingOperationByVesselId } from '../data/mockData'

const defaultSteps = () =>
  Object.fromEntries(
    Object.entries(initialLoadingStepsByVesselId).map(([id, steps]) => [id, { ...steps }])
  )

const defaultLoadingOps = () =>
  Object.fromEntries(
    Object.entries(initialLoadingOperationByVesselId).map(([id, op]) => [
      id,
      { activities: (op.activities || []).map((a) => ({ ...a })) },
    ])
  )

const LoadingContext = createContext(null)

export function LoadingProvider({ children }) {
  const [stepsByVesselId, setStepsByVesselId] = useState(defaultSteps)
  const [loadingOpsByVesselId, setLoadingOpsByVesselId] = useState(defaultLoadingOps)

  const getSteps = useCallback((vesselId) => {
    return stepsByVesselId[vesselId] ?? initialLoadingStepsByVesselId[vesselId] ?? null
  }, [stepsByVesselId])

  const setStepData = useCallback((vesselId, stepId, data) => {
    setStepsByVesselId((prev) => {
      const vesselSteps = prev[vesselId] ?? {}
      const step = vesselSteps[stepId] ?? { status: 'not_started', startTime: '', endTime: '', quantityResult: null, documents: [] }
      return {
        ...prev,
        [vesselId]: {
          ...vesselSteps,
          [stepId]: { ...step, ...data },
        },
      }
    })
  }, [])

  const getLoadingOperation = useCallback((vesselId) => {
    return (
      loadingOpsByVesselId[vesselId] ??
      initialLoadingOperationByVesselId[vesselId] ?? { activities: [] }
    )
  }, [loadingOpsByVesselId])

  const addLoadingActivity = useCallback((vesselId, activity) => {
    const id = activity.id || `act-${Date.now()}`
    const entry = { id, category: activity.category, description: activity.description || '', startTime: activity.startTime || null, endTime: activity.endTime || null }
    setLoadingOpsByVesselId((prev) => {
      const op = prev[vesselId] ?? { activities: [] }
      const activities = [...(op.activities || []), entry].sort((a, b) => new Date(a.startTime || 0) - new Date(b.startTime || 0))
      return { ...prev, [vesselId]: { ...op, activities } }
    })
  }, [])

  const updateLoadingActivity = useCallback((vesselId, activityId, updates) => {
    setLoadingOpsByVesselId((prev) => {
      const op = prev[vesselId] ?? { activities: [] }
      const activities = (op.activities || []).map((a) =>
        a.id === activityId ? { ...a, ...updates } : a
      ).sort((a, b) => new Date(a.startTime || 0) - new Date(b.startTime || 0))
      return { ...prev, [vesselId]: { ...op, activities } }
    })
  }, [])

  const deleteLoadingActivity = useCallback((vesselId, activityId) => {
    setLoadingOpsByVesselId((prev) => {
      const op = prev[vesselId] ?? { activities: [] }
      const activities = (op.activities || []).filter((a) => a.id !== activityId)
      return { ...prev, [vesselId]: { ...op, activities } }
    })
  }, [])

  const value = {
    getSteps,
    setStepData,
    stepsByVesselId,
    getLoadingOperation,
    addLoadingActivity,
    updateLoadingActivity,
    deleteLoadingActivity,
  }
  return <LoadingContext.Provider value={value}>{children}</LoadingContext.Provider>
}

export function useLoading() {
  const ctx = useContext(LoadingContext)
  if (!ctx)
    return {
      getSteps: () => null,
      setStepData: () => {},
      stepsByVesselId: {},
      getLoadingOperation: () => ({ activities: [] }),
      addLoadingActivity: () => {},
      updateLoadingActivity: () => {},
      deleteLoadingActivity: () => {},
    }
  return ctx
}

/** Derive high-level phase index (3=Survey & QC, 4=Loading, 5=Final QC, 6=Clearance) from step status for Active Vessel stepper */
export function getLoadingPhaseIndex(steps) {
  if (!steps) return 3
  const completed = (id) => steps[id]?.status === 'completed'
  if (!completed('A1') || !completed('A2') || !completed('A3')) return 3
  if (!completed('B')) return 4
  if (!completed('C1') || !completed('C2')) return 5
  return 6
}
