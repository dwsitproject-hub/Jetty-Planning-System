import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchCargoSegmentHourly } from '../../api/operations'
import {
  buildOperatorSegmentHourlyRequests,
  cargoSegmentHourlySignature,
  mapCargoSegmentHourlyResponse,
} from '../../utils/cargoSegmentHourlyHelpers'

/**
 * Fetch per-segment hourly buckets for operator cargo segments (read-only visibility).
 */
export function useOperatorCargoSegmentHourly({
  operationId,
  segments,
  tankOptions,
  enabled = true,
  debounceMs = 400,
  pollMs = 30000,
}) {
  const [byKey, setByKey] = useState(() => new Map())
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef(null)

  const tankMetaById = useMemo(
    () => new Map((tankOptions || []).map((t) => [String(t.id), t])),
    [tankOptions]
  )

  const apiSegments = useMemo(() => {
    if (!enabled || !operationId) return []
    return buildOperatorSegmentHourlyRequests(segments, tankMetaById)
  }, [enabled, operationId, segments, tankMetaById])

  const hasOpenSegment = useMemo(
    () => (segments || []).some((seg) => seg.showHourly && seg.isOpen),
    [segments]
  )

  const signature = useMemo(
    () => cargoSegmentHourlySignature(apiSegments),
    [apiSegments]
  )

  useEffect(() => {
    if (!enabled || !operationId) {
      setByKey(new Map())
      setLoading(false)
      return undefined
    }

    if (apiSegments.length === 0) {
      setByKey(new Map())
      setLoading(false)
      return undefined
    }

    let cancelled = false

    const run = () => {
      setLoading(true)
      fetchCargoSegmentHourly(operationId, apiSegments)
        .then((res) => {
          if (cancelled) return
          setByKey(mapCargoSegmentHourlyResponse(res))
          setLoading(false)
        })
        .catch(() => {
          if (cancelled) return
          setLoading(false)
        })
    }

    if (debounceRef.current) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(run, debounceMs)

    return () => {
      cancelled = true
      if (debounceRef.current) window.clearTimeout(debounceRef.current)
    }
  }, [enabled, operationId, signature, apiSegments, debounceMs])

  useEffect(() => {
    if (!enabled || !operationId || !hasOpenSegment || apiSegments.length === 0) return undefined
    const pollId = window.setInterval(() => {
      fetchCargoSegmentHourly(operationId, apiSegments)
        .then((res) => setByKey(mapCargoSegmentHourlyResponse(res)))
        .catch(() => {})
    }, pollMs)
    return () => window.clearInterval(pollId)
  }, [enabled, operationId, hasOpenSegment, apiSegments, pollMs, signature])

  return { byKey, loading }
}
