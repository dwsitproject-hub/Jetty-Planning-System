import { useEffect, useMemo, useState } from 'react'
import { fetchManagementHourlyRates } from '../api/operations'

const CHUNK = 40

/**
 * Hourly rate profiles (band hours + hourly series) for the By Voyage rows, keyed by operation id.
 * @param {Array<{ id: number|string }>} rows
 * @returns {{ profilesById: Record<string, object | null>, loading: boolean }}
 */
export default function useHourlyRateProfiles(rows) {
  const idsKey = useMemo(
    () => [...new Set((rows || []).map((r) => Number(r.id)).filter((n) => n > 0))].sort((a, b) => a - b).join(','),
    [rows]
  )
  const [state, setState] = useState({ key: '', profilesById: {}, loading: false })

  useEffect(() => {
    if (!idsKey) {
      setState({ key: '', profilesById: {}, loading: false })
      return undefined
    }
    let cancelled = false
    setState((prev) => ({ ...prev, loading: true }))
    ;(async () => {
      const ids = idsKey.split(',').map(Number)
      const merged = {}
      for (let i = 0; i < ids.length; i += CHUNK) {
        const res = await fetchManagementHourlyRates(ids.slice(i, i + CHUNK)).catch(() => ({ profiles: {} }))
        Object.assign(merged, res?.profiles || {})
        if (cancelled) return
      }
      setState({ key: idsKey, profilesById: merged, loading: false })
    })()
    return () => {
      cancelled = true
    }
  }, [idsKey])

  return { profilesById: state.profilesById, loading: state.loading || state.key !== idsKey }
}
