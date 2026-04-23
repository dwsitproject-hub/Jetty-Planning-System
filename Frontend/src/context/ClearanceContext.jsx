import { createContext, useContext, useState, useCallback } from 'react'

const ClearanceContext = createContext(null)

export function ClearanceProvider({ children }) {
  const [clearanceByVesselId, setClearanceByVesselId] = useState({})

  const getClearance = useCallback((vesselId) => {
    return clearanceByVesselId[vesselId] ?? null
  }, [clearanceByVesselId])

  const setClearance = useCallback((vesselId, data) => {
    setClearanceByVesselId((prev) => ({
      ...prev,
      [vesselId]: {
        ...(prev[vesselId] ?? {}),
        ...data,
      },
    }))
  }, [])

  const value = {
    clearanceByVesselId,
    getClearance,
    setClearance,
  }
  return <ClearanceContext.Provider value={value}>{children}</ClearanceContext.Provider>
}

export function useClearance() {
  const ctx = useContext(ClearanceContext)
  if (!ctx) {
    return {
      clearanceByVesselId: {},
      getClearance: () => null,
      setClearance: () => {},
    }
  }
  return ctx
}
