import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { fetchMyPagePermissions } from '../api/rbac'
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
  const permissionsLoadedRef = useRef(false)

  const refresh = useCallback(async ({ force = false } = {}) => {
    if (!me && !force) {
      setPagePerms({})
      setError(null)
      setLoading(false)
      permissionsLoadedRef.current = false
      return {}
    }
    const showBlockingLoader = !permissionsLoadedRef.current
    if (showBlockingLoader) setLoading(true)
    setError(null)
    try {
      const map = await fetchMyPagePermissions()
      setPagePerms(map)
      permissionsLoadedRef.current = true
      return map
    } catch (e) {
      setError(e?.message || 'Failed to load permissions')
      setPagePerms({})
      return {}
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
