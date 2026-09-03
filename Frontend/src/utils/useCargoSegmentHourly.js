import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchCargoSegmentHourly } from '../api/operations'
import { partitionDraftTanks } from './cargoSessionHelpers'
import {
  buildCargoSegmentHourlyRequests,
  cargoSegmentHourlySignature,
  mapCargoSegmentHourlyResponse,
} from './cargoSegmentHourlyHelpers'

/**
 * Fetch per-entry hourly buckets for cargo modal draft lines (debounced + poll open segments).
 */
export function useCargoSegmentHourly({
  operationId,
  cargoLoadLinesDraft,
  tankMetaById,
  normalizeStartEnd,
  liveAtgTick = 0,
  enabled = true,
  debounceMs = 400,
  pollMs = 30000,
}) {
  const [byKey, setByKey] = useState(() => new Map())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const debounceRef = useRef(null)

  const segments = useMemo(() => {
    if (!enabled || !operationId) return []
    return buildCargoSegmentHourlyRequests(
      cargoLoadLinesDraft,
      tankMetaById,
      normalizeStartEnd
    )
  }, [enabled, operationId, cargoLoadLinesDraft, tankMetaById, normalizeStartEnd])

  const hasOpenSegment = useMemo(
    () =>
      (cargoLoadLinesDraft || []).some((row) => {
        if (!row.start || row.end) return false
        const { atgTankIds } = partitionDraftTanks(row.tankIds, tankMetaById)
        return atgTankIds.length > 0 && row.atgQtyMode !== 'manual'
      }),
    [cargoLoadLinesDraft, tankMetaById]
  )

  const signature = useMemo(
    () => cargoSegmentHourlySignature(segments, liveAtgTick),
    [segments, liveAtgTick]
  )

  useEffect(() => {
    if (!enabled || !operationId) {
      setByKey(new Map())
      setLoading(false)
      setError(null)
      return undefined
    }

    if (segments.length === 0) {
      setByKey(new Map())
      setLoading(false)
      setError(null)
      return undefined
    }

    let cancelled = false

    const run = () => {
      setLoading(true)
      setError(null)
      fetchCargoSegmentHourly(operationId, segments)
        .then((res) => {
          if (cancelled) return
          setByKey(mapCargoSegmentHourlyResponse(res))
          setLoading(false)
        })
        .catch((e) => {
          if (cancelled) return
          setError(e?.message || 'Failed to load hourly rates')
          setLoading(false)
        })
    }

    if (debounceRef.current) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(run, debounceMs)

    return () => {
      cancelled = true
      if (debounceRef.current) window.clearTimeout(debounceRef.current)
    }
  }, [enabled, operationId, signature, segments, debounceMs])

  useEffect(() => {
    if (!enabled || !operationId || !hasOpenSegment || segments.length === 0) return undefined
    const pollId = window.setInterval(() => {
      fetchCargoSegmentHourly(operationId, segments)
        .then((res) => setByKey(mapCargoSegmentHourlyResponse(res)))
        .catch(() => {})
    }, pollMs)
    return () => window.clearInterval(pollId)
  }, [enabled, operationId, hasOpenSegment, segments, pollMs, signature])

  return { byKey, loading, error, segments }
}
