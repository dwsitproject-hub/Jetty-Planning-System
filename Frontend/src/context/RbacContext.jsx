import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { apiGet } from '../api/client'
import { useAuth } from './AuthContext'

const RbacContext = createContext({
  loading: true,
  error: null,
  pagePerms: {},
  refresh: async () => {},
  canView: () => true,
  canEdit: () => false,
  canDelete: () => false,
  canApprove: () => false,
})

export function RbacProvider({ children }) {
  const { me } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [pagePerms, setPagePerms] = useState({})

  const refresh = useCallback(async () => {
    if (!me) {
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
        map[r.resourceKey] = {
          canView: !!r.canView,
          canEdit: !!r.canEdit,
          canDelete: !!r.canDelete,
          canApprove: !!r.canApprove,
        }
      }
      setPagePerms(map)
    } catch (e) {
      setError(e?.message || 'Failed to load permissions')
      setPagePerms({})
    } finally {
      setLoading(false)
    }
  }, [me])

  useEffect(() => {
    refresh()
  }, [refresh])

  const canView = useCallback(
    (pageKey) => {
      if (pageKey === 'login') return true
      if (!me) return false
      if (!pageKey) return true
      return pagePerms[pageKey]?.canView === true
    },
    [me, pagePerms]
  )

  const canEdit = useCallback((pageKey) => pagePerms[pageKey]?.canEdit === true, [pagePerms])
  const canDelete = useCallback((pageKey) => pagePerms[pageKey]?.canDelete === true, [pagePerms])
  const canApprove = useCallback((pageKey) => pagePerms[pageKey]?.canApprove === true, [pagePerms])

  const value = useMemo(
    () => ({ loading, error, pagePerms, refresh, canView, canEdit, canDelete, canApprove }),
    [loading, error, pagePerms, refresh, canView, canEdit, canDelete, canApprove]
  )

  return <RbacContext.Provider value={value}>{children}</RbacContext.Provider>
}

export function useRbac() {
  return useContext(RbacContext)
}
