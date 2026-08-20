import { useCallback, useEffect, useState } from 'react'
import { fetchTankCargoMovementBoard } from '../../../api/cargoMovement.js'
import { fetchTankGaugingSamples } from '../../../api/tankGauging.js'

export function useCargoMovementBoard({ portId, from, to, enabled = true }) {
  const [board, setBoard] = useState(null)
  const [samplesByTank, setSamplesByTank] = useState({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const reload = useCallback(async () => {
    if (!portId || !from || !to || !enabled) return
    setLoading(true)
    setError(null)
    try {
      const payload = await fetchTankCargoMovementBoard({ portId, from, to })
      setBoard(payload)

      const tankIds = (payload?.tanks ?? [])
        .filter((tk) => tk.hasAtg && (tk.segments?.length ?? 0) > 0)
        .map((tk) => tk.tankId)

      if (tankIds.length) {
        const samplePayload = await fetchTankGaugingSamples({
          portId,
          tankIds,
          from,
          to,
        })
        setSamplesByTank(samplePayload?.samples ?? {})
      } else {
        setSamplesByTank({})
      }
    } catch (e) {
      setBoard(null)
      setSamplesByTank({})
      setError(e?.message || 'Failed to load cargo movement board')
    } finally {
      setLoading(false)
    }
  }, [portId, from, to, enabled])

  useEffect(() => {
    reload()
  }, [reload])

  return { board, samplesByTank, loading, error, reload }
}
