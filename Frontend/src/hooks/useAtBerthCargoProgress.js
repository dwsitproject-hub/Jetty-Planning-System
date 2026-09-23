import { useEffect, useState } from 'react'
import { fetchAtBerthCargoProgress } from '../api/operations'

const POLL_MS = 60_000

/**
 * Poll live at-berth cargo progress summaries keyed by operation id.
 * @param {number[]} operationIds
 */
export default function useAtBerthCargoProgress(operationIds) {
  const [cargoProgressByOpId, setCargoProgressByOpId] = useState({})

  useEffect(() => {
    const ids = [
      ...new Set(
        (operationIds || [])
          .map((id) => Number(id))
          .filter((n) => Number.isFinite(n) && n > 0)
      ),
    ]

    if (!ids.length) {
      setCargoProgressByOpId({})
      return undefined
    }

    let cancelled = false
    const refresh = () => {
      fetchAtBerthCargoProgress(ids)
        .then((res) => {
          if (!cancelled) setCargoProgressByOpId(res?.summaries ?? {})
        })
        .catch(() => {})
    }

    refresh()
    const id = setInterval(refresh, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [operationIds])

  return cargoProgressByOpId
}
