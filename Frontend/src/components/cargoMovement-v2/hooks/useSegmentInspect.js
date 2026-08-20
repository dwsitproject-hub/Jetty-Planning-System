import { useCallback, useEffect, useState } from 'react'
import { fetchSegmentInspect } from '../../../api/cargoMovement.js'
import { fetchTankGaugingSamples } from '../../../api/tankGauging.js'

export function useSegmentInspect({ portId, segment, tankId, open }) {
  const [inspect, setInspect] = useState(null)
  const [detailSamples, setDetailSamples] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    if (!open || !portId || !segment?.loadLineId || !tankId) return
    setLoading(true)
    setError(null)
    try {
      const payload = await fetchSegmentInspect({
        portId,
        loadLineId: segment.loadLineId,
        tankId,
      })
      setInspect(payload)

      const startMs = segment.startAt ? Date.parse(segment.startAt) : Date.now()
      const endMs = segment.endAt ? Date.parse(segment.endAt) : Date.now()
      const pad = 2 * 3600 * 1000
      const from = new Date(Math.min(startMs, endMs) - pad).toISOString()
      const to = new Date(Math.max(startMs, endMs) + pad).toISOString()

      const samplePayload = await fetchTankGaugingSamples({
        portId,
        tankIds: [tankId],
        from,
        to,
        detail: true,
        maxPoints: 2000,
      })
      setDetailSamples(samplePayload?.samples?.[String(tankId)] ?? [])
    } catch (e) {
      setInspect(null)
      setDetailSamples([])
      setError(e?.message || 'Failed to load inspect payload')
    } finally {
      setLoading(false)
    }
  }, [open, portId, segment, tankId])

  useEffect(() => {
    if (open) load()
    else {
      setInspect(null)
      setDetailSamples([])
      setError(null)
    }
  }, [open, load])

  return { inspect, detailSamples, loading, error }
}
