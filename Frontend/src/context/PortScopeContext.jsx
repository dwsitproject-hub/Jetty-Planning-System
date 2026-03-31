import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { fetchMyPorts } from '../api/usersApi'
import { getSelectedPortId, setSelectedPortId as persistSelectedPortId } from '../api/client'
import { useAuth } from './AuthContext'

const PortScopeContext = createContext({
  loading: false,
  error: null,
  assignedPorts: [],
  selectedPortId: null,
  selectedPort: null,
  requiresSelection: false,
  noPortAssigned: false,
  noPortMessage: 'No port assigned, please contact Jetty Planning System Admin',
  setSelectedPortId: () => {},
  refreshPorts: async () => {},
})

export function PortScopeProvider({ children }) {
  const { me } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [assignedPorts, setAssignedPorts] = useState([])
  const [selectedPortId, setSelectedPortIdState] = useState(getSelectedPortId())
  const [noPortMessage, setNoPortMessage] = useState('No port assigned, please contact Jetty Planning System Admin')

  const refreshPorts = useCallback(async () => {
    if (!me) {
      setAssignedPorts([])
      setError(null)
      setLoading(false)
      setSelectedPortIdState(null)
      persistSelectedPortId(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const data = await fetchMyPorts()
      const ports = Array.isArray(data?.assignedPorts) ? data.assignedPorts : []
      setAssignedPorts(ports)
      setNoPortMessage(data?.noPortMessage || 'No port assigned, please contact Jetty Planning System Admin')

      if (ports.length === 0) {
        setSelectedPortIdState(null)
        persistSelectedPortId(null)
      } else if (ports.length === 1) {
        const onlyId = Number(ports[0].id)
        setSelectedPortIdState(onlyId)
        persistSelectedPortId(onlyId)
      } else {
        const current = getSelectedPortId()
        const valid = ports.some((p) => Number(p.id) === Number(current))
        if (!valid) {
          setSelectedPortIdState(null)
          persistSelectedPortId(null)
        } else {
          setSelectedPortIdState(Number(current))
        }
      }
    } catch (e) {
      setError(e?.message || 'Failed to load assigned ports')
      setAssignedPorts([])
      setSelectedPortIdState(null)
      persistSelectedPortId(null)
    } finally {
      setLoading(false)
    }
  }, [me])

  useEffect(() => {
    refreshPorts()
  }, [refreshPorts])

  const setSelectedPortId = useCallback((portId) => {
    const next = portId == null ? null : Number(portId)
    setSelectedPortIdState(Number.isFinite(next) ? next : null)
    persistSelectedPortId(Number.isFinite(next) ? next : null)
  }, [])

  const selectedPort = useMemo(
    () => assignedPorts.find((p) => Number(p.id) === Number(selectedPortId)) || null,
    [assignedPorts, selectedPortId]
  )

  const requiresSelection = !!me && assignedPorts.length > 1 && !selectedPortId
  const noPortAssigned = !!me && assignedPorts.length === 0

  const value = useMemo(
    () => ({
      loading,
      error,
      assignedPorts,
      selectedPortId,
      selectedPort,
      requiresSelection,
      noPortAssigned,
      noPortMessage,
      setSelectedPortId,
      refreshPorts,
    }),
    [loading, error, assignedPorts, selectedPortId, selectedPort, requiresSelection, noPortAssigned, noPortMessage, setSelectedPortId, refreshPorts]
  )

  return <PortScopeContext.Provider value={value}>{children}</PortScopeContext.Provider>
}

export function usePortScope() {
  return useContext(PortScopeContext)
}
