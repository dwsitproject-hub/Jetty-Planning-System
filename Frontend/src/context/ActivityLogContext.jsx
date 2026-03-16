import { createContext, useContext, useState, useCallback } from 'react'

const ActivityLogContext = createContext(null)

const DEFAULT_USER = 'Current user'

/**
 * Activities are stored with a pageKey so each page only shows its own log.
 * action: 'add' | 'update' | 'delete'
 */
export function ActivityLogProvider({ children }) {
  const [activities, setActivities] = useState([])

  const logActivity = useCallback(({ pageKey, action, entityType, entityLabel, details = '' }) => {
    const entry = {
      id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      pageKey,
      action,
      entityType: entityType || '',
      entityLabel: entityLabel || '',
      details: typeof details === 'string' ? details : JSON.stringify(details),
      user: DEFAULT_USER,
      timestamp: new Date().toISOString(),
    }
    setActivities((prev) => [entry, ...prev].slice(0, 500))
  }, [])

  const getActivitiesForPage = useCallback((pageKey) => {
    return activities.filter((a) => a.pageKey === pageKey)
  }, [activities])

  const value = { logActivity, getActivitiesForPage }
  return <ActivityLogContext.Provider value={value}>{children}</ActivityLogContext.Provider>
}

export function useActivityLog() {
  const ctx = useContext(ActivityLogContext)
  if (!ctx) {
    return {
      logActivity: () => {},
      getActivitiesForPage: () => [],
    }
  }
  return ctx
}
