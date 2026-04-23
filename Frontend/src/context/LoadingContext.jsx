import { createContext, useContext, useState, useCallback } from 'react'
import { initialLoadingStepsByVesselId, initialLoadingOperationByVesselId, defaultPreCheckingSection, defaultPostCheckingSection } from '../data/mockData'

const defaultSteps = () =>
  Object.fromEntries(
    Object.entries(initialLoadingStepsByVesselId).map(([id, steps]) => [id, { ...steps }])
  )

const defaultLoadingOps = () =>
  Object.fromEntries(
    Object.entries(initialLoadingOperationByVesselId).map(([id, op]) => [
      id,
      {
        activities: (op.activities || []).map((a) => ({ ...a })),
        milestoneNa: op.milestoneNa && typeof op.milestoneNa === 'object' ? { ...op.milestoneNa } : {},
      },
    ])
  )

const LoadingContext = createContext(null)

export function LoadingProvider({ children }) {
  const [stepsByVesselId, setStepsByVesselId] = useState(defaultSteps)
  const [loadingOpsByVesselId, setLoadingOpsByVesselId] = useState(defaultLoadingOps)
  const [preCheckingByVesselId, setPreCheckingByVesselId] = useState({})
  const [postCheckingByVesselId, setPostCheckingByVesselId] = useState({})

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
    const raw =
      loadingOpsByVesselId[vesselId] ?? initialLoadingOperationByVesselId[vesselId] ?? { activities: [] }
    return {
      activities: raw.activities || [],
      milestoneNa: raw.milestoneNa && typeof raw.milestoneNa === 'object' ? raw.milestoneNa : {},
    }
  }, [loadingOpsByVesselId])

  const addLoadingActivity = useCallback((vesselId, activity) => {
    const id = activity.id || `act-${Date.now()}`
    const entry = {
      id,
      category: activity.category,
      description: activity.description || '',
      subStepTitle: activity.subStepTitle || '',
      startTime: activity.startTime || null,
      endTime: activity.endTime || null,
    }
    setLoadingOpsByVesselId((prev) => {
      const op = prev[vesselId] ?? { activities: [], milestoneNa: {} }
      const milestoneNa = { ...(op.milestoneNa || {}) }
      if (entry.category && milestoneNa[entry.category]) delete milestoneNa[entry.category]
      const activities = [...(op.activities || []), entry].sort((a, b) => new Date(a.startTime || 0) - new Date(b.startTime || 0))
      return { ...prev, [vesselId]: { ...op, activities, milestoneNa } }
    })
  }, [])

  const updateLoadingActivity = useCallback((vesselId, activityId, updates) => {
    setLoadingOpsByVesselId((prev) => {
      const op = prev[vesselId] ?? { activities: [], milestoneNa: {} }
      const milestoneNa = { ...(op.milestoneNa || {}) }
      const nextCat = updates.category
      if (nextCat && milestoneNa[nextCat]) delete milestoneNa[nextCat]
      const activities = (op.activities || [])
        .map((a) => (a.id === activityId ? { ...a, ...updates } : a))
        .sort((a, b) => new Date(a.startTime || 0) - new Date(b.startTime || 0))
      return { ...prev, [vesselId]: { ...op, activities, milestoneNa } }
    })
  }, [])

  const deleteLoadingActivity = useCallback((vesselId, activityId) => {
    setLoadingOpsByVesselId((prev) => {
      const op = prev[vesselId] ?? { activities: [], milestoneNa: {} }
      const activities = (op.activities || []).filter((a) => a.id !== activityId)
      return { ...prev, [vesselId]: { ...op, activities } }
    })
  }, [])

  const setOperationalMilestoneNa = useCallback((vesselId, category, payload) => {
    setLoadingOpsByVesselId((prev) => {
      const op = prev[vesselId] ?? { activities: [], milestoneNa: {} }
      const milestoneNa = { ...(op.milestoneNa || {}) }
      const reason = payload && String(payload.reason || '').trim()
      if (!reason) delete milestoneNa[category]
      else milestoneNa[category] = { reason, markedAt: new Date().toISOString() }
      return { ...prev, [vesselId]: { ...op, milestoneNa } }
    })
  }, [])

  const getPreChecking = useCallback((vesselId) => {
    return preCheckingByVesselId[vesselId] ?? defaultPreCheckingSection()
  }, [preCheckingByVesselId])

  const setPreCheckingSection = useCallback((vesselId, sectionKey, data) => {
    setPreCheckingByVesselId((prev) => {
      const current = prev[vesselId] ?? defaultPreCheckingSection()
      return {
        ...prev,
        [vesselId]: { ...current, [sectionKey]: { ...(current[sectionKey] ?? {}), ...data } },
      }
    })
  }, [])

  const getPostChecking = useCallback((vesselId) => {
    return postCheckingByVesselId[vesselId] ?? defaultPostCheckingSection()
  }, [postCheckingByVesselId])

  const setPostCheckingSection = useCallback((vesselId, sectionKey, data) => {
    setPostCheckingByVesselId((prev) => {
      const current = prev[vesselId] ?? defaultPostCheckingSection()
      return {
        ...prev,
        [vesselId]: { ...current, [sectionKey]: { ...(current[sectionKey] ?? {}), ...data } },
      }
    })
  }, [])

  const value = {
    getSteps,
    setStepData,
    stepsByVesselId,
    loadingOpsByVesselId,
    getLoadingOperation,
    addLoadingActivity,
    updateLoadingActivity,
    deleteLoadingActivity,
    setOperationalMilestoneNa,
    getPreChecking,
    setPreCheckingSection,
    getPostChecking,
    setPostCheckingSection,
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
      loadingOpsByVesselId: {},
      getLoadingOperation: () => ({ activities: [], milestoneNa: {} }),
      addLoadingActivity: () => {},
      updateLoadingActivity: () => {},
      deleteLoadingActivity: () => {},
      setOperationalMilestoneNa: () => {},
      getPreChecking: () => defaultPreCheckingSection(),
      setPreCheckingSection: () => {},
      getPostChecking: () => defaultPostCheckingSection(),
      setPostCheckingSection: () => {},
    }
  return ctx
}

/** Derive high-level phase index (3=Pre Checking, 4=Operational, 5=Post Checking, 6=Clearance) from step status for Active Vessel stepper */
export function getLoadingPhaseIndex(steps) {
  if (!steps) return 3
  const completed = (id) => steps[id]?.status === 'completed'
  if (!completed('A1') || !completed('A2') || !completed('A3')) return 3
  if (!completed('B')) return 4
  if (!completed('C1') || !completed('C2')) return 5
  return 6
}
