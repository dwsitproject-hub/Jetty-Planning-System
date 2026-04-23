import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { fetchMe } from '../api/usersApi'
import { clearLegacyToken, logout as apiLogout } from '../api/auth'

const AuthContext = createContext({
  loading: true,
  error: null,
  me: null,
  refreshMe: async () => {},
  logout: async () => {},
})

export function AuthProvider({ children }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [me, setMe] = useState(null)

  useEffect(() => {
    clearLegacyToken()
  }, [])

  const refreshMe = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchMe()
      setMe(data || null)
    } catch (e) {
      setMe(null)
      setError(e?.message || 'Failed to load user')
    } finally {
      setLoading(false)
    }
  }, [])

  const logout = useCallback(async () => {
    await apiLogout()
    setMe(null)
    setError(null)
    setLoading(false)
  }, [])

  useEffect(() => {
    refreshMe()
  }, [refreshMe])

  const value = useMemo(() => ({ loading, error, me, refreshMe, logout }), [loading, error, me, refreshMe, logout])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
