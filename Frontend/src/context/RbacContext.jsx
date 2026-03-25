import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { apiGet } from '../api/client'
import { getToken } from '../api/auth'

const RbacContext = createContext({
  loading: true,
  error: null,
  pagePerms: {},
  refresh: async () => {},
  canView: () => true,
  canEdit: () => false,
  canDelete: () => false,
})

export function RbacProvider({ children }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [pagePerms, setPagePerms] = useState({})

  const refresh = useCallback(async () => {
    const token = getToken()
    if (!token) {
      setPagePerms({})
      setError(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const rows = await apiGet('/rbac/me/page-permissions')
      const map = {}
      for (const r of Array.isArray(rows) ? rows : []) {
        map[r.resourceKey] = { canView: !!r.canView, canEdit: !!r.canEdit, canDelete: !!r.canDelete }
      }
      setPagePerms(map)
    } catch (e) {
      setError(e?.message || 'Failed to load permissions')
      setPagePerms({})
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const canView = useCallback((pageKey) => {
    if (!getToken()) return pageKey === 'login'
    if (!pageKey) return true
    return pagePerms[pageKey]?.canView === true
  }, [pagePerms])

  const canEdit = useCallback((pageKey) => pagePerms[pageKey]?.canEdit === true, [pagePerms])
  const canDelete = useCallback((pageKey) => pagePerms[pageKey]?.canDelete === true, [pagePerms])

  const value = useMemo(
    () => ({ loading, error, pagePerms, refresh, canView, canEdit, canDelete }),
    [loading, error, pagePerms, refresh, canView, canEdit, canDelete]
  )

  return <RbacContext.Provider value={value}>{children}</RbacContext.Provider>
}

export function useRbac() {
  return useContext(RbacContext)
}

