import { useEffect, useState } from 'react'
import { fetchMasterTanks } from '../api/masterTanks'

export function usePortTanks(portId, enabled = true) {
  const [tanks, setTanks] = useState([])
  useEffect(() => {
    if (!enabled || portId == null || portId === '') {
      setTanks([])
      return undefined
    }
    let cancelled = false
    fetchMasterTanks(portId)
      .then((rows) => {
        if (!cancelled) setTanks(Array.isArray(rows) ? rows : [])
      })
      .catch(() => {
        if (!cancelled) setTanks([])
      })
    return () => {
      cancelled = true
    }
  }, [portId, enabled])
  return tanks
}
